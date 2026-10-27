import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

export type PushPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

export type PushRegistrationResult = {
  status: PushPermissionStatus;
  token: string | null;
  error: string | null;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function resolveProjectId(): string | undefined {
  const easId = Constants.easConfig?.projectId;
  if (typeof easId === "string" && easId.length > 0) return easId;
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId;
}

/**
 * Request notification permission and return an Expo push token when possible.
 * Simulators / web return `unavailable` (no App Store / FCM path required for MVP).
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  if (Platform.OS === "web" || !Device.isDevice) {
    return { status: "unavailable", token: null, error: null };
  }

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== "granted") {
      return {
        status: status === "denied" ? "denied" : "undetermined",
        token: null,
        error: null,
      };
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("bcp-alerts", {
        name: "BCP Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#C4A35A",
      });
    }

    const projectId = resolveProjectId();
    const push = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    return { status: "granted", token: push.data, error: null };
  } catch (err) {
    return {
      status: "undetermined",
      token: null,
      error: err instanceof Error ? err.message : "Push registration failed",
    };
  }
}

/** After login: request permission, register token with API (best-effort). */
export async function syncPushTokenWithApi(
  accessToken: string,
): Promise<PushRegistrationResult> {
  const result = await registerForPushNotifications();
  if (result.token) {
    try {
      await api.registerDeviceToken(accessToken, result.token);
    } catch (err) {
      return {
        ...result,
        error:
          err instanceof Error ? err.message : "Failed to store device token",
      };
    }
  }
  return result;
}

export async function deactivatePushTokenOnLogout(
  accessToken: string,
  expoToken: string | null,
): Promise<void> {
  if (!expoToken) return;
  try {
    await api.deactivateDeviceToken(accessToken, expoToken);
  } catch {
    // best-effort
  }
}
