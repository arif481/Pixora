"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Photo } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";

type PhotoWithUrl = Photo & { signedUrl?: string };

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [groupId, setGroupId] = useState("");
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fetchSignedUrls = useCallback(
    async (photoList: Photo[], gid: string) => {
      const withUrls: PhotoWithUrl[] = await Promise.all(
        photoList.map(async (photo) => {
          try {
            const res = await apiFetch(
              `/api/v1/groups/${gid}/photos/${photo.id}/signed-url`
            );
            if (res.ok) {
              const data = await res.json();
              return { ...photo, signedUrl: data.url ?? undefined };
            }
          } catch {
            /* ignore */
          }
          return { ...photo };
        })
      );
      setPhotos(withUrls);
    },
    []
  );

  async function loadPhotos(id: string) {
    const response = await apiFetch(`/api/v1/groups/${id}/photos`);
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error ?? "Failed to load photos");
      setPhotos([]);
      return;
    }
    setError("");
    const photoList: Photo[] = data.photos ?? [];
    setPhotos(photoList);
    // Fetch signed URLs in background
    void fetchSignedUrls(photoList, id);
  }

  async function deletePhoto(photoId: string) {
    if (!groupId) return;
    const confirmed = window.confirm(
      "Delete this photo and its associated shares?"
    );
    if (!confirmed) return;

    setDeletingPhotoId(photoId);
    try {
      const response = await apiFetch(
        `/api/v1/groups/${groupId}/photos/${photoId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error ?? "Failed to delete photo");
        return;
      }
      setError("");
      await loadPhotos(groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete photo");
    } finally {
      setDeletingPhotoId(null);
    }
  }

  async function registerPhoto(event: FormEvent) {
    event.preventDefault();
    if (!groupId || !selectedFile) return;
    setIsUploading(true);
    setError("");

    try {
      const faces = await detectBrowserFaces(selectedFile);

      const uploadUrlResponse = await apiFetch(
        `/api/v1/groups/${groupId}/photos/upload-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: selectedFile.name,
            contentType: selectedFile.type || "application/octet-stream",
            size: selectedFile.size,
          }),
        }
      );
      const uploadUrlData = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok) {
        setError(uploadUrlData?.error ?? "Failed to create upload URL");
        return;
      }

      const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": selectedFile.type || "application/octet-stream",
        },
        body: selectedFile,
      });
      if (!uploadResponse.ok) {
        setError("Failed to upload file to storage");
        return;
      }

      const registerResponse = await apiFetch(
        `/api/v1/groups/${groupId}/photos`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            storageKey: uploadUrlData.storageKey,
            precomputedFaces: faces.map((face) => ({
              bboxX: face.bbox.x,
              bboxY: face.bbox.y,
              bboxW: face.bbox.w,
              bboxH: face.bbox.h,
              qualityScore: face.qualityScore,
              embedding: face.embedding,
            })),
          }),
        }
      );

      if (!registerResponse.ok) {
        const registerData = await registerResponse.json();
        setError(registerData?.error ?? "Failed to register photo");
        return;
      }

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setError("");
      await loadPhotos(groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process image");
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
    }
  }

  useEffect(() => {
    if (!params.groupId) return;
    setGroupId(params.groupId);
    void loadPhotos(params.groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.groupId]);

  return (
    <>
      <div className="section-header">
        <h2>📁 Group Photos</h2>
        <span className="badge badge-muted">{photos.length} photos</span>
      </div>

      {error && (
        <p className="status-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {/* Upload Zone */}
      <form onSubmit={registerPhoto}>
        <div
          className={`upload-zone ${dragActive ? "active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="upload-icon">
            {isUploading ? "⏳" : selectedFile ? "🖼️" : "📤"}
          </span>
          <p>
            {isUploading
              ? "Analyzing faces & uploading…"
              : selectedFile
                ? selectedFile.name
                : "Drop an image here or click to browse"}
          </p>
          <span className="upload-hint">
            Face detection happens on-device before upload
          </span>

          {isUploading && (
            <div
              className="progress-bar"
              style={{ maxWidth: 200, margin: "12px auto 0" }}
            >
              <div
                className="progress-fill"
                style={{
                  width: "60%",
                  animation: "shimmer 1.5s ease infinite",
                }}
              />
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
        />

        {selectedFile && !isUploading && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn-primary"
              type="submit"
              style={{ flex: 1 }}
            >
              Upload &amp; Process
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </form>

      {/* Photo Grid */}
      {photos.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="empty-state">
            <span className="empty-icon">🖼️</span>
            <h3>No Photos Yet</h3>
            <p>Upload your first photo above. Faces will be detected and matched automatically.</p>
          </div>
        </div>
      ) : (
        <div className="photo-grid" style={{ marginTop: 16 }}>
          {photos.map((photo) => (
            <div className="photo-card" key={photo.id}>
              {photo.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.signedUrl}
                  alt="Photo"
                  onClick={() => setLightboxUrl(photo.signedUrl ?? null)}
                  loading="lazy"
                />
              ) : (
                <div className="photo-card-skeleton" />
              )}
              <div className="photo-card-overlay">
                <span className={`badge ${photo.status === "processed" ? "badge-success" : photo.status === "failed" ? "badge-danger" : "badge-muted"}`}>
                  {photo.status}
                </span>
                <button
                  className="btn-icon btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deletePhoto(photo.id);
                  }}
                  disabled={deletingPhotoId === photo.id}
                  title="Delete photo"
                >
                  {deletingPhotoId === photo.id ? "…" : "✕"}
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
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
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
