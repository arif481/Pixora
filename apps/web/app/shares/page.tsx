"use client";

import { useEffect, useState } from "react";
import { Share } from "@/lib/types";

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([]);

  useEffect(() => {
    async function loadShares() {
      const response = await fetch("/api/v1/shares/me");
      const data = await response.json();
      setShares(data.shares ?? []);
    }

    void loadShares();
  }, []);

  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Shared With Me</h2>
        <p>Photos auto-shared based on face matching appear here.</p>
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
