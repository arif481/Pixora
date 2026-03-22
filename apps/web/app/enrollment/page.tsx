"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export default function EnrollmentPage() {
  const [imageUrl, setImageUrl] = useState("https://example.com/selfie.jpg");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");

  async function startEnrollment(event: FormEvent) {
    event.preventDefault();
    setResult("");

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
      body: JSON.stringify({ sessionId: sessionData.sessionId, imageUrl }),
    });

    const completeData = await complete.json();
    if (!complete.ok) {
      setResult(completeData?.error ?? "Enrollment failed");
      return;
    }

    setResult(completeData.status ?? "done");
  }

  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Face Verification Enrollment</h2>
        <p>This verifies identity for automatic face-based sharing.</p>
        <form className="row" onSubmit={startEnrollment}>
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
          <button type="submit">Enroll Face</button>
        </form>
        {sessionId ? <p><strong>Session:</strong> {sessionId}</p> : null}
        {result ? <p><strong>Result:</strong> {result}</p> : null}
      </div>
    </main>
  );
}
