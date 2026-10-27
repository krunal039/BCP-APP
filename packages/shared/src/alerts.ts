import { z } from "zod";

/**
 * Dual-control alert state machine.
 * Normal: draft → pending_approval → approved|rejected → sending → completed|partial_failure
 * Bypass: draft → bypassed → sending → completed|partial_failure
 *
 * Approver ≠ Sender is enforced server-side on every normal approve (not on clients).
 */
export const AlertStateSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "bypassed",
  "sending",
  "completed",
  "partial_failure",
]);
export type AlertState = z.infer<typeof AlertStateSchema>;

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertSummarySchema = z.object({
  id: z.string().uuid(),
  state: AlertStateSchema,
  severity: AlertSeveritySchema,
  senderUserId: z.string().uuid(),
  approverUserId: z.string().uuid().nullable(),
  bypassReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AlertSummary = z.infer<typeof AlertSummarySchema>;
