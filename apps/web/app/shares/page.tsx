"use client";

import { useEffect, useState } from "react";
import { Share } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadShares() {
      const response = await apiFetch("/api/v1/shares/me");
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Failed to load shares");
        setShares([]);
        return;
      }

      setError("");
      setShares(data.shares ?? []);
    }

    void loadShares();
  }, []);

  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Shared With Me</h2>
        <p>Photos auto-shared based on face matching appear here.</p>
        {error ? <p style={{ color: "#e35d6a" }}>{error}</p> : null}
      </div>
      {shares.map((share) => (
        <div className="card" key={share.id}>
          <p><strong>Share:</strong> {share.id}</p>
          <p><strong>Photo:</strong> {share.photoId}</p>
          <p><strong>Status:</strong> {share.status}</p>
        </div>
      ))}
    </main>
  );
}
