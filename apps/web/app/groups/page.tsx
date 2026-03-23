"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Group } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function loadGroups() {
    const response = await apiFetch("/api/v1/groups");
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error ?? "Failed to load groups");
      setGroups([]);
      return;
    }
    setError("");
    setGroups(data.groups ?? []);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    const response = await apiFetch("/api/v1/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data?.error ?? "Failed to create group");
      return;
    }

    setName("");
    setError("");
    await loadGroups();
  }

  useEffect(() => {
    void loadGroups();
  }, []);

  return (
    <main>
      <div className="card">
        <h2>Your Groups</h2>
        {error ? <p className="status-error">{error}</p> : null}
        <form className="row" onSubmit={onSubmit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name"
          />
          <button className="btn-primary" type="submit">Create Group</button>
        </form>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No groups yet. Create your first group to start uploading photos.
          </p>
        </div>
      ) : null}

      {groups.map((group) => (
        <div className="card" key={group.id}>
          <h3>{group.name}</h3>
          <Link className="nav-link" href={`/groups/${group.id}`}>Open Group</Link>
        </div>
      ))}
    </main>
  );
}
