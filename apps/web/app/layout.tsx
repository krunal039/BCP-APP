import type { Metadata } from "next";
import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "Glencore BCP Critical Notifications",
  description: "Admin console for BCP critical alerts (MVP)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background:
            "linear-gradient(160deg, #0f1c14 0%, #1a2e22 45%, #0d1510 100%)",
          color: "#e8f0ea",
          minHeight: "100vh",
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
