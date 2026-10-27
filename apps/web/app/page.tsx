import { AlertStateSchema, RoleSchema } from "@bcp/shared";

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "4rem 1.5rem",
      }}
    >
      <p
        style={{
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontSize: 12,
          color: "#8fb89a",
          marginBottom: 12,
        }}
      >
        Glencore · BCP
      </p>
      <h1 style={{ fontSize: "2.25rem", lineHeight: 1.15, margin: "0 0 1rem" }}>
        Critical Notifications
      </h1>
      <p style={{ fontSize: "1.05rem", color: "#c5d6c9", marginBottom: "2rem" }}>
        Web admin console scaffold. Members, groups, templates, send history,
        and audit export land in later epics. Dual-control (Approver ≠ Sender)
        is enforced on the API — not in the browser.
      </p>
      <dl
        style={{
          display: "grid",
          gap: "0.75rem",
          fontSize: 14,
          color: "#a8c4b0",
        }}
      >
        <div>
          <dt style={{ fontWeight: 600, color: "#e8f0ea" }}>Roles</dt>
          <dd style={{ margin: 0 }}>{RoleSchema.options.join(" · ")}</dd>
        </div>
        <div>
          <dt style={{ fontWeight: 600, color: "#e8f0ea" }}>Alert states</dt>
          <dd style={{ margin: 0 }}>{AlertStateSchema.options.join(" · ")}</dd>
        </div>
      </dl>
    </main>
  );
}
