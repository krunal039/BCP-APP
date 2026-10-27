"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PublicUser, Role } from "@bcp/shared";
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
  canAdmin: boolean;
  canBypass: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function readStored(): { token: string | null; user: PublicUser | null } {
  if (typeof window === "undefined") return { token: null, user: null };
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) return { token: null, user: null };
  try {
    return { token, user: JSON.parse(raw) as PublicUser };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = readStored();
    if (!stored.token) {
      setLoading(false);
      return;
    }
    setToken(stored.token);
    setUser(stored.user);
    api
      .me(stored.token)
      .then(({ user: fresh }) => {
        setUser(fresh);
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setToken(res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // ignore network errors on logout
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
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
      canAdmin: hasRole("admin"),
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
