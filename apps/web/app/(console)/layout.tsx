"use client";

import type { ReactNode } from "react";
import { AppShell } from "../../components/AppShell";
import { RequireAuth } from "../../components/RequireAuth";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
