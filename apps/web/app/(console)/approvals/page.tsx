"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicAlert } from "@bcp/shared";
import { ApiError, api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ui } from "../../../lib/styles";

export default function ApprovalsPage() {
  const { token, user, canApprove } = useAuth();
  const [items, setItems] = useState<PublicAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.listAlerts(token, {
        state: "pending_approval",
        limit: 50,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load queue");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onApprove(id: string) {
    if (!token) return;
    setBusyId(id);
    setError(null);
    try {
      await api.approveAlert(token, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(id: string) {
    if (!token) return;
    setBusyId(id);
    setError(null);
    try {
      await api.rejectAlert(token, id, rejectNotes[id]?.trim() || undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!canApprove) {
    return <p style={ui.error}>Approver or Admin role required.</p>;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Pending approvals</h1>
      <p style={ui.muted}>
        Approver ≠ Sender is enforced by the API. Your own sends cannot be
        approved by you.
      </p>
      <button type="button" style={{ ...ui.buttonGhost, marginBottom: 12 }} onClick={() => void load()}>
        Refresh
      </button>
      {error ? <p style={ui.error}>{error}</p> : null}

      {items.map((alert) => {
        const isOwn = user?.id === alert.senderUserId;
        return (
          <div key={alert.id} style={ui.card}>
            <div style={{ ...ui.row, justifyContent: "space-between" }}>
              <div>
                <span style={ui.badge}>{alert.severity}</span>{" "}
                <span style={ui.badge}>{alert.state}</span>
              </div>
              <Link href={`/alerts/${alert.id}`} style={{ color: "#8fb89a", fontSize: 13 }}>
                Details
              </Link>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "0.75rem 0" }}>{alert.body}</p>
            <p style={ui.muted}>
              Sender: {alert.senderUserId.slice(0, 8)}… ·{" "}
              {new Date(alert.createdAt).toLocaleString()} · groups:{" "}
              {alert.targetGroupIds.length}
            </p>
            {isOwn ? (
              <p style={ui.error}>
                This is your send — you cannot approve or reject it.
              </p>
            ) : (
              <div style={{ ...ui.row, marginTop: 8 }}>
                <button
                  type="button"
                  style={ui.button}
                  disabled={busyId === alert.id}
                  onClick={() => void onApprove(alert.id)}
                >
                  Approve
                </button>
                <input
                  style={{ ...ui.input, maxWidth: 260 }}
                  placeholder="Reject note (optional)"
                  value={rejectNotes[alert.id] ?? ""}
                  onChange={(e) =>
                    setRejectNotes((prev) => ({
                      ...prev,
                      [alert.id]: e.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  style={ui.buttonDanger}
                  disabled={busyId === alert.id}
                  onClick={() => void onReject(alert.id)}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}

      {items.length === 0 ? (
        <div style={ui.card}>
          <p style={{ margin: 0, ...ui.muted }}>No alerts pending approval.</p>
        </div>
      ) : null}
    </div>
  );
}
