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
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

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
    setIsCreating(true);
    const response = await apiFetch("/api/v1/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data?.error ?? "Failed to create group");
      setIsCreating(false);
      return;
    }
    setName("");
    setError("");
    setIsCreating(false);
    await loadGroups();
  }

  async function joinGroup(event: FormEvent) {
    event.preventDefault();
    if (!joinGroupId.trim()) return;
    setIsJoining(true);
    const response = await apiFetch("/api/v1/groups/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: joinGroupId.trim() }),
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data?.error ?? "Failed to join group");
      setIsJoining(false);
      return;
    }
    setJoinGroupId("");
    setError("");
    setIsJoining(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open personal space");
    } finally {
      setIsOpeningPersonal(false);
    }
  }

  useEffect(() => {
    void loadGroups();
  }, []);

  return (
    <>
      <div className="section-header">
        <h2>Your Groups</h2>
        <span className="badge badge-muted">{groups.length} groups</span>
      </div>

      {error && <p className="status-error" style={{ marginBottom: 16 }}>{error}</p>}

      {/* Quick Actions */}
      <div className="card card-accent" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 28 }}>✨</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Quick Upload</p>
          <p className="muted text-sm" style={{ margin: 0 }}>
            Jump into your personal memory vault to upload photos instantly.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => void openPersonalGroup()}
          disabled={isOpeningPersonal}
        >
          {isOpeningPersonal ? (
            <><span className="spinner" /> Opening…</>
          ) : (
            "Open Personal Space"
          )}
        </button>
      </div>

      {/* Create & Join */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div className="card">
          <h3>➕ Create Group</h3>
          <form className="form-row" onSubmit={onSubmit} style={{ gap: 8 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
            />
            <button className="btn-primary" type="submit" disabled={!name.trim() || isCreating}>
              {isCreating ? <><span className="spinner" /> Creating…</> : "Create"}
            </button>
          </form>
        </div>

        <div className="card">
          <h3>🔗 Join Group</h3>
          <form className="form-row" onSubmit={joinGroup} style={{ gap: 8 }}>
            <input
              value={joinGroupId}
              onChange={(e) => setJoinGroupId(e.target.value)}
              placeholder="Paste Group ID"
            />
            <button type="submit" disabled={!joinGroupId.trim() || isJoining}>
              {isJoining ? <><span className="spinner" /> Joining…</> : "Join"}
            </button>
          </form>
        </div>
      </div>

      {/* Group List */}
      {groups.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-icon">📂</span>
            <h3>No Groups Yet</h3>
            <p>Create your first group above or use Quick Upload to start sharing photos.</p>
          </div>
        </div>
      ) : (
        groups.map((group) => (
          <div className="card" key={group.id}>
            <div className="group-card">
              <div className="group-info">
                <h3>📁 {group.name}</h3>
                <p className="dim text-sm" style={{ margin: 0 }}>
                  ID: {group.id.slice(0, 8)}…
                </p>
              </div>
              <Link
                href={`/groups/${group.id}`}
                style={{
                  padding: "8px 20px",
                  borderRadius: 10,
                  background: "var(--accent-glow)",
                  border: "1px solid var(--border-hover)",
                  color: "var(--accent-strong)",
                  fontWeight: 600,
                  fontSize: 13,
                  textDecoration: "none",
                  transition: "var(--transition)",
                }}
              >
                Open →
              </Link>
            </div>
          </div>
        ))
      )}
    </>
  );
}
