"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Photo } from "@/lib/types";

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const [groupId, setGroupId] = useState<string>("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [filename, setFilename] = useState("group-photo.jpg");

  async function loadPhotos(id: string) {
    const response = await fetch(`/api/v1/groups/${id}/photos`);
    const data = await response.json();
    setPhotos(data.photos ?? []);
  }

  async function registerPhoto(event: FormEvent) {
    event.preventDefault();
    if (!groupId) return;

    const uploadUrlResponse = await fetch(`/api/v1/groups/${groupId}/photos/upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, contentType: "image/jpeg", size: 123456 }),
    });

    const uploadUrlData = await uploadUrlResponse.json();

    await fetch(`/api/v1/groups/${groupId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storageKey: uploadUrlData.storageKey,
      }),
    });

    await loadPhotos(groupId);
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
        <form className="row" onSubmit={registerPhoto}>
          <input
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            placeholder="filename.jpg"
          />
          <button type="submit">Register Upload</button>
        </form>
        <p style={{ marginBottom: 0 }}>
          This starter registers uploads and queues processing; wire real object upload next.
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
