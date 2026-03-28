"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/components/auth-provider";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFacesFromCanvas } from "@/lib/browser-face";
import { cosineSimilarity } from "@/lib/embeddings";

type VerifyState = { enrolled: boolean; verified: boolean };
type VerifyMode = "idle" | "align" | "passive" | "challenge" | "submitting" | "verified";
type VerifyChallenge = "blink" | "smile" | "turn";
type GuidanceTone = "neutral" | "good" | "warn";
type FaceProbe = {
  embedding: number[];
  qualityScore: number;
  sharpness: number;
  blink: number;
  smile: number;
  mouthOpen: number;
  yaw: number;
  pitch: number;
  textureScore: number;
  brightness: number;
  faceRatio: number;
  centerX: number;
  centerY: number;
  capturedAt: number;
};

type AlignmentFeedback = {
  ok: boolean;
  reason: string;
  tone: GuidanceTone;
};

type WindowFeedback = {
  ok: boolean;
  reason: string;
  tone: GuidanceTone;
  fallbackToChallenge?: boolean;
};

const ANALYSIS_INTERVAL_MS = 700;
const ALIGNMENT_STREAK_REQUIRED = 3;
const PASSIVE_WINDOW_SIZE = 6;
const CHALLENGE_WINDOW_SIZE = 8;
const SUCCESS_HOLD_MS = 1400;
const CAPTURE_MAX_DIM = 720;

const CHALLENGES: VerifyChallenge[] = ["blink", "smile", "turn"];
const CHALLENGE_LABELS: Record<VerifyChallenge, string> = {
  blink: "Blink twice",
  smile: "Give a quick smile",
  turn: "Turn your head slightly",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function captureVisibleVideoFrame(video: HTMLVideoElement) {
  const displayWidth = video.clientWidth || video.videoWidth;
  const displayHeight = video.clientHeight || video.videoHeight;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!displayWidth || !displayHeight || !sourceWidth || !sourceHeight) {
    return null;
  }

  const coverScale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  const visibleSourceWidth = displayWidth / coverScale;
  const visibleSourceHeight = displayHeight / coverScale;
  const sx = Math.max(0, (sourceWidth - visibleSourceWidth) / 2);
  const sy = Math.max(0, (sourceHeight - visibleSourceHeight) / 2);
  const outputScale = Math.min(1, CAPTURE_MAX_DIM / Math.max(visibleSourceWidth, visibleSourceHeight));
  const outputWidth = Math.max(1, Math.round(visibleSourceWidth * outputScale));
  const outputHeight = Math.max(1, Math.round(visibleSourceHeight * outputScale));

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.drawImage(
    video,
    sx,
    sy,
    visibleSourceWidth,
    visibleSourceHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  return canvas;
}

function evaluateAlignment(probe: FaceProbe | null): AlignmentFeedback {
  if (!probe) {
    return {
      ok: false,
      reason: "Center your face in the oval to begin.",
      tone: "warn",
    };
  }

  const centerDx = Math.abs(probe.centerX - 0.5);
  const centerDy = Math.abs(probe.centerY - 0.5);

  if (probe.brightness < 0.2) {
    return { ok: false, reason: "Move into better light.", tone: "warn" };
  }

  if (probe.faceRatio < 0.12) {
    return { ok: false, reason: "Move a little closer.", tone: "warn" };
  }

  if (probe.faceRatio > 0.5) {
    return { ok: false, reason: "Move slightly back from the camera.", tone: "warn" };
  }

  if (centerDx > 0.18 || centerDy > 0.2) {
    return { ok: false, reason: "Keep your face centered in the oval.", tone: "warn" };
  }

  if (Math.abs(probe.yaw) > 0.35 || Math.abs(probe.pitch) > 0.35) {
    return { ok: false, reason: "Look straight ahead.", tone: "warn" };
  }

  if (probe.sharpness < 0.16) {
    return { ok: false, reason: "Hold still for a moment.", tone: "warn" };
  }

  if (probe.qualityScore < 0.5) {
    return { ok: false, reason: "Need a clearer view of your face.", tone: "warn" };
  }

  return {
    ok: true,
    reason: "Great. Hold steady while we check automatically.",
    tone: "good",
  };
}

function evaluatePassiveWindow(probes: FaceProbe[]): WindowFeedback {
  if (probes.length < PASSIVE_WINDOW_SIZE) {
    return {
      ok: false,
      reason: "Hold steady. We are checking for natural motion.",
      tone: "neutral",
    };
  }

  const qualityScores = probes.map((probe) => probe.qualityScore);
  const textureScores = probes.map((probe) => probe.textureScore);
  const smiles = probes.map((probe) => probe.smile);
  const blinks = probes.map((probe) => probe.blink);
  const yaws = probes.map((probe) => probe.yaw);
  const centerXs = probes.map((probe) => probe.centerX);
  const centerYs = probes.map((probe) => probe.centerY);
  const faceRatios = probes.map((probe) => probe.faceRatio);
  const sharpnessScores = probes.map((probe) => probe.sharpness);
  const avgTexture = average(textureScores);

  if (Math.min(...qualityScores) < 0.48 || average(qualityScores) < 0.58) {
    return {
      ok: false,
      reason: "Need a slightly clearer face before we continue.",
      tone: "warn",
    };
  }

  if (average(sharpnessScores) < 0.18) {
    return {
      ok: false,
      reason: "Hold still a little longer.",
      tone: "warn",
    };
  }

  const base = [...probes].sort((left, right) => right.qualityScore - left.qualityScore)[0];
  const similarities = probes
    .filter((probe) => probe !== base)
    .map((probe) => cosineSimilarity(base.embedding, probe.embedding));

  if (similarities.length > 0 && (Math.min(...similarities) < 0.35 || average(similarities) < 0.6)) {
    return {
      ok: false,
      reason: "Need a more consistent face capture. Hold steady.",
      tone: "warn",
    };
  }

  let maxJump = 0;
  for (let index = 1; index < probes.length; index += 1) {
    const dx = Math.abs(probes[index].centerX - probes[index - 1].centerX);
    const dy = Math.abs(probes[index].centerY - probes[index - 1].centerY);
    maxJump = Math.max(maxJump, dx + dy);
  }

  if (maxJump > 0.28) {
    return {
      ok: false,
      reason: "Too much movement. Hold steady and stay in frame.",
      tone: "warn",
    };
  }

  const blinkRange = Math.max(...blinks) - Math.min(...blinks);
  const smileRange = Math.max(...smiles) - Math.min(...smiles);
  const yawRange = Math.max(...yaws) - Math.min(...yaws);
  const motion =
    Math.max(...centerXs) - Math.min(...centerXs) + (Math.max(...centerYs) - Math.min(...centerYs));
  const faceSizeRange = Math.max(...faceRatios) - Math.min(...faceRatios);
  const hasNaturalMotion =
    blinkRange >= 0.14 ||
    smileRange >= 0.12 ||
    yawRange >= 0.07 ||
    motion >= 0.035 ||
    faceSizeRange >= 0.025;

  if (avgTexture < 0.08 && !hasNaturalMotion) {
    return {
      ok: false,
      reason: "The camera feed looks soft. Try brighter light or a little natural movement.",
      tone: "neutral",
      fallbackToChallenge: true,
    };
  }

  if (!hasNaturalMotion) {
    return {
      ok: false,
      reason: "We need one quick guided action to finish verification.",
      tone: "neutral",
      fallbackToChallenge: true,
    };
  }

  return {
    ok: true,
    reason: "Passive capture looks good. Finishing verification.",
    tone: "good",
  };
}

function evaluateChallengeWindow(
  probes: FaceProbe[],
  challenge: VerifyChallenge
): WindowFeedback {
  if (probes.length < 4) {
    return {
      ok: false,
      reason: `Waiting for you to ${CHALLENGE_LABELS[challenge].toLowerCase()}.`,
      tone: "neutral",
    };
  }

  const qualityScores = probes.map((probe) => probe.qualityScore);
  if (Math.min(...qualityScores) < 0.48) {
    return {
      ok: false,
      reason: "Need a clearer face during the guided action.",
      tone: "warn",
    };
  }

  const base = [...probes].sort((left, right) => right.qualityScore - left.qualityScore)[0];
  const similarities = probes
    .filter((probe) => probe !== base)
    .map((probe) => cosineSimilarity(base.embedding, probe.embedding));

  if (similarities.length > 0 && Math.min(...similarities) < 0.3) {
    return {
      ok: false,
      reason: "Keep your face in frame while doing the action.",
      tone: "warn",
    };
  }

  const blinks = probes.map((probe) => probe.blink);
  const smiles = probes.map((probe) => probe.smile);
  const yaws = probes.map((probe) => probe.yaw);
  const centerXs = probes.map((probe) => probe.centerX);
  const centerYs = probes.map((probe) => probe.centerY);
  const blinkRange = Math.max(...blinks) - Math.min(...blinks);
  const smileRange = Math.max(...smiles) - Math.min(...smiles);
  const yawRange = Math.max(...yaws) - Math.min(...yaws);
  const avgTexture = average(probes.map((probe) => probe.textureScore));
  const motion =
    Math.max(...centerXs) - Math.min(...centerXs) + (Math.max(...centerYs) - Math.min(...centerYs));

  const passed =
    challenge === "blink"
      ? Math.max(...blinks) >= 0.48 && blinkRange >= 0.18
      : challenge === "smile"
        ? Math.max(...smiles) >= 0.42 && smileRange >= 0.14
        : Math.max(...yaws.map((value) => Math.abs(value))) >= 0.12 && yawRange >= 0.08;

  if (!passed) {
    return {
      ok: false,
      reason:
        challenge === "blink"
          ? "Blink naturally twice."
          : challenge === "smile"
            ? "Give a quick natural smile."
            : "Turn your head slightly left or right.",
      tone: "neutral",
    };
  }

  if (motion < 0.015 && yawRange < 0.04 && blinkRange < 0.1 && smileRange < 0.1) {
    return {
      ok: false,
      reason: "Need a little more live motion while you do the action.",
      tone: "neutral",
    };
  }

  if (avgTexture < 0.06 && motion < 0.02 && yawRange < 0.05 && blinkRange < 0.12 && smileRange < 0.12) {
    return {
      ok: false,
      reason: "The camera feed looks too flat. Try brighter light or bring the phone a bit closer.",
      tone: "neutral",
    };
  }

  return {
    ok: true,
    reason: "Challenge complete. Finishing verification.",
    tone: "good",
  };
}

function selectVerificationProbes(probes: FaceProbe[]) {
  return [...probes]
    .sort((left, right) => {
      const leftScore = left.qualityScore * 0.7 + left.sharpness * 0.2 + left.textureScore * 0.1;
      const rightScore = right.qualityScore * 0.7 + right.sharpness * 0.2 + right.textureScore * 0.1;
      return rightScore - leftScore;
    })
    .slice(0, 3);
}

export function FaceVerificationGate() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisTimerRef = useRef<number | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const alignmentStreakRef = useRef(0);
  const passiveProbesRef = useRef<FaceProbe[]>([]);
  const challengeProbesRef = useRef<FaceProbe[]>([]);
  const modeRef = useRef<VerifyMode>("idle");
  const challengeRef = useRef<VerifyChallenge>("blink");
  const isSubmittingRef = useRef(false);
  const { user, loading: authLoading } = useAuth();

  const [stateLoading, setStateLoading] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [challenge, setChallenge] = useState<VerifyChallenge>("blink");
  const [mode, setMode] = useState<VerifyMode>("idle");
  const [guidance, setGuidance] = useState("Center your face in the oval to begin.");
  const [guidanceTone, setGuidanceTone] = useState<GuidanceTone>("neutral");
  const [progress, setProgress] = useState(0);

  const isSignedIn = Boolean(user);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    challengeRef.current = challenge;
  }, [challenge]);

  useEffect(() => {
    if (!isSignedIn) {
      setVerifyState(null);
      return;
    }

    setStateLoading(true);
    void apiFetch("/api/v1/face/verify/status")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "Failed to fetch verification status");
          return;
        }

        setVerifyState(data.verification ?? null);
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Failed to fetch status");
      })
      .finally(() => setStateLoading(false));
  }, [isSignedIn]);

  useEffect(() => {
    return () => {
      if (analysisTimerRef.current !== null) {
        window.clearTimeout(analysisTimerRef.current);
      }

      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  const shouldShow =
    !authLoading &&
    isSignedIn &&
    !stateLoading &&
    verifyState !== null &&
    verifyState.enrolled &&
    (!verifyState.verified || mode === "verified" || mode === "submitting");

  function randomChallenge(): VerifyChallenge {
    return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
  }

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
  }

  function resetAnalysisState(nextMode: VerifyMode) {
    alignmentStreakRef.current = 0;
    passiveProbesRef.current = [];
    challengeProbesRef.current = [];
    modeRef.current = nextMode;
    setMode(nextMode);
    setProgress(0);
  }

  const captureProbe = useEffectEvent(async (): Promise<FaceProbe | null> => {
    if (!videoRef.current) {
      return null;
    }

    const visibleFrame = captureVisibleVideoFrame(videoRef.current);
    if (!visibleFrame) {
      return null;
    }

    const ctx = visibleFrame.getContext("2d");
    if (!ctx) {
      return null;
    }

    const imageData = ctx.getImageData(0, 0, visibleFrame.width, visibleFrame.height);
    let luminanceTotal = 0;
    const pixelCount = visibleFrame.width * visibleFrame.height;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      luminanceTotal +=
        0.299 * imageData.data[offset] +
        0.587 * imageData.data[offset + 1] +
        0.114 * imageData.data[offset + 2];
    }

    const faces = await detectBrowserFacesFromCanvas(visibleFrame);
    if (faces.length === 0) {
      return null;
    }

    faces.sort((left, right) => right.bbox.w * right.bbox.h - left.bbox.w * left.bbox.h);
    const face = faces[0];

    return {
      embedding: face.embedding,
      qualityScore: face.qualityScore,
      sharpness: face.sharpness,
      blink: face.liveness.blink,
      smile: face.liveness.smile,
      mouthOpen: face.liveness.mouthOpen,
      yaw: face.liveness.yaw,
      pitch: face.liveness.pitch,
      textureScore: face.liveness.textureScore,
      brightness: clamp(luminanceTotal / Math.max(pixelCount, 1) / 255, 0, 1),
      faceRatio: (face.bbox.w * face.bbox.h) / (visibleFrame.width * visibleFrame.height),
      centerX: (face.bbox.x + face.bbox.w / 2) / visibleFrame.width,
      centerY: (face.bbox.y + face.bbox.h / 2) / visibleFrame.height,
      capturedAt: Date.now(),
    };
  });

  const finalizeSuccess = useEffectEvent(() => {
    stopCamera();
    successTimerRef.current = window.setTimeout(() => {
      modeRef.current = "idle";
      setMode("idle");
      setVerifyState({ enrolled: true, verified: true });
    }, SUCCESS_HOLD_MS);
  });

  const submitVerification = useEffectEvent(
    async (probes: FaceProbe[], source: "passive" | VerifyChallenge) => {
      if (isSubmittingRef.current) {
        return;
      }

      const selectedProbes = selectVerificationProbes(probes);
      if (selectedProbes.length === 0) {
        return;
      }

      isSubmittingRef.current = true;
      modeRef.current = "submitting";
      setMode("submitting");
      setIsVerifying(true);
      setError("");
      setGuidance("Finishing verification...");
      setGuidanceTone("good");
      setProgress(100);

      try {
        const response = await apiFetch("/api/v1/face/verify/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            embedding: selectedProbes[0].embedding,
            embeddings: selectedProbes.map((probe) => probe.embedding),
            qualityScore: average(selectedProbes.map((probe) => probe.qualityScore)),
            qualityScores: selectedProbes.map((probe) => probe.qualityScore),
            verificationMode: source,
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          if (source === "passive") {
            const nextChallenge = randomChallenge();
            setChallenge(nextChallenge);
            challengeRef.current = nextChallenge;
            challengeProbesRef.current = [];
            modeRef.current = "challenge";
            setMode("challenge");
            setGuidance(`Almost done. ${CHALLENGE_LABELS[nextChallenge]}.`);
            setGuidanceTone("neutral");
            setProgress(12);
          } else {
            modeRef.current = "challenge";
            setMode("challenge");
            challengeProbesRef.current = [];
            setGuidance(payload?.error ?? "Try the guided action once more.");
            setGuidanceTone("warn");
            setProgress(8);
          }

          return;
        }

        setMessage("Verification complete! You're all set.");
        setGuidance("Access unlocked for this session.");
        setGuidanceTone("good");
        setProgress(100);
        setMode("verified");
        modeRef.current = "verified";
        finalizeSuccess();
      } catch (requestError) {
        modeRef.current = "challenge";
        setMode("challenge");
        challengeProbesRef.current = [];
        setGuidance(
          requestError instanceof Error ? requestError.message : "Live verification failed"
        );
        setGuidanceTone("warn");
        setProgress(8);
      } finally {
        isSubmittingRef.current = false;
        setIsVerifying(false);
      }
    }
  );

  const handleProbe = useEffectEvent(async (probe: FaceProbe | null) => {
    if (modeRef.current === "submitting" || modeRef.current === "verified") {
      return;
    }

    const alignment = evaluateAlignment(probe);
    if (!alignment.ok) {
      alignmentStreakRef.current = 0;
      passiveProbesRef.current = [];
      if (modeRef.current !== "challenge") {
        modeRef.current = "align";
        setMode("align");
      }
      setGuidance(alignment.reason);
      setGuidanceTone(alignment.tone);
      setProgress(0);
      return;
    }

    setGuidance(alignment.reason);
    setGuidanceTone(alignment.tone);

    if (!probe) {
      return;
    }

    if (modeRef.current === "idle" || modeRef.current === "align") {
      alignmentStreakRef.current += 1;
      passiveProbesRef.current.push(probe);
      passiveProbesRef.current = passiveProbesRef.current.slice(-PASSIVE_WINDOW_SIZE);
      setProgress(clamp((alignmentStreakRef.current / ALIGNMENT_STREAK_REQUIRED) * 35, 0, 35));

      if (alignmentStreakRef.current >= ALIGNMENT_STREAK_REQUIRED) {
        modeRef.current = "passive";
        setMode("passive");
        setGuidance("Nice. Checking for a natural live capture.");
        setGuidanceTone("good");
        setProgress(40);
      }
      return;
    }

    if (modeRef.current === "passive") {
      passiveProbesRef.current.push(probe);
      passiveProbesRef.current = passiveProbesRef.current.slice(-PASSIVE_WINDOW_SIZE);
      setProgress(clamp(40 + (passiveProbesRef.current.length / PASSIVE_WINDOW_SIZE) * 40, 40, 82));

      const feedback = evaluatePassiveWindow(passiveProbesRef.current);
      setGuidance(feedback.reason);
      setGuidanceTone(feedback.tone);

      if (feedback.ok) {
        await submitVerification(passiveProbesRef.current, "passive");
        return;
      }

      if (feedback.fallbackToChallenge) {
        const nextChallenge = randomChallenge();
        setChallenge(nextChallenge);
        challengeRef.current = nextChallenge;
        challengeProbesRef.current = [];
        modeRef.current = "challenge";
        setMode("challenge");
        setProgress(10);
      }
      return;
    }

    challengeProbesRef.current.push(probe);
    challengeProbesRef.current = challengeProbesRef.current.slice(-CHALLENGE_WINDOW_SIZE);
    setProgress(clamp((challengeProbesRef.current.length / CHALLENGE_WINDOW_SIZE) * 85, 12, 92));

    const challengeFeedback = evaluateChallengeWindow(
      challengeProbesRef.current,
      challengeRef.current
    );
    setGuidance(challengeFeedback.reason);
    setGuidanceTone(challengeFeedback.tone);

    if (challengeFeedback.ok) {
      await submitVerification(challengeProbesRef.current, challengeRef.current);
    }
  });

  useEffect(() => {
    if (!cameraReady || !shouldShow) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }

      try {
        const probe = await captureProbe();
        if (!cancelled) {
          await handleProbe(probe);
        }
      } catch (probeError) {
        if (!cancelled) {
          setError(probeError instanceof Error ? probeError.message : "Failed to analyze camera");
        }
      } finally {
        if (!cancelled && modeRef.current !== "verified") {
          analysisTimerRef.current = window.setTimeout(tick, ANALYSIS_INTERVAL_MS);
        }
      }
    };

    analysisTimerRef.current = window.setTimeout(tick, 180);

    return () => {
      cancelled = true;
      if (analysisTimerRef.current !== null) {
        window.clearTimeout(analysisTimerRef.current);
      }
      analysisTimerRef.current = null;
    };
  }, [cameraReady, shouldShow]);

  if (!shouldShow) {
    if (verifyState && !verifyState.enrolled) {
      return (
        <div className="card card-accent" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 28 }}>🤳</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Face enrollment required</p>
            <p className="muted text-sm" style={{ margin: 0 }}>
              Enroll your face to unlock groups and sharing.
            </p>
          </div>
          <Link
            href="/enrollment"
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Enroll Now
          </Link>
        </div>
      );
    }

    return null;
  }

  async function startCamera() {
    setError("");
    setMessage("");

    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }

    stopCamera();
    resetAnalysisState("align");
    setGuidance("Center your face in the oval to begin.");
    setGuidanceTone("neutral");
    setChallenge(randomChallenge());

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "Failed to access camera");
    }
  }

  function resetFlow() {
    setError("");
    setMessage("");
    resetAnalysisState(cameraReady ? "align" : "idle");
    setGuidance("Center your face in the oval to begin.");
    setGuidanceTone("neutral");
  }

  const phaseLabel =
    mode === "challenge"
      ? CHALLENGE_LABELS[challenge]
      : mode === "passive"
        ? "Passive check"
        : mode === "submitting"
          ? "Finishing"
          : mode === "verified"
            ? "Verified"
            : "Auto align";

  return (
    <div className="card card-accent">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🔐 Live Face Verification</h3>
        <span className={`challenge-label ${mode === "challenge" ? "challenge-active" : ""}`}>
          {phaseLabel}
        </span>
      </div>
      <p className="muted text-sm" style={{ marginBottom: 16 }}>
        Start the camera and we&apos;ll align, capture, and verify automatically. A guided action only appears if passive liveness needs help.
      </p>

      <div className="verify-camera-shell">
        <video ref={videoRef} className="verify-video" playsInline muted />
        <div className={`verify-oval verify-oval-${guidanceTone}`} />
        <div className="verify-overlay">
          <div className="verify-overlay-top">
            <div className={`verify-guidance verify-guidance-${guidanceTone}`}>{guidance}</div>
          </div>
          <div className="verify-overlay-bottom">
            <div className="verify-progress-track">
              <div className="verify-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="verify-meta">
        <span>{cameraReady ? "Camera live" : "Camera offline"}</span>
        <span>
          {mode === "challenge"
            ? `Guided action: ${CHALLENGE_LABELS[challenge]}`
            : mode === "passive"
              ? "Passive verification in progress"
              : mode === "verified"
                ? "Verification finished"
                : "Waiting for alignment"}
        </span>
      </div>

      <div className="row">
        <button onClick={() => void startCamera()} disabled={isVerifying}>
          {cameraReady ? "Restart Camera" : "Start Camera"}
        </button>
        <button onClick={resetFlow} disabled={!cameraReady || isVerifying}>
          Reset Check
        </button>
      </div>

      {error && <p className="status-error" style={{ marginTop: 12 }}>{error}</p>}
      {message && <p className="status-success" style={{ marginTop: 12 }}>{message}</p>}
    </div>
  );
}
