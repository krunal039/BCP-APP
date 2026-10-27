import { useFocusEffect, useRouter } from "expo-router";
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
import { ApiError, api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors } from "../../src/theme";

export default function ApprovalsScreen() {
  const { token, user, canApprove } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PublicAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      setError(err instanceof ApiError ? err.message : "Load failed");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onApprove(id: string) {
    if (!token) return;
    setBusyId(id);
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
    try {
      await api.rejectAlert(token, id, notes[id]?.trim() || undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!canApprove) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Approver or Admin role required.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <Text style={styles.meta}>
        Approver ≠ Sender enforced by API. Pull to refresh.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {items.map((alert) => {
        const isOwn = user?.id === alert.senderUserId;
        return (
          <View key={alert.id} style={styles.card}>
            <Text style={styles.badge}>
              {alert.severity} · {alert.state}
            </Text>
            <Text style={styles.body}>{alert.body}</Text>
            <Text style={styles.meta}>
              {new Date(alert.createdAt).toLocaleString()}
            </Text>
            <Pressable onPress={() => router.push(`/alert/${alert.id}`)}>
              <Text style={styles.link}>Open details</Text>
            </Pressable>
            {isOwn ? (
              <Text style={styles.error}>Your send — cannot self-approve.</Text>
            ) : (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Pressable
                  style={styles.button}
                  disabled={busyId === alert.id}
                  onPress={() => void onApprove(alert.id)}
                >
                  {busyId === alert.id ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.buttonText}>Approve</Text>
                  )}
                </Pressable>
                <TextInput
                  style={styles.input}
                  placeholder="Reject note (optional)"
                  placeholderTextColor={colors.muted}
                  value={notes[alert.id] ?? ""}
                  onChangeText={(v) =>
                    setNotes((prev) => ({ ...prev, [alert.id]: v }))
                  }
                />
                <Pressable
                  style={styles.danger}
                  disabled={busyId === alert.id}
                  onPress={() => void onReject(alert.id)}
                >
                  <Text style={styles.buttonText}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {items.length === 0 ? (
        <Text style={styles.meta}>No pending approvals.</Text>
      ) : null}
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
  link: { color: colors.accent, fontSize: 13, marginTop: 4 },
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
});
