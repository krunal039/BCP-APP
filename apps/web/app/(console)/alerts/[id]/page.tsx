"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PublicAlert } from "@bcp/shared";
import { ApiError, api, type DeliveryItem } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";
import { ui } from "../../../../lib/styles";

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user, canApprove, canCompose, canBypass } = useAuth();
  const [alert, setAlert] = useState<PublicAlert | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const [a, d] = await Promise.all([
        api.getAlert(token, id),
        api.listDeliveries(token, id),
      ]);
      setAlert(a.alert);
      setDeliveries(d.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load alert");
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of deliveries) {
      c[d.status] = (c[d.status] ?? 0) + 1;
    }
    return c;
  }, [deliveries]);

  const isOwn = user?.id === alert?.senderUserId;
  const canActApprove =
    canApprove &&
    alert?.state === "pending_approval" &&
    !isOwn;
  const canActBypass =
    canCompose &&
    canBypass &&
    (alert?.state === "draft" || alert?.state === "pending_approval") &&
    (isOwn || user?.roles.includes("admin"));

  async function onApprove() {
    if (!token || !id) return;
    setBusy(true);
    try {
      await api.approveAlert(token, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReject(e: FormEvent) {
    e.preventDefault();
    if (!token || !id) return;
    setBusy(true);
    try {
      await api.rejectAlert(token, id, rejectNote.trim() || undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  async function onBypass(e: FormEvent) {
    e.preventDefault();
    if (!token || !id) return;
    setBusy(true);
    try {
      await api.bypassAlert(token, id, bypassReason.trim());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bypass failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={ui.muted}>
        <Link href="/alerts" style={{ color: "#8fb89a" }}>
          ← Delivery status
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Alert</h1>
      {error ? <p style={ui.error}>{error}</p> : null}

      {alert ? (
        <div style={ui.card}>
          <div style={ui.row}>
            <span style={ui.badge}>{alert.state}</span>
            <span style={ui.badge}>{alert.severity}</span>
            {alert.bypassReason ? <span style={ui.badge}>bypassed</span> : null}
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{alert.body}</p>
          <p style={ui.muted}>
            Created {new Date(alert.createdAt).toLocaleString()} · sender{" "}
            {alert.senderUserId.slice(0, 8)}…
            {alert.approverUserId
              ? ` · approver ${alert.approverUserId.slice(0, 8)}…`
              : ""}
          </p>
          {alert.bypassReason ? (
            <p style={ui.muted}>Bypass reason: {alert.bypassReason}</p>
          ) : null}
          {alert.rejectNote ? (
            <p style={ui.muted}>Reject note: {alert.rejectNote}</p>
          ) : null}
          {alert.targetSnapshot ? (
            <p style={ui.muted}>
              Snapshot: {alert.targetSnapshot.targets.length} targets @{" "}
              {new Date(alert.targetSnapshot.resolvedAt).toLocaleString()}
            </p>
          ) : null}

          {canActApprove ? (
            <div style={{ ...ui.row, marginTop: 12 }}>
              <button
                type="button"
                style={ui.button}
                disabled={busy}
                onClick={() => void onApprove()}
              >
                Approve & send
              </button>
              <form onSubmit={onReject} style={ui.row}>
                <input
                  style={{ ...ui.input, maxWidth: 240 }}
                  placeholder="Reject note"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                />
                <button type="submit" style={ui.buttonDanger} disabled={busy}>
                  Reject
                </button>
              </form>
            </div>
          ) : null}

          {canActBypass ? (
            <form onSubmit={onBypass} style={{ marginTop: 16 }}>
              <label style={ui.label}>Urgent bypass reason</label>
              <textarea
                style={{ ...ui.input, minHeight: 70, maxWidth: 480 }}
                value={bypassReason}
                onChange={(e) => setBypassReason(e.target.value)}
                required
                minLength={3}
              />
              <div style={{ marginTop: 8 }}>
                <button type="submit" style={ui.buttonDanger} disabled={busy}>
                  Bypass & send now
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <div style={ui.card}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Deliveries</h2>
        <div style={{ ...ui.row, marginBottom: 10 }}>
          {Object.entries(counts).map(([status, n]) => (
            <span key={status} style={ui.badge}>
              {status}: {n}
            </span>
          ))}
          {deliveries.length === 0 ? (
            <span style={ui.muted}>No delivery events yet.</span>
          ) : null}
          <button type="button" style={ui.buttonGhost} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Channel</th>
              <th style={ui.th}>Address</th>
              <th style={ui.th}>Status</th>
              <th style={ui.th}>Provider id</th>
              <th style={ui.th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td style={ui.td}>{d.channel}</td>
                <td style={ui.td}>{d.targetAddress}</td>
                <td style={ui.td}>
                  <span style={ui.badge}>{d.status}</span>
                </td>
                <td style={ui.td}>{d.providerMessageId ?? "—"}</td>
                <td style={ui.td}>{d.errorCode ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
