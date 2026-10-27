import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../src/auth";
import { colors } from "../../src/theme";

export default function AppLayout() {
  const { token, loading, canCompose, canApprove } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen
        name="compose"
        options={{
          title: "Compose",
          href: canCompose ? "/(app)/compose" : null,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: "Approvals",
          href: canApprove ? "/(app)/approvals" : null,
        }}
      />
      <Tabs.Screen name="status" options={{ title: "Status" }} />
    </Tabs>
  );
}
