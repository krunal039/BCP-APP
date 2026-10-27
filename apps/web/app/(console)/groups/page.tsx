"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { PublicGroup } from "@bcp/shared";
import { ApiError, api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ui } from "../../../lib/styles";

export default function GroupsPage() {
  const { token, canAdmin } = useAuth();
  const [items, setItems] = useState<PublicGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.listGroups(token, { page: 1 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load groups");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !canAdmin) return;
    try {
      await api.createGroup(token, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Groups</h1>
      <p style={ui.muted}>Distribution lists used at compose / send time.</p>

      {canAdmin ? (
        <form onSubmit={onCreate} style={ui.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Create group</h2>
          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <div>
              <label style={ui.label}>Name</label>
              <input
                style={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={ui.label}>Description</label>
              <input
                style={ui.input}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button type="submit" style={ui.button}>
              Create
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p style={ui.error}>{error}</p> : null}

      <div style={ui.card}>
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Name</th>
              <th style={ui.th}>Members</th>
              <th style={ui.th}>Sendable</th>
              <th style={ui.th} />
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id}>
                <td style={ui.td}>
                  <div>{g.name}</div>
                  {g.description ? (
                    <div style={ui.muted}>{g.description}</div>
                  ) : null}
                </td>
                <td style={ui.td}>{g.memberCount}</td>
                <td style={ui.td}>
                  <span style={ui.badge}>{g.sendable ? "yes" : "no"}</span>
                </td>
                <td style={ui.td}>
                  <Link href={`/groups/${g.id}`} style={{ color: "#8fb89a" }}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td style={ui.td} colSpan={4}>
                  No groups yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
