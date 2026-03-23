"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";
import { BROWSER_FACE_MODEL_VERSION } from "@/lib/face-model";

export default function EnrollmentPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function startEnrollment(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile) {
      setResult("Please select a selfie image first.");
      return;
    }

    setIsSubmitting(true);
    setResult("");

    try {
      const faces = await detectBrowserFaces(selectedFile);
      if (faces.length === 0) {
        setResult("No face detected. Try a clearer selfie.");
        return;
      }

      faces.sort(
        (left, right) => right.bbox.w * right.bbox.h - left.bbox.w * left.bbox.h
      );

      const bestFace = faces[0];
      const flags: string[] = [];
      if (faces.length > 1) {
        flags.push("multiple-faces-detected");
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
          embedding: bestFace.embedding,
          qualityScore: bestFace.qualityScore,
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
        <h2 style={{ marginTop: 0 }}>Face Verification Enrollment</h2>
        <p>This verifies identity for automatic face-based sharing using on-device face analysis.</p>
        <form className="row" onSubmit={startEnrollment}>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={!selectedFile || isSubmitting}>
            {isSubmitting ? "Processing..." : "Enroll Face"}
          </button>
        </form>
        {sessionId ? <p><strong>Session:</strong> {sessionId}</p> : null}
        {result ? <p><strong>Result:</strong> {result}</p> : null}
      </div>
    </main>
  );
}
