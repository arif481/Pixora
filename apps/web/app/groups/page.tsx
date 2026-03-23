"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Group } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [joinGroupId, setJoinGroupId] = useState("");
  const [error, setError] = useState("");
  const [isOpeningPersonal, setIsOpeningPersonal] = useState(false);

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

  async function joinGroup(event: FormEvent) {
    event.preventDefault();
    if (!joinGroupId.trim()) {
      return;
    }

    const response = await apiFetch("/api/v1/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: joinGroupId.trim() }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data?.error ?? "Failed to join group");
      return;
    }

    setJoinGroupId("");
    setError("");
    await loadGroups();
  }

  async function openPersonalGroup() {
    setIsOpeningPersonal(true);
    setError("");

    try {
      const response = await apiFetch("/api/v1/groups/personal", {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok || !data?.group?.id) {
        setError(data?.error ?? "Failed to open personal space");
        return;
      }

      router.push(`/groups/${data.group.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to open personal space");
    } finally {
      setIsOpeningPersonal(false);
    }
  }

  useEffect(() => {
    void loadGroups();
  }, []);

  return (
    <main>
      <div className="card">
        <h2>Your Groups</h2>
        {error ? <p className="status-error">{error}</p> : null}
        <div className="row" style={{ marginBottom: 10 }}>
          <button type="button" onClick={() => void openPersonalGroup()} disabled={isOpeningPersonal}>
            {isOpeningPersonal ? "Opening..." : "Quick Upload (Personal Space)"}
          </button>
        </div>
        <form className="row" onSubmit={onSubmit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name"
          />
          <button className="btn-primary" type="submit">Create Group</button>
        </form>
        <form className="row" onSubmit={joinGroup}>
          <input
            value={joinGroupId}
            onChange={(event) => setJoinGroupId(event.target.value)}
            placeholder="Join with Group ID"
          />
          <button type="submit">Join Group</button>
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
