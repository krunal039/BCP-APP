import { StyleSheet, Text, View } from "react-native";
import { AlertStateSchema, RoleSchema } from "@bcp/shared";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Glencore · BCP</Text>
      <Text style={styles.title}>Critical Notifications</Text>
      <Text style={styles.body}>
        Expo app shell. Login, compose, approve, and status flows come in E8.
        Approver ≠ Sender is enforced by the API.
      </Text>
      <Text style={styles.meta}>Roles: {RoleSchema.options.join(", ")}</Text>
      <Text style={styles.meta}>
        States: {AlertStateSchema.options.join(", ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "#0f1c14",
  },
  eyebrow: {
    color: "#8fb89a",
    letterSpacing: 2,
    textTransform: "uppercase",
    fontSize: 12,
    marginBottom: 8,
  },
  title: {
    color: "#e8f0ea",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  body: {
    color: "#c5d6c9",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 20,
  },
  meta: {
    color: "#a8c4b0",
    fontSize: 13,
    marginBottom: 6,
  },
});
