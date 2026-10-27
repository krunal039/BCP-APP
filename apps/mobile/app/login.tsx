import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError } from "../src/api";
import { useAuth } from "../src/auth";
import { getApiBaseUrl } from "../src/config";
import { colors } from "../src/theme";

export default function LoginScreen() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && token) return <Redirect href="/(app)" />;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      router.replace("/(app)");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Glencore · BCP</Text>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.meta}>API: {getApiBaseUrl()}</Text>

      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable style={styles.button} onPress={() => void onSubmit()} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>Sign in</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: colors.bg },
  eyebrow: {
    color: colors.accent,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontSize: 12,
    marginBottom: 8,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "700", marginBottom: 8 },
  meta: { color: colors.muted, fontSize: 12, marginBottom: 20 },
  label: {
    color: colors.accent,
    fontSize: 12,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    marginBottom: 14,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  button: {
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
