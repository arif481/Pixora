"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Group } from "@/lib/types";

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");

  async function loadGroups() {
    const response = await fetch("/api/v1/groups");
    const data = await response.json();
    setGroups(data.groups ?? []);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    await fetch("/api/v1/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

    setName("");
    await loadGroups();
  }

  useEffect(() => {
    void loadGroups();
  }, []);

  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your Groups</h2>
        <form className="row" onSubmit={onSubmit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name"
          />
          <button type="submit">Create Group</button>
        </form>
      </div>

      {groups.map((group) => (
        <div className="card" key={group.id}>
          <h3 style={{ marginTop: 0 }}>{group.name}</h3>
          <Link href={`/groups/${group.id}`}>Open Group</Link>
        </div>
      ))}
    </main>
  );
}
