"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";
import { cosineSimilarity } from "@/lib/embeddings";

type VerifyState = {
  enrolled: boolean;
  verified: boolean;
};

type VerifyChallenge = "blink" | "smile" | "turn";

type FaceProbe = {
  embedding: number[];
  qualityScore: number;
  blink: number;
  smile: number;
  yaw: number;
  centerX: number;
  centerY: number;
};

const CHALLENGES: VerifyChallenge[] = ["blink", "smile", "turn"];

function fileFromDataUrl(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], `live-verify-${Date.now()}.jpg`, { type: mime });
}

export function FaceVerificationGate() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const [stateLoading, setStateLoading] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [challenge, setChallenge] = useState<VerifyChallenge>("blink");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth
      .getUser()
      .then(({ data }) => {
        setIsSignedIn(Boolean(data.user));
      })
      .finally(() => setAuthLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session?.user));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
        setError(requestError instanceof Error ? requestError.message : "Failed to fetch verification status");
      })
      .finally(() => setStateLoading(false));
  }, [isSignedIn]);

  useEffect(() => {
    return () => {
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
    !verifyState.verified;

  function randomChallenge(): VerifyChallenge {
    return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
  }

  async function captureProbe(): Promise<FaceProbe | null> {
    if (!videoRef.current) {
      return null;
    }

    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const file = fileFromDataUrl(dataUrl);

    const faces = await detectBrowserFaces(file);
    if (faces.length === 0) {
      return null;
    }

    faces.sort((left, right) => right.bbox.w * right.bbox.h - left.bbox.w * left.bbox.h);
    const bestFace = faces[0];

    return {
      embedding: bestFace.embedding,
      qualityScore: bestFace.qualityScore,
      blink: bestFace.liveness.blink,
      smile: bestFace.liveness.smile,
      yaw: bestFace.liveness.yaw,
      centerX: bestFace.bbox.x + bestFace.bbox.w / 2,
      centerY: bestFace.bbox.y + bestFace.bbox.h / 2,
    };
  }

  async function captureBurst() {
    const probes: FaceProbe[] = [];

    for (let index = 0; index < 5; index += 1) {
      const probe = await captureProbe();
      if (probe) {
        probes.push(probe);
      }

      if (index < 4) {
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
    }

    return probes;
  }

  function passesLivenessChallenge(probes: FaceProbe[]) {
    if (probes.length < 3) {
      return { ok: false, reason: "Face not detected consistently. Keep your face centered." };
    }

    const qualityMin = Math.min(...probes.map((probe) => probe.qualityScore));
    if (qualityMin < 0.52) {
      return { ok: false, reason: "Face quality is low. Improve lighting and try again." };
    }

    const base = probes[0];
    const similarities = probes.slice(1).map((probe) => cosineSimilarity(base.embedding, probe.embedding));
    if (similarities.some((score) => score < 0.45)) {
      return { ok: false, reason: "Inconsistent face capture detected. Retry the challenge." };
    }

    const yawValues = probes.map((probe) => probe.yaw);
    const blinkValues = probes.map((probe) => probe.blink);
    const smileValues = probes.map((probe) => probe.smile);
    const centerXValues = probes.map((probe) => probe.centerX);
    const centerYValues = probes.map((probe) => probe.centerY);

    const yawRange = Math.max(...yawValues) - Math.min(...yawValues);
    const blinkRange = Math.max(...blinkValues) - Math.min(...blinkValues);
    const smileRange = Math.max(...smileValues) - Math.min(...smileValues);
    const motionRange =
      (Math.max(...centerXValues) - Math.min(...centerXValues)) +
      (Math.max(...centerYValues) - Math.min(...centerYValues));

    const challengePassed =
      challenge === "blink"
        ? Math.max(...blinkValues) >= 0.5 && blinkRange >= 0.2
        : challenge === "smile"
          ? Math.max(...smileValues) >= 0.45 && smileRange >= 0.18
          : Math.max(...yawValues.map((value) => Math.abs(value))) >= 0.09 && yawRange >= 0.08;

    if (!challengePassed) {
      if (challenge === "blink") {
        return { ok: false, reason: "Blink challenge not detected. Please blink clearly and retry." };
      }
      if (challenge === "smile") {
        return { ok: false, reason: "Smile challenge not detected. Please smile naturally and retry." };
      }
      return { ok: false, reason: "Head turn challenge not detected. Turn your head slightly and retry." };
    }

    if (motionRange < 8 && yawRange < 0.04 && blinkRange < 0.12 && smileRange < 0.12) {
      return { ok: false, reason: "Insufficient live motion detected. Move naturally and try again." };
    }

    return { ok: true as const };
  }

  if (!shouldShow) {
    if (verifyState && !verifyState.enrolled) {
      return (
        <div className="card">
          <p className="status-error">Face enrollment required before using groups and shares.</p>
          <Link className="nav-link" href="/enrollment">Complete enrollment</Link>
        </div>
      );
    }

    return null;
  }

  async function startCamera() {
    setError("");
    setMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);
      setChallenge(randomChallenge());
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "Failed to access camera");
    }
  }

  async function verifyFromFrame() {
    if (!videoRef.current) {
      return;
    }

    setIsVerifying(true);
    setError("");
    setMessage("");

    try {
      const probes = await captureBurst();
      const liveness = passesLivenessChallenge(probes);
      if (!liveness.ok) {
        setError(liveness.reason);
        return;
      }

      probes.sort((left, right) => right.qualityScore - left.qualityScore);
      const bestFace = probes[0];

      const response = await apiFetch("/api/v1/face/verify/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embedding: bestFace.embedding,
          qualityScore: bestFace.qualityScore,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Live verification failed");
        return;
      }

      setMessage("Verification complete.");
      setVerifyState({ enrolled: true, verified: true });
      setChallenge(randomChallenge());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Live verification failed");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="card">
      <h3>Live Face Check Required</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Complete a quick camera check to finish login for secure sharing access.
      </p>
      <p className="status-success" style={{ marginBottom: 10 }}>
        Challenge: {challenge === "blink" ? "Blink twice" : challenge === "smile" ? "Give a smile" : "Turn head slightly"}
      </p>
      <div className="verify-camera-shell">
        <video ref={videoRef} className="verify-video" playsInline muted />
      </div>
      <div className="row">
        <button type="button" onClick={() => void startCamera()} disabled={cameraReady || isVerifying}>
          {cameraReady ? "Camera Ready" : "Start Camera"}
        </button>
        <button
          className="btn-primary"
          type="button"
          onClick={() => void verifyFromFrame()}
          disabled={!cameraReady || isVerifying}
        >
          {isVerifying ? "Verifying..." : "Verify Live Face"}
        </button>
      </div>
      {error ? <p className="status-error">{error}</p> : null}
      {message ? <p className="status-success">{message}</p> : null}
    </div>
  );
}
