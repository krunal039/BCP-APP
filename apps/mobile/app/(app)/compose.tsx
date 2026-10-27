import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PublicGroup, PublicTemplate } from "@bcp/shared";
import { ApiError, api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors } from "../../src/theme";

export default function ComposeScreen() {
  const { token, canCompose, canBypass } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<PublicTemplate[]>([]);
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("info");
  const [selected, setSelected] = useState<string[]>([]);
  const [bypass, setBypass] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !canCompose) return;
    void (async () => {
      try {
        const [t, g] = await Promise.all([
          api.listTemplates(token),
          api.listGroups(token),
        ]);
        setTemplates(t.items);
        setGroups(g.items.filter((x) => x.sendable));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Load failed");
      }
    })();
  }, [token, canCompose]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setBody(t.body);
      setSeverity(t.severity);
    }
  }

  function toggleGroup(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit() {
    if (!token) return;
    if (selected.length === 0) {
      setError("Select at least one group");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (bypass) {
        if (!canBypass) {
          setError("urgentBypass capability required");
          return;
        }
        if (reason.trim().length < 3) {
          setError("Bypass reason required");
          return;
        }
        const res = await api.composeAndBypass(token, {
          templateId: templateId ?? undefined,
          body: body.trim() || undefined,
          severity,
          groupIds: selected,
          reason: reason.trim(),
          idempotencyKey,
        });
        router.push(`/alert/${res.alert.id}`);
      } else {
        const res = await api.composeAlert(token, {
          templateId: templateId ?? undefined,
          body: body.trim() || undefined,
          severity,
          groupIds: selected,
          submitForApproval: true,
          idempotencyKey,
        });
        router.push(`/alert/${res.alert.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canCompose) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Sender or Admin role required.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Template</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <Pressable
          style={[styles.chip, !templateId && styles.chipOn]}
          onPress={() => setTemplateId(null)}
        >
          <Text style={styles.chipText}>Free text</Text>
        </Pressable>
        {templates.map((t) => (
          <Pressable
            key={t.id}
            style={[styles.chip, templateId === t.id && styles.chipOn]}
            onPress={() => pickTemplate(t.id)}
          >
            <Text style={styles.chipText}>{t.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>Body</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={480}
      />

      <Text style={styles.label}>Severity</Text>
      <View style={styles.row}>
        {(["info", "warning", "critical"] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.chip, severity === s && styles.chipOn]}
            onPress={() => setSeverity(s)}
          >
            <Text style={styles.chipText}>{s}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Groups</Text>
      {groups.map((g) => (
        <Pressable key={g.id} style={styles.checkRow} onPress={() => toggleGroup(g.id)}>
          <Text style={styles.checkBox}>{selected.includes(g.id) ? "☑" : "☐"}</Text>
          <Text style={styles.body}>
            {g.name} ({g.memberCount})
          </Text>
        </Pressable>
      ))}
      {groups.length === 0 ? (
        <Text style={styles.meta}>No sendable groups.</Text>
      ) : null}

      {canBypass ? (
        <View style={styles.bypassBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.body}>Urgent bypass</Text>
            <Switch value={bypass} onValueChange={setBypass} />
          </View>
          {bypass ? (
            <>
              <Text style={styles.label}>Reason (required)</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                multiline
                value={reason}
                onChangeText={setReason}
              />
            </>
          ) : null}
        </View>
      ) : null}

      <Pressable style={styles.button} onPress={() => void onSubmit()} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>
            {bypass ? "Bypass & send" : "Submit for approval"}
          </Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.bg, gap: 4 },
  label: {
    color: colors.accent,
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipOn: { backgroundColor: colors.button },
  chipText: { color: colors.text, fontSize: 13 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkBox: { color: colors.accent, fontSize: 18, width: 24 },
  body: { color: colors.text, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 13 },
  bypassBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  button: {
    marginTop: 18,
    backgroundColor: colors.button,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.text, fontWeight: "700" },
  error: { color: colors.danger, marginTop: 12 },
});
