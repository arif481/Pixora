"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";
import { BROWSER_FACE_MODEL_VERSION } from "@/lib/face-model";
import { cosineSimilarity } from "@/lib/embeddings";

const MIN_ENROLL_IMAGE_QUALITY = 0.5;

function fileFromDataUrl(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], `enroll-selfie-${Date.now()}.jpg`, { type: mime });
}

export default function EnrollmentPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

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
    } catch (cameraError) {
      setResult(cameraError instanceof Error ? cameraError.message : "Failed to access camera");
    }
  }

  function captureSnapshot() {
    if (!videoRef.current) {
      return;
    }

    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      setResult("Camera is not ready yet");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      setResult("Failed to capture snapshot");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const file = fileFromDataUrl(canvas.toDataURL("image/jpeg", 0.92));

    setSelectedFiles((current) => {
      if (current.length >= 5) {
        return current;
      }

      return [...current, file];
    });
  }

  function clearCaptured() {
    setSelectedFiles([]);
  }

  async function startEnrollment(event: FormEvent) {
    event.preventDefault();
    if (selectedFiles.length !== 5) {
      setResult("Please select exactly 5 clear selfies.");
      return;
    }

    setIsSubmitting(true);
    setResult("");

    try {
      const embeddings: number[][] = [];
      const qualityScores: number[] = [];
      const flags: string[] = [];

      for (const file of selectedFiles) {
        const faces = await detectBrowserFaces(file);
        if (faces.length === 0) {
          setResult(`No face detected in ${file.name}. Try a clearer selfie.`);
          return;
        }

        faces.sort(
          (left, right) => right.bbox.w * right.bbox.h - left.bbox.w * left.bbox.h
        );

        const bestFace = faces[0];

        if (bestFace.qualityScore < MIN_ENROLL_IMAGE_QUALITY) {
          setResult(`Low quality face in ${file.name}. Use better lighting and retry.`);
          return;
        }

        embeddings.push(bestFace.embedding);
        qualityScores.push(bestFace.qualityScore);

        if (faces.length > 1) {
          flags.push(`multiple-faces-detected:${file.name}`);
        }
      }

      const avgQualityScore =
        qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;

      let minPairSimilarity = 1;
      for (let left = 0; left < embeddings.length; left += 1) {
        for (let right = left + 1; right < embeddings.length; right += 1) {
          minPairSimilarity = Math.min(
            minPairSimilarity,
            cosineSimilarity(embeddings[left], embeddings[right])
          );
        }
      }

      if (minPairSimilarity < 0.25) {
        setResult("Enrollment images are too inconsistent. Use 5 selfies of the same person.");
        return;
      }

      const consent = await apiFetch("/api/v1/me/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biometricConsent: true, version: "2026-03" }),
      });

      if (!consent.ok) {
        const payload = await consent.json();
        setResult(payload?.error ?? "Consent failed");
        return;
      }

      const sessionResponse = await apiFetch("/api/v1/face/enrollment/session", {
        method: "POST",
      });

      if (!sessionResponse.ok) {
        const payload = await sessionResponse.json();
        setResult(payload?.error ?? "Failed to create enrollment session");
        return;
      }

      const sessionData = await sessionResponse.json();
      setSessionId(sessionData.sessionId);

      const complete = await apiFetch("/api/v1/face/enrollment/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionData.sessionId,
          embeddings,
          qualityScore: avgQualityScore,
          flags,
          modelVersion: BROWSER_FACE_MODEL_VERSION,
        }),
      });

      const completeData = await complete.json();
      if (!complete.ok) {
        setResult(completeData?.error ?? "Enrollment failed");
        return;
      }

      setResult(completeData.status ?? "done");
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Enrollment failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <div className="card">
        <h2>Face Verification Enrollment</h2>
        <p className="muted">Use live camera snapshots or upload 5 clear selfies to build your face profile.</p>
        <form className="row" onSubmit={startEnrollment}>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []).slice(0, 5))}
          />
          <button className="btn-primary" type="submit" disabled={selectedFiles.length !== 5 || isSubmitting}>
            {isSubmitting ? "Processing..." : "Enroll Face"}
          </button>
        </form>
        <div className="verify-camera-shell" style={{ marginTop: 10 }}>
          <video ref={videoRef} className="verify-video" playsInline muted />
        </div>
        <div className="row">
          <button type="button" onClick={() => void startCamera()} disabled={cameraReady}>
            {cameraReady ? "Camera Ready" : "Start Camera"}
          </button>
          <button type="button" onClick={captureSnapshot} disabled={!cameraReady || selectedFiles.length >= 5}>
            Capture Selfie
          </button>
          <button type="button" onClick={clearCaptured} disabled={selectedFiles.length === 0}>
            Clear Selection
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Selected: {selectedFiles.length}/5 images
        </p>
        {sessionId ? (
          <p>
            <strong>Session:</strong> {sessionId}
          </p>
        ) : null}
        {result ? (
          <p className={result.toLowerCase().includes("fail") ? "status-error" : "status-success"}>{result}</p>
        ) : null}
      </div>
    </main>
  );
}
