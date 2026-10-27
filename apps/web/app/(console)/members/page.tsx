"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type PublicMember } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ui } from "../../../lib/styles";

export default function MembersPage() {
  const { token, canAdmin } = useAuth();
  const [items, setItems] = useState<PublicMember[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [e164, setE164] = useState("+243");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.listMembers(token, { q: q || undefined, page: 1 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load members");
    }
  }, [token, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !canAdmin) return;
    setError(null);
    try {
      await api.createMember(token, {
        displayName: displayName.trim(),
        e164: e164.trim(),
        countryCode: "CD",
      });
      setDisplayName("");
      setE164("+243");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  async function onSaveEdit(id: string) {
    if (!token || !canAdmin) return;
    try {
      await api.updateMember(token, id, { displayName: editName.trim() });
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function onDeactivate(id: string) {
    if (!token || !canAdmin) return;
    if (!confirm("Deactivate this member?")) return;
    try {
      await api.deactivateMember(token, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Deactivate failed");
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Members</h1>
      <p style={ui.muted}>
        Directory for SMS/push targeting (DRC-first). Mutations require Admin.
      </p>

      <div style={{ ...ui.row, marginBottom: 16 }}>
        <input
          style={{ ...ui.input, maxWidth: 280 }}
          placeholder="Search name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" style={ui.buttonGhost} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {canAdmin ? (
        <form onSubmit={onCreate} style={ui.card}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Add member</h2>
          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <div>
              <label style={ui.label}>Display name</label>
              <input
                style={ui.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={ui.label}>Phone (E.164)</label>
              <input
                style={ui.input}
                value={e164}
                onChange={(e) => setE164(e.target.value)}
                required
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
              <th style={ui.th}>Phones</th>
              <th style={ui.th}>Status</th>
              {canAdmin ? <th style={ui.th}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td style={ui.td}>
                  {editId === m.id ? (
                    <input
                      style={ui.input}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  ) : (
                    m.displayName
                  )}
                </td>
                <td style={ui.td}>
                  {m.phones.map((p) => (
                    <div key={p.id}>
                      {p.e164}{" "}
                      <span style={ui.badge}>{p.countryCode}</span>
                    </div>
                  ))}
                </td>
                <td style={ui.td}>
                  <span style={ui.badge}>{m.active ? "active" : "inactive"}</span>
                </td>
                {canAdmin ? (
                  <td style={ui.td}>
                    <div style={ui.row}>
                      {editId === m.id ? (
                        <>
                          <button
                            type="button"
                            style={ui.button}
                            onClick={() => void onSaveEdit(m.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            style={ui.buttonGhost}
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            style={ui.buttonGhost}
                            onClick={() => {
                              setEditId(m.id);
                              setEditName(m.displayName);
                            }}
                          >
                            Edit
                          </button>
                          {m.active ? (
                            <button
                              type="button"
                              style={ui.buttonDanger}
                              onClick={() => void onDeactivate(m.id)}
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td style={ui.td} colSpan={canAdmin ? 4 : 3}>
                  No members yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
