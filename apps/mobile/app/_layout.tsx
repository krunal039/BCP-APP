import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0f1c14" },
          headerTintColor: "#e8f0ea",
          contentStyle: { backgroundColor: "#0f1c14" },
        }}
      />
    </>
  );
}
