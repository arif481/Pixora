"use client";

import { FormEvent, useState } from "react";

export default function EnrollmentPage() {
  const [imageUrl, setImageUrl] = useState("https://example.com/selfie.jpg");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");

  async function startEnrollment(event: FormEvent) {
    event.preventDefault();

    const consent = await fetch("/api/v1/me/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ biometricConsent: true, version: "2026-03" }),
    });

    if (!consent.ok) {
      setResult("Consent failed");
      return;
    }

    const sessionResponse = await fetch("/api/v1/face/enrollment/session", {
      method: "POST",
    });

    const sessionData = await sessionResponse.json();
    setSessionId(sessionData.sessionId);

    const complete = await fetch("/api/v1/face/enrollment/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionData.sessionId, imageUrl }),
    });

    const completeData = await complete.json();
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
