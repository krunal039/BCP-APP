"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PublicGroup, PublicTemplate } from "@bcp/shared";
import { ApiError, api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ui } from "../../../lib/styles";

export default function ComposePage() {
  const { token, canCompose, canBypass } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<PublicTemplate[]>([]);
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("info");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [bypassMode, setBypassMode] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !canCompose) return;
    void (async () => {
      try {
        const [t, g] = await Promise.all([
          api.listTemplates(token),
          api.listGroups(token, { page: 1 }),
        ]);
        setTemplates(t.items);
        setGroups(g.items.filter((x) => x.sendable));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load form data");
      }
    })();
  }, [token, canCompose]);

  function toggleGroup(id: string) {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function onTemplateChange(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setBody(t.body);
      setSeverity(t.severity);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !canCompose) return;
    if (selectedGroups.length === 0) {
      setError("Select at least one group");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (bypassMode) {
        if (!canBypass) {
          setError("urgentBypass capability required");
          return;
        }
        if (reason.trim().length < 3) {
          setError("Bypass reason is required (min 3 chars)");
          return;
        }
        const res = await api.composeAndBypass(token, {
          templateId: templateId || undefined,
          body: body.trim() || undefined,
          severity,
          groupIds: selectedGroups,
          reason: reason.trim(),
          idempotencyKey,
        });
        router.push(`/alerts/${res.alert.id}`);
      } else {
        const res = await api.composeAlert(token, {
          templateId: templateId || undefined,
          body: body.trim() || undefined,
          severity,
          groupIds: selectedGroups,
          submitForApproval: true,
          idempotencyKey,
        });
        router.push(`/alerts/${res.alert.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Compose failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canCompose) {
    return <p style={ui.error}>Sender or Admin role required to compose.</p>;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Compose alert</h1>
      <p style={ui.muted}>
        Submits for dual-control approval (Approver ≠ Sender). Urgent bypass
        requires capability + reason.
      </p>

      <form onSubmit={onSubmit} style={ui.card}>
        <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
          <div>
            <label style={ui.label}>Template (optional)</label>
            <select
              style={ui.input}
              value={templateId}
              onChange={(e) => onTemplateChange(e.target.value)}
            >
              <option value="">Free-text / no template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.locale}, {t.severity})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={ui.label}>Body</label>
            <textarea
              style={{ ...ui.input, minHeight: 110, resize: "vertical" }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={480}
              required={!templateId}
            />
            <div style={ui.muted}>{body.length}/480</div>
          </div>
          <div>
            <label style={ui.label}>Severity</label>
            <select
              style={ui.input}
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </div>
          <div>
            <label style={ui.label}>Target groups</label>
            <div style={{ display: "grid", gap: 6 }}>
              {groups.map((g) => (
                <label key={g.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                  <span>
                    {g.name}{" "}
                    <span style={ui.muted}>({g.memberCount} members)</span>
                  </span>
                </label>
              ))}
              {groups.length === 0 ? (
                <span style={ui.muted}>No sendable groups. Add members first.</span>
              ) : null}
            </div>
          </div>

          {canBypass ? (
            <div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={bypassMode}
                  onChange={(e) => setBypassMode(e.target.checked)}
                />
                <span>Urgent bypass (skip approval — audited)</span>
              </label>
              {bypassMode ? (
                <div style={{ marginTop: 10 }}>
                  <label style={ui.label}>Bypass reason (required)</label>
                  <textarea
                    style={{ ...ui.input, minHeight: 70 }}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <button type="submit" style={ui.button} disabled={busy}>
            {busy
              ? "Submitting…"
              : bypassMode
                ? "Bypass & send"
                : "Submit for approval"}
          </button>
        </div>
        {error ? <p style={ui.error}>{error}</p> : null}
      </form>
    </div>
  );
}
