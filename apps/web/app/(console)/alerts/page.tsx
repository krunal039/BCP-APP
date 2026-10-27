"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicAlert } from "@bcp/shared";
import { ApiError, api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ui } from "../../../lib/styles";

const STATES = [
  "",
  "pending_approval",
  "approved",
  "rejected",
  "bypassed",
  "sending",
  "completed",
  "partial_failure",
  "draft",
];

export default function AlertsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<PublicAlert[]>([]);
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.listAlerts(token, {
        state: state || undefined,
        limit: 50,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load alerts");
    }
  }, [token, state]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Delivery status</h1>
      <p style={ui.muted}>
        Alert dual-control state and per-recipient SMS/push delivery drill-down.
      </p>

      <div style={{ ...ui.row, marginBottom: 16 }}>
        <select
          style={{ ...ui.input, maxWidth: 220 }}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          {STATES.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "all states"}
            </option>
          ))}
        </select>
        <button type="button" style={ui.buttonGhost} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <p style={ui.error}>{error}</p> : null}

      <div style={ui.card}>
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Created</th>
              <th style={ui.th}>State</th>
              <th style={ui.th}>Severity</th>
              <th style={ui.th}>Body</th>
              <th style={ui.th} />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td style={ui.td}>{new Date(a.createdAt).toLocaleString()}</td>
                <td style={ui.td}>
                  <span style={ui.badge}>{a.state}</span>
                  {a.bypassReason ? (
                    <div style={ui.muted}>bypass</div>
                  ) : null}
                </td>
                <td style={ui.td}>{a.severity}</td>
                <td style={ui.td}>
                  {a.body.length > 80 ? `${a.body.slice(0, 80)}…` : a.body}
                </td>
                <td style={ui.td}>
                  <Link href={`/alerts/${a.id}`} style={{ color: "#8fb89a" }}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td style={ui.td} colSpan={5}>
                  No alerts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
