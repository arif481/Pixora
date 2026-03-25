"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces, filterOutlierEmbeddings } from "@/lib/browser-face";
import { BROWSER_FACE_MODEL_VERSION } from "@/lib/face-model";
import { cosineSimilarity } from "@/lib/embeddings";

const MIN_ENROLL_IMAGE_QUALITY = 0.5;

type EnrollStep = "intro" | "capture" | "processing" | "done";

function fileFromDataUrl(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `enroll-selfie-${Date.now()}.jpg`, { type: mime });
}

export default function EnrollmentPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<EnrollStep>("intro");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
      }
      previews.forEach(URL.revokeObjectURL);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFile(file: File) {
    setSelectedFiles((curr) => {
      if (curr.length >= 5) return curr;
      const next = [...curr, file];
      setPreviews((pv) => [...pv, URL.createObjectURL(file)]);
      return next;
    });
  }

  async function startCamera() {
    setResult("");
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
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to access camera");
    }
  }

  function captureSnapshot() {
    if (!videoRef.current) return;
    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) {
      setResult("Camera is not ready yet");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    addFile(fileFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)));
  }

  function clearCaptured() {
    previews.forEach(URL.revokeObjectURL);
    setSelectedFiles([]);
    setPreviews([]);
  }

  async function startEnrollment(event: FormEvent) {
    event.preventDefault();
    if (selectedFiles.length !== 5) {
      setResult("Please capture or upload exactly 5 clear selfies.");
      return;
    }

    setIsSubmitting(true);
    setResult("");
    setStep("processing");
    setProgress(5);

    try {
      const embeddings: number[][] = [];
      const qualityScores: number[] = [];
      const flags: string[] = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        setProgress(10 + (i / 5) * 50);
        const faces = await detectBrowserFaces(selectedFiles[i]);
        if (faces.length === 0) {
          setResult(`No face detected in image ${i + 1}. Try a clearer selfie.`);
          setStep("capture");
          return;
        }
        faces.sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h);
        const best = faces[0];
        if (best.qualityScore < MIN_ENROLL_IMAGE_QUALITY) {
          setResult(`Low quality face in image ${i + 1}. Use better lighting.`);
          setStep("capture");
          return;
        }
        embeddings.push(best.embedding);
        qualityScores.push(best.qualityScore);
        if (faces.length > 1) flags.push(`multiple-faces:image-${i + 1}`);
      }

      setProgress(65);
      const avgQuality = qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length;

      // Outlier filtering: remove the most dissimilar embedding
      const filteredEmbeddings = filterOutlierEmbeddings(embeddings);

      let minSim = 1;
      for (let a = 0; a < filteredEmbeddings.length; a++) {
        for (let b = a + 1; b < filteredEmbeddings.length; b++) {
          minSim = Math.min(minSim, cosineSimilarity(filteredEmbeddings[a], filteredEmbeddings[b]));
        }
      }
      if (minSim < 0.25) {
        setResult("Images are too inconsistent. Use 5 selfies of the same person.");
        setStep("capture");
        return;
      }

      setProgress(70);
      const consent = await apiFetch("/api/v1/me/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biometricConsent: true, version: "2026-03" }),
      });
      if (!consent.ok) {
        const p = await consent.json();
        setResult(p?.error ?? "Consent failed");
        setStep("capture");
        return;
      }

      setProgress(80);
      let sessionData: { sessionId: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const sessionRes = await apiFetch("/api/v1/face/enrollment/session", { method: "POST" });
        if (sessionRes.ok) {
          sessionData = await sessionRes.json();
          break;
        }
        if (attempt === 0) {
          // Retry once after a brief pause
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const p = await sessionRes.json();
        setResult(p?.error ?? "Failed to create enrollment session. Please try again.");
        setStep("capture");
        return;
      }

      if (!sessionData?.sessionId) {
        setResult("Failed to create enrollment session. Please try again.");
        setStep("capture");
        return;
      }

      setProgress(90);
      const complete = await apiFetch("/api/v1/face/enrollment/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionData.sessionId,
          embeddings: filteredEmbeddings,
          qualityScore: avgQuality,
          flags,
          modelVersion: BROWSER_FACE_MODEL_VERSION,
        }),
      });
      const completeData = await complete.json();
      if (!complete.ok) {
        setResult(completeData?.error ?? "Enrollment failed");
        setStep("capture");
        return;
      }

      setProgress(100);
      setStep("done");
      setResult("Face enrollment complete! You can now verify and start sharing.");
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Enrollment failed");
      setStep("capture");
    } finally {
      setIsSubmitting(false);
    }
  }

  const stepIndex = step === "intro" ? 0 : step === "capture" ? 1 : step === "processing" ? 2 : 3;

  return (
    <>
      <div className="section-header">
        <h2>Face Enrollment</h2>
        <span className="badge badge-accent">
          {selectedFiles.length}/5 selfies
        </span>
      </div>

      {/* Step indicator */}
      <div className="enroll-steps">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`enroll-step ${i < stepIndex ? "done" : i === stepIndex ? "active" : ""}`}
          />
        ))}
      </div>

      {/* ── Intro Step ── */}
      {step === "intro" && (
        <div className="card card-accent" style={{ textAlign: "center", padding: "40px 24px" }}>
          <span style={{ fontSize: 48, display: "block", marginBottom: 16 }}>🤳</span>
          <h2>Set Up Your Face Profile</h2>
          <p className="muted" style={{ maxWidth: 460, margin: "8px auto 24px" }}>
            Take 5 selfies using your camera or upload clear photos.
            Your face data is processed entirely in your browser — nothing leaves your device during detection.
          </p>
          <button className="btn-primary" onClick={() => setStep("capture")}
            style={{ padding: "14px 32px", fontSize: 15 }}>
            Begin Enrollment
          </button>
        </div>
      )}

      {/* ── Capture Step ── */}
      {step === "capture" && (
        <>
          <div className="card">
            <h3>📸 Capture Selfies</h3>
            <p className="muted text-sm" style={{ marginBottom: 16 }}>
              Use the camera for live selfies or upload images. You need exactly 5 clear photos.
            </p>

            <div className="verify-camera-shell">
              <video ref={videoRef} className="verify-video" playsInline muted />
            </div>

            <div className="row" style={{ marginBottom: 16 }}>
              <button onClick={() => void startCamera()} disabled={cameraReady}>
                {cameraReady ? "✓ Camera Ready" : "🎥 Start Camera"}
              </button>
              <button
                className="btn-primary"
                onClick={captureSnapshot}
                disabled={!cameraReady || selectedFiles.length >= 5}
              >
                📷 Capture
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={selectedFiles.length >= 5}>
                📁 Upload Files
              </button>
              <button className="btn-danger btn-sm" onClick={clearCaptured} disabled={selectedFiles.length === 0}>
                ✕ Clear All
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []).slice(0, 5 - selectedFiles.length);
                files.forEach(addFile);
              }}
            />

            {/* Selfie thumbnails */}
            <div className="selfie-strip">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className={`selfie-thumb ${i < previews.length ? "filled" : ""}`}>
                  {i < previews.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previews[i]} alt={`Selfie ${i + 1}`} />
                  ) : (
                    <span className="selfie-placeholder">{i + 1}</span>
                  )}
                </div>
              ))}
            </div>

            {result && (
              <p className={result.toLowerCase().includes("fail") || result.toLowerCase().includes("low") || result.toLowerCase().includes("no face") || result.toLowerCase().includes("inconsistent") ? "status-error" : "status-success"} style={{ marginTop: 12 }}>
                {result}
              </p>
            )}
          </div>

          <form onSubmit={startEnrollment}>
            <button
              className="btn-primary"
              type="submit"
              disabled={selectedFiles.length !== 5 || isSubmitting}
              style={{ width: "100%", padding: 14, fontSize: 15 }}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" /> Processing...
                </>
              ) : (
                "Complete Enrollment"
              )}
            </button>
          </form>
        </>
      )}

      {/* ── Processing Step ── */}
      {step === "processing" && (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <span className="spinner" style={{ width: 40, height: 40, marginBottom: 20 }} />
          <h3>Analyzing Your Face Data</h3>
          <p className="muted text-sm" style={{ marginBottom: 20 }}>
            Processing embeddings and setting up your profile…
          </p>
          <div className="progress-bar" style={{ maxWidth: 360, margin: "0 auto" }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="dim text-sm" style={{ marginTop: 8 }}>{Math.round(progress)}%</p>
        </div>
      )}

      {/* ── Done Step ── */}
      {step === "done" && (
        <div className="card card-accent" style={{ textAlign: "center", padding: "48px 24px" }}>
          <span style={{ fontSize: 56, display: "block", marginBottom: 16 }}>✅</span>
          <h2>Enrollment Complete!</h2>
          <p className="muted" style={{ maxWidth: 400, margin: "8px auto 24px" }}>
            Your face profile is ready. Any photos uploaded before you enrolled have been scanned — check Shared With Me.
          </p>
          <div className="row" style={{ justifyContent: "center", gap: 12 }}>
            <Link className="btn-primary" href="/groups" style={{
              padding: "12px 24px", borderRadius: 10, textDecoration: "none",
              display: "inline-flex", fontWeight: 600,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "#fff", border: "none"
            }}>
              Go to Groups
            </Link>
            <a href="/shares" style={{
              padding: "12px 24px", borderRadius: 10, textDecoration: "none",
              display: "inline-flex", fontWeight: 600, border: "1px solid var(--border)",
              background: "var(--bg-elevated)", color: "var(--text)"
            }}>
              View Shared Photos
            </a>
          </div>
        </div>
      )}
    </>
  );
}
