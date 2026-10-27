"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ui } from "../../lib/styles";

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && token) router.replace("/");
  }, [loading, token, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{ ...ui.card, width: "100%", maxWidth: 400, marginBottom: 0 }}
      >
        <p style={{ ...ui.muted, marginTop: 0, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Glencore · BCP
        </p>
        <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.6rem" }}>Sign in</h1>
        <p style={{ ...ui.muted, marginTop: 0, marginBottom: "1.25rem" }}>
          Username / password against the local API. Roles are enforced server-side.
        </p>
        <label style={ui.label}>Username</label>
        <input
          style={{ ...ui.input, marginBottom: 12 }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <label style={ui.label}>Password</label>
        <input
          style={{ ...ui.input, marginBottom: 16 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" style={ui.button} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p style={ui.error}>{error}</p> : null}
        <p style={{ ...ui.muted, marginTop: 16, marginBottom: 0 }}>
          API: set <code>NEXT_PUBLIC_API_URL</code> (default{" "}
          <code>http://localhost:3001</code>).
        </p>
      </form>
    </main>
  );
}
