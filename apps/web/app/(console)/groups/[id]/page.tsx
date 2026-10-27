"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PublicGroup } from "@bcp/shared";
import { ApiError, api, type PublicMember } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";
import { ui } from "../../../../lib/styles";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, canAdmin } = useAuth();
  const [group, setGroup] = useState<PublicGroup | null>(null);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [allMembers, setAllMembers] = useState<PublicMember[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [addMemberId, setAddMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const [g, m] = await Promise.all([
        api.getGroup(token, id),
        api.listGroupMembers(token, id),
      ]);
      setGroup(g.group);
      setName(g.group.name);
      setDescription(g.group.description ?? "");
      setMembers(m.items);
      if (canAdmin) {
        const directory = await api.listMembers(token, { page: 1 });
        setAllMembers(directory.items);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load group");
    }
  }, [token, id, canAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !canAdmin || !id) return;
    setMessage(null);
    try {
      const res = await api.updateGroup(token, id, {
        name: name.trim(),
        description: description.trim() || null,
      });
      setGroup(res.group);
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!token || !canAdmin || !id || !addMemberId) return;
    try {
      await api.addGroupMembers(token, id, [addMemberId]);
      setAddMemberId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Add member failed");
    }
  }

  async function onRemove(memberId: string) {
    if (!token || !canAdmin || !id) return;
    try {
      await api.removeGroupMember(token, id, memberId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    }
  }

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = allMembers.filter((m) => m.active && !memberIds.has(m.id));

  return (
    <div>
      <p style={ui.muted}>
        <Link href="/groups" style={{ color: "#8fb89a" }}>
          ← Groups
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{group?.name ?? "Group"}</h1>
      {error ? <p style={ui.error}>{error}</p> : null}
      {message ? <p style={{ color: "#8fb89a" }}>{message}</p> : null}

      {canAdmin ? (
        <form onSubmit={onSave} style={ui.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Edit</h2>
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
              Save
            </button>
          </div>
        </form>
      ) : (
        <div style={ui.card}>
          <p style={{ margin: 0 }}>{group?.description || "No description"}</p>
          <p style={ui.muted}>
            {group?.memberCount ?? 0} members · sendable:{" "}
            {group?.sendable ? "yes" : "no"}
          </p>
        </div>
      )}

      <div style={ui.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Members</h2>
        {canAdmin ? (
          <form onSubmit={onAdd} style={{ ...ui.row, marginBottom: 12 }}>
            <select
              style={{ ...ui.input, maxWidth: 320 }}
              value={addMemberId}
              onChange={(e) => setAddMemberId(e.target.value)}
              required
            >
              <option value="">Add member…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <button type="submit" style={ui.button}>
              Add
            </button>
          </form>
        ) : null}
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Name</th>
              <th style={ui.th}>Phones</th>
              {canAdmin ? <th style={ui.th} /> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td style={ui.td}>{m.displayName}</td>
                <td style={ui.td}>
                  {m.phones.map((p) => p.e164).join(", ")}
                </td>
                {canAdmin ? (
                  <td style={ui.td}>
                    <button
                      type="button"
                      style={ui.buttonDanger}
                      onClick={() => void onRemove(m.id)}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            {members.length === 0 ? (
              <tr>
                <td style={ui.td} colSpan={canAdmin ? 3 : 2}>
                  No members in this group.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
