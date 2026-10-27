import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PublicAlert } from "@bcp/shared";
import { ApiError, api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors } from "../../src/theme";

export default function StatusScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PublicAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.listAlerts(token, { limit: 50 });
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <Text style={styles.meta}>Recent alerts · pull to refresh</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {items.map((a) => (
        <Pressable
          key={a.id}
          style={styles.card}
          onPress={() => router.push(`/alert/${a.id}`)}
        >
          <Text style={styles.badge}>
            {a.state} · {a.severity}
            {a.bypassReason ? " · bypass" : ""}
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            {a.body}
          </Text>
          <Text style={styles.meta}>
            {new Date(a.createdAt).toLocaleString()}
          </Text>
        </Pressable>
      ))}
      {items.length === 0 ? (
        <View>
          <Text style={styles.meta}>No alerts yet.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: colors.bg, gap: 10 },
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
  error: { color: colors.danger },
});
