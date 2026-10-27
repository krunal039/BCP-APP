"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export default function HomePage() {
  const { token, loading, canCompose, canApprove, canAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    if (canApprove) router.replace("/approvals");
    else if (canCompose) router.replace("/compose");
    else if (canAdmin) router.replace("/members");
    else router.replace("/alerts");
  }, [loading, token, canCompose, canApprove, canAdmin, router]);

  return (
    <p style={{ padding: "2rem", color: "#a8c4b0" }}>Redirecting…</p>
  );
}
