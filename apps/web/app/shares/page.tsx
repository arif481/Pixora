"use client";

import { useEffect, useState } from "react";
import { Share } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState("");
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);

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

  async function removeShare(shareId: string) {
    setDeletingShareId(shareId);

    try {
      const response = await apiFetch(`/api/v1/shares/${shareId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data?.error ?? "Failed to remove share");
        return;
      }

      setError("");
      setShares((current) => current.filter((share) => share.id !== shareId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to remove share");
    } finally {
      setDeletingShareId(null);
    }
  }

  return (
    <main>
      <div className="card">
        <h2>Shared With Me</h2>
        <p className="muted">Photos auto-shared based on face matching appear here.</p>
        {error ? <p className="status-error">{error}</p> : null}
      </div>

      {shares.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Nothing shared yet. Upload photos in a group and run processing.
          </p>
        </div>
      ) : null}

      {shares.map((share) => (
        <div className="card" key={share.id}>
          <p><strong>Share:</strong> {share.id}</p>
          <p><strong>Photo:</strong> {share.photoId}</p>
          <p><strong>Status:</strong> {share.status}</p>
          <div className="row">
            <button
              type="button"
              onClick={() => void removeShare(share.id)}
              disabled={deletingShareId === share.id}
            >
              {deletingShareId === share.id ? "Removing..." : "Remove Access"}
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
