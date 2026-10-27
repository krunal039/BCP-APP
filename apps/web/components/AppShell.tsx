"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { ui } from "../lib/styles";

const links = [
  { href: "/members", label: "Members", show: (a: ReturnType<typeof useAuth>) => a.canCompose || a.canApprove || a.canAdmin },
  { href: "/groups", label: "Groups", show: (a: ReturnType<typeof useAuth>) => a.canCompose || a.canApprove || a.canAdmin },
  { href: "/compose", label: "Compose", show: (a: ReturnType<typeof useAuth>) => a.canCompose },
  { href: "/approvals", label: "Approvals", show: (a: ReturnType<typeof useAuth>) => a.canApprove },
  { href: "/alerts", label: "Delivery status", show: (a: ReturnType<typeof useAuth>) => a.canCompose || a.canApprove || a.canAdmin },
];

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();

  return (
    <div>
      <header
        style={{
          borderBottom: "1px solid rgba(143,184,154,0.25)",
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            ...ui.page,
            paddingTop: "0.9rem",
            paddingBottom: "0.9rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem 1.25rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#8fb89a", letterSpacing: "0.08em" }}>
              GLENCORE · BCP
            </div>
            <div style={{ fontWeight: 700 }}>Critical Notifications</div>
          </div>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem" }}>
            {links
              .filter((l) => l.show(auth))
              .map((l) => {
                const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    style={{
                      color: active ? "#e8f0ea" : "#a8c4b0",
                      textDecoration: "none",
                      fontWeight: active ? 700 : 500,
                      fontSize: 14,
                      borderBottom: active
                        ? "2px solid #8fb89a"
                        : "2px solid transparent",
                      paddingBottom: 2,
                    }}
                  >
                    {l.label}
                  </Link>
                );
              })}
          </nav>
          <div style={{ ...ui.row, fontSize: 13 }}>
            <span style={ui.muted}>
              {auth.user?.displayName} · {auth.user?.roles.join(", ")}
              {auth.canBypass ? " · bypass" : ""}
            </span>
            <button type="button" style={ui.buttonGhost} onClick={() => void auth.logout()}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main style={ui.page}>{children}</main>
    </div>
  );
}
