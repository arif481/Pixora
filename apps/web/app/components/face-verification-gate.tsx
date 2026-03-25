"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/components/auth-provider";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";
import { cosineSimilarity } from "@/lib/embeddings";

type VerifyState = { enrolled: boolean; verified: boolean };
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
const CHALLENGE_LABELS: Record<VerifyChallenge, string> = {
  blink: "👁️ Blink twice",
  smile: "😊 Give a smile",
  turn: "↔️ Turn head slightly",
};

function fileFromDataUrl(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `live-verify-${Date.now()}.jpg`, { type: mime });
}

export function FaceVerificationGate() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { user, loading: authLoading } = useAuth();

  const [stateLoading, setStateLoading] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [challenge, setChallenge] = useState<VerifyChallenge>("blink");

  const isSignedIn = Boolean(user);

  useEffect(() => {
    if (!isSignedIn) {
      setVerifyState(null);
      return;
    }
    setStateLoading(true);
    void apiFetch("/api/v1/face/verify/status")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data?.error ?? "Failed to fetch verification status");
          return;
        }
        setVerifyState(data.verification ?? null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to fetch status")
      )
      .finally(() => setStateLoading(false));
  }, [isSignedIn]);

  useEffect(() => {
    return () => {
      if (streamRef.current)
        for (const t of streamRef.current.getTracks()) t.stop();
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
    if (!videoRef.current) return null;
    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight);
    const file = fileFromDataUrl(canvas.toDataURL("image/jpeg", 0.92));
    const faces = await detectBrowserFaces(file);
    if (faces.length === 0) return null;

    faces.sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h);
    const f = faces[0];
    return {
      embedding: f.embedding,
      qualityScore: f.qualityScore,
      blink: f.liveness.blink,
      smile: f.liveness.smile,
      yaw: f.liveness.yaw,
      centerX: f.bbox.x + f.bbox.w / 2,
      centerY: f.bbox.y + f.bbox.h / 2,
    };
  }

  async function captureBurst() {
    const probes: FaceProbe[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await captureProbe();
      if (p) probes.push(p);
      if (i < 4) await new Promise((r) => setTimeout(r, 220));
    }
    return probes;
  }

  function passesLivenessChallenge(probes: FaceProbe[]) {
    if (probes.length < 3)
      return {
        ok: false,
        reason: "Face not detected consistently. Keep your face centered.",
      };

    const qMin = Math.min(...probes.map((p) => p.qualityScore));
    if (qMin < 0.52)
      return {
        ok: false,
        reason: "Face quality is low. Improve lighting and try again.",
      };

    const base = probes[0];
    const sims = probes
      .slice(1)
      .map((p) => cosineSimilarity(base.embedding, p.embedding));
    if (sims.some((s) => s < 0.45))
      return {
        ok: false,
        reason: "Inconsistent face capture detected. Retry the challenge.",
      };

    const yaws = probes.map((p) => p.yaw);
    const blinks = probes.map((p) => p.blink);
    const smiles = probes.map((p) => p.smile);
    const cxs = probes.map((p) => p.centerX);
    const cys = probes.map((p) => p.centerY);

    const yRange = Math.max(...yaws) - Math.min(...yaws);
    const bRange = Math.max(...blinks) - Math.min(...blinks);
    const sRange = Math.max(...smiles) - Math.min(...smiles);
    const motion =
      Math.max(...cxs) - Math.min(...cxs) + (Math.max(...cys) - Math.min(...cys));

    const passed =
      challenge === "blink"
        ? Math.max(...blinks) >= 0.5 && bRange >= 0.2
        : challenge === "smile"
          ? Math.max(...smiles) >= 0.45 && sRange >= 0.18
          : Math.max(...yaws.map(Math.abs)) >= 0.09 && yRange >= 0.08;

    if (!passed) {
      const labels: Record<VerifyChallenge, string> = {
        blink: "Blink challenge not detected. Please blink clearly and retry.",
        smile: "Smile challenge not detected. Please smile naturally and retry.",
        turn: "Head turn not detected. Turn your head slightly and retry.",
      };
      return { ok: false, reason: labels[challenge] };
    }

    if (motion < 8 && yRange < 0.04 && bRange < 0.12 && sRange < 0.12)
      return {
        ok: false,
        reason: "Insufficient live motion. Move naturally and try again.",
      };

    return { ok: true as const };
  }

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to access camera");
    }
  }

  async function verifyFromFrame() {
    if (!videoRef.current) return;
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

      probes.sort((a, b) => b.qualityScore - a.qualityScore);
      const best = probes[0];

      const response = await apiFetch("/api/v1/face/verify/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embedding: best.embedding,
          qualityScore: best.qualityScore,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Live verification failed");
        return;
      }

      setMessage("Verification complete! You're all set.");
      setVerifyState({ enrolled: true, verified: true });
      setChallenge(randomChallenge());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Live verification failed");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="card card-accent">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🔐 Live Face Verification</h3>
        <span className="challenge-label">{CHALLENGE_LABELS[challenge]}</span>
      </div>
      <p className="muted text-sm" style={{ marginBottom: 16 }}>
        Complete a quick camera check to unlock sharing features for this session.
      </p>

      <div className="verify-camera-shell">
        <video ref={videoRef} className="verify-video" playsInline muted />
      </div>

      <div className="row">
        <button onClick={() => void startCamera()} disabled={cameraReady || isVerifying}>
          {cameraReady ? "✓ Camera Ready" : "🎥 Start Camera"}
        </button>
        <button
          className="btn-primary"
          onClick={() => void verifyFromFrame()}
          disabled={!cameraReady || isVerifying}
        >
          {isVerifying ? (
            <>
              <span className="spinner" /> Verifying…
            </>
          ) : (
            "Verify Now"
          )}
        </button>
      </div>

      {error && <p className="status-error" style={{ marginTop: 12 }}>{error}</p>}
      {message && <p className="status-success" style={{ marginTop: 12 }}>{message}</p>}
    </div>
  );
}
