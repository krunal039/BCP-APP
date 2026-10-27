import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PublicUser, Role } from "@bcp/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import {
  deactivatePushTokenOnLogout,
  syncPushTokenWithApi,
  type PushPermissionStatus,
} from "./push";

const TOKEN_KEY = "bcp.accessToken";
const USER_KEY = "bcp.user";
const PUSH_TOKEN_KEY = "bcp.expoPushToken";

type AuthState = {
  token: string | null;
  user: PublicUser | null;
  loading: boolean;
  pushStatus: PushPermissionStatus | null;
  pushMessage: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retryPushRegistration: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  canCompose: boolean;
  canApprove: boolean;
  canBypass: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function pushBannerMessage(
  status: PushPermissionStatus,
  error: string | null,
): string | null {
  if (error) return `Push registration issue: ${error}`;
  if (status === "denied") {
    return "Notifications are off. Enable them in system settings to receive critical alerts.";
  }
  if (status === "unavailable") {
    return "Push requires a physical device (simulator/web skipped).";
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus | null>(
    null,
  );
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  const runPushSync = useCallback(async (accessToken: string) => {
    const result = await syncPushTokenWithApi(accessToken);
    setPushStatus(result.status);
    setPushMessage(pushBannerMessage(result.status, result.error));
    if (result.token) {
      setExpoPushToken(result.token);
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [storedToken, rawUser, storedPush] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
          AsyncStorage.getItem(PUSH_TOKEN_KEY),
        ]);
        if (storedPush) setExpoPushToken(storedPush);
        if (!storedToken) return;
        setToken(storedToken);
        if (rawUser) setUser(JSON.parse(rawUser) as PublicUser);
        const { user: fresh } = await api.me(storedToken);
        setUser(fresh);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
        await runPushSync(storedToken);
      } catch {
        await Promise.all([
          AsyncStorage.removeItem(TOKEN_KEY),
          AsyncStorage.removeItem(USER_KEY),
        ]);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [runPushSync]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      await AsyncStorage.setItem(TOKEN_KEY, res.accessToken);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
      setToken(res.accessToken);
      setUser(res.user);
      await runPushSync(res.accessToken);
    },
    [runPushSync],
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await deactivatePushTokenOnLogout(token, expoPushToken);
        await api.logout(token);
      } catch {
        // ignore
      }
    }
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
      AsyncStorage.removeItem(PUSH_TOKEN_KEY),
    ]);
    setToken(null);
    setUser(null);
    setExpoPushToken(null);
    setPushStatus(null);
    setPushMessage(null);
  }, [token, expoPushToken]);

  const retryPushRegistration = useCallback(async () => {
    if (!token) return;
    await runPushSync(token);
  }, [token, runPushSync]);

  const hasRole = useCallback(
    (...roles: Role[]) => {
      if (!user) return false;
      if (user.roles.includes("admin")) return true;
      return roles.some((r) => user.roles.includes(r));
    },
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      loading,
      pushStatus,
      pushMessage,
      login,
      logout,
      retryPushRegistration,
      hasRole,
      canCompose: hasRole("sender", "admin"),
      canApprove: hasRole("approver", "admin"),
      canBypass: Boolean(user?.capabilities.urgentBypass),
    }),
    [
      token,
      user,
      loading,
      pushStatus,
      pushMessage,
      login,
      logout,
      retryPushRegistration,
      hasRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
