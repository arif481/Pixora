"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Photo } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";
import { detectBrowserFaces } from "@/lib/browser-face";

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const [groupId, setGroupId] = useState<string>("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  async function loadPhotos(id: string) {
    const response = await apiFetch(`/api/v1/groups/${id}/photos`);
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error ?? "Failed to load photos");
      setPhotos([]);
      return;
    }

    setError("");
    setPhotos(data.photos ?? []);
  }

  async function deletePhoto(photoId: string) {
    if (!groupId) {
      return;
    }

    const confirmed = window.confirm("Delete this photo and its associated shares?");
    if (!confirmed) {
      return;
    }

    setDeletingPhotoId(photoId);
    try {
      const response = await apiFetch(`/api/v1/groups/${groupId}/photos/${photoId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data?.error ?? "Failed to delete photo");
        return;
      }

      setError("");
      await loadPhotos(groupId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to delete photo");
    } finally {
      setDeletingPhotoId(null);
    }
  }

  async function registerPhoto(event: FormEvent) {
    event.preventDefault();
    if (!groupId || !selectedFile) return;

    setIsUploading(true);

    try {
      const faces = await detectBrowserFaces(selectedFile);

      const uploadUrlResponse = await apiFetch(`/api/v1/groups/${groupId}/photos/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type || "application/octet-stream",
          size: selectedFile.size,
        }),
      });

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

      const registerResponse = await apiFetch(`/api/v1/groups/${groupId}/photos`, {
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
      });

      if (!registerResponse.ok) {
        const registerData = await registerResponse.json();
        setError(registerData?.error ?? "Failed to register photo");
        return;
      }

      setSelectedFile(null);
      setError("");
      await loadPhotos(groupId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to process image");
    } finally {
      setIsUploading(false);
    }
  }

  useEffect(() => {
    if (!params.groupId) {
      return;
    }

    setGroupId(params.groupId);
    void loadPhotos(params.groupId);
  }, [params.groupId]);

  return (
    <main>
      <div className="card">
        <h2>Group Upload</h2>
        {error ? <p className="status-error">{error}</p> : null}
        <form className="row" onSubmit={registerPhoto}>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button className="btn-primary" type="submit" disabled={!selectedFile || isUploading}>
            {isUploading ? "Processing..." : "Upload & Register"}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Select an image file to upload into storage. Face features are extracted on-device.
        </p>
      </div>

      {photos.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>No photos yet in this group.</p>
        </div>
      ) : null}

      {photos.map((photo) => (
        <div className="card" key={photo.id}>
          <p><strong>Photo:</strong> {photo.id}</p>
          <p><strong>Status:</strong> {photo.status}</p>
          <p><strong>Key:</strong> {photo.storageKey}</p>
          <div className="row">
            <button
              type="button"
              onClick={() => void deletePhoto(photo.id)}
              disabled={deletingPhotoId === photo.id}
            >
              {deletingPhotoId === photo.id ? "Deleting..." : "Delete Photo"}
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
