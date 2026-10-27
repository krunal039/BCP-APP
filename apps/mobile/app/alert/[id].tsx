import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PublicAlert } from "@bcp/shared";
import { ApiError, api, type DeliveryItem } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors } from "../../src/theme";

export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, canApprove, canCompose, canBypass } = useAuth();
  const [alert, setAlert] = useState<PublicAlert | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      setError(err instanceof ApiError ? err.message : "Load failed");
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isOwn = user?.id === alert?.senderUserId;
  const canActApprove =
    canApprove && alert?.state === "pending_approval" && !isOwn;
  const canActBypass =
    canCompose &&
    canBypass &&
    (alert?.state === "draft" || alert?.state === "pending_approval") &&
    (isOwn || Boolean(user?.roles.includes("admin")));

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

  async function onReject() {
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

  async function onBypass() {
    if (!token || !id) return;
    if (bypassReason.trim().length < 3) {
      setError("Bypass reason required");
      return;
    }
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

  const counts: Record<string, number> = {};
  for (const d of deliveries) {
    counts[d.status] = (counts[d.status] ?? 0) + 1;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {alert ? (
        <View style={styles.card}>
          <Text style={styles.badge}>
            {alert.state} · {alert.severity}
          </Text>
          <Text style={styles.body}>{alert.body}</Text>
          <Text style={styles.meta}>
            {new Date(alert.createdAt).toLocaleString()}
          </Text>
          {alert.bypassReason ? (
            <Text style={styles.meta}>Bypass: {alert.bypassReason}</Text>
          ) : null}
          {alert.rejectNote ? (
            <Text style={styles.meta}>Reject: {alert.rejectNote}</Text>
          ) : null}

          {canActApprove ? (
            <View style={{ gap: 8, marginTop: 12 }}>
              <Pressable style={styles.button} disabled={busy} onPress={() => void onApprove()}>
                {busy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.buttonText}>Approve & send</Text>
                )}
              </Pressable>
              <TextInput
                style={styles.input}
                placeholder="Reject note"
                placeholderTextColor={colors.muted}
                value={rejectNote}
                onChangeText={setRejectNote}
              />
              <Pressable style={styles.danger} disabled={busy} onPress={() => void onReject()}>
                <Text style={styles.buttonText}>Reject</Text>
              </Pressable>
            </View>
          ) : null}

          {canActBypass ? (
            <View style={{ gap: 8, marginTop: 12 }}>
              <Text style={styles.label}>Urgent bypass reason</Text>
              <TextInput
                style={[styles.input, { minHeight: 70 }]}
                multiline
                value={bypassReason}
                onChangeText={setBypassReason}
              />
              <Pressable style={styles.danger} disabled={busy} onPress={() => void onBypass()}>
                <Text style={styles.buttonText}>Bypass & send now</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Deliveries</Text>
        <Text style={styles.meta}>
          {Object.entries(counts)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ") || "None yet"}
        </Text>
        {deliveries.map((d) => (
          <View key={d.id} style={styles.deliveryRow}>
            <Text style={styles.body}>
              {d.channel} · {d.targetAddress}
            </Text>
            <Text style={styles.meta}>
              {d.status}
              {d.errorCode ? ` · ${d.errorCode}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.bg, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.card,
    gap: 6,
  },
  badge: { color: colors.accent, fontSize: 12, textTransform: "uppercase" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 13 },
  label: {
    color: colors.accent,
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.button,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  danger: {
    backgroundColor: colors.buttonDanger,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: colors.text, fontWeight: "700" },
  error: { color: colors.danger },
  deliveryRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    marginTop: 6,
  },
});
