import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/auth";
import { getApiBaseUrl } from "../../src/config";
import { colors } from "../../src/theme";

export default function HomeScreen() {
  const { user, canCompose, canApprove, canBypass, logout } = useAuth();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Glencore · BCP</Text>
      <Text style={styles.title}>Critical Notifications</Text>
      <Text style={styles.body}>
        Signed in as {user?.displayName} ({user?.roles.join(", ")})
        {canBypass ? " · urgent bypass enabled" : ""}
      </Text>
      <Text style={styles.meta}>API {getApiBaseUrl()}</Text>

      <View style={styles.actions}>
        {canCompose ? (
          <Pressable style={styles.button} onPress={() => router.push("/(app)/compose")}>
            <Text style={styles.buttonText}>Compose alert</Text>
          </Pressable>
        ) : null}
        {canApprove ? (
          <Pressable style={styles.button} onPress={() => router.push("/(app)/approvals")}>
            <Text style={styles.buttonText}>Approval queue</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.button} onPress={() => router.push("/(app)/status")}>
          <Text style={styles.buttonText}>Delivery status</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={() => void logout()}>
          <Text style={styles.ghostText}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.bg },
  eyebrow: {
    color: colors.accent,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontSize: 12,
    marginBottom: 8,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", marginBottom: 10 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  meta: { color: colors.muted, fontSize: 12, marginBottom: 24 },
  actions: { gap: 10 },
  button: {
    backgroundColor: colors.button,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.text, fontWeight: "700" },
  ghost: {
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostText: { color: colors.muted },
});
