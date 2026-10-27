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

const TOKEN_KEY = "bcp.accessToken";
const USER_KEY = "bcp.user";

type AuthState = {
  token: string | null;
  user: PublicUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  canCompose: boolean;
  canApprove: boolean;
  canBypass: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [storedToken, rawUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (!storedToken) return;
        setToken(storedToken);
        if (rawUser) setUser(JSON.parse(rawUser) as PublicUser);
        const { user: fresh } = await api.me(storedToken);
        setUser(fresh);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
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
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    await AsyncStorage.setItem(TOKEN_KEY, res.accessToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setToken(res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // ignore
      }
    }
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
    setToken(null);
    setUser(null);
  }, [token]);

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
      login,
      logout,
      hasRole,
      canCompose: hasRole("sender", "admin"),
      canApprove: hasRole("approver", "admin"),
      canBypass: Boolean(user?.capabilities.urgentBypass),
    }),
    [token, user, loading, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
