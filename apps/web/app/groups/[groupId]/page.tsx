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
        <h2 style={{ marginTop: 0 }}>Group Upload</h2>
        {error ? <p style={{ color: "#e35d6a" }}>{error}</p> : null}
        <form className="row" onSubmit={registerPhoto}>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button type="submit" disabled={!selectedFile || isUploading}>
            {isUploading ? "Processing..." : "Upload & Register"}
          </button>
        </form>
        <p style={{ marginBottom: 0 }}>
          Select an image file to upload into storage. Face features are extracted on-device.
        </p>
      </div>

      {photos.map((photo) => (
        <div className="card" key={photo.id}>
          <p><strong>Photo:</strong> {photo.id}</p>
          <p><strong>Status:</strong> {photo.status}</p>
          <p><strong>Key:</strong> {photo.storageKey}</p>
        </div>
      ))}
    </main>
  );
}
