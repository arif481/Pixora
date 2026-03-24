"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type ShareItem = {
  id: string;
  photoId: string;
  recipientUserId: string;
  status: string;
  createdAt: string;
  storageKey: string | null;
  groupId: string | null;
  signedUrl?: string;
};

export default function SharesPage() {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [error, setError] = useState("");
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadShares() {
      try {
        const response = await apiFetch("/api/v1/shares/me");
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "Failed to load shares");
          setShares([]);
          return;
        }
        setError("");
        const shareList: ShareItem[] = data.shares ?? [];
        setShares(shareList);

        // Fetch signed URLs for shares that have a groupId and photoId
        const withUrls = await Promise.all(
          shareList.map(async (share) => {
            if (!share.groupId || !share.photoId) return share;
            try {
              const res = await apiFetch(
                `/api/v1/groups/${share.groupId}/photos/${share.photoId}/signed-url`
              );
              if (res.ok) {
                const d = await res.json();
                return { ...share, signedUrl: d.url ?? undefined };
              }
            } catch {
              /* ignore */
            }
            return share;
          })
        );
        setShares(withUrls);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load shares");
      } finally {
        setLoading(false);
      }
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
      setShares((curr) => curr.filter((s) => s.id !== shareId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove share");
    } finally {
      setDeletingShareId(null);
    }
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  return (
    <>
      <div className="section-header">
        <h2>💜 Shared With Me</h2>
        <span className="badge badge-muted">{shares.length} photos</span>
      </div>

      <p className="muted text-sm" style={{ marginBottom: 20 }}>
        Photos auto-shared with you based on face matching appear here.
      </p>

      {error && (
        <p className="status-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="photo-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="photo-card" key={i}>
              <div className="photo-card-skeleton" />
            </div>
          ))}
        </div>
      ) : shares.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-icon">💜</span>
            <h3>Nothing Shared Yet</h3>
            <p>
              When someone uploads a photo with your face in it, it will
              automatically appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="photo-grid">
          {shares.map((share) => (
            <div className="photo-card" key={share.id}>
              {share.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={share.signedUrl}
                  alt="Shared photo"
                  onClick={() => setLightboxUrl(share.signedUrl ?? null)}
                  loading="lazy"
                />
              ) : (
                <div className="photo-card-skeleton" />
              )}
              <div className="photo-card-overlay">
                <span className="dim text-xs">{formatDate(share.createdAt)}</span>
                <button
                  className="btn-icon btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeShare(share.id);
                  }}
                  disabled={deletingShareId === share.id}
                  title="Remove access"
                >
                  {deletingShareId === share.id ? "…" : "✕"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxUrl} alt="Full size" />
            <button
              className="lightbox-close"
              onClick={() => setLightboxUrl(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
