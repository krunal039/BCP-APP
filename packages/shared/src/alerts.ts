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

/** SMS-oriented body length (ACS / carrier practical limit for single segment + buffer). */
export const ALERT_BODY_MAX_LENGTH = 480;

export const TemplateLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .default("fr");
export type TemplateLocale = z.infer<typeof TemplateLocaleSchema>;

export const CreateTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(ALERT_BODY_MAX_LENGTH),
  locale: TemplateLocaleSchema,
  severity: AlertSeveritySchema.default("info"),
  active: z.boolean().default(true),
});
export type CreateTemplateRequest = z.infer<typeof CreateTemplateRequestSchema>;

export const UpdateTemplateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(ALERT_BODY_MAX_LENGTH).optional(),
    locale: TemplateLocaleSchema.optional(),
    severity: AlertSeveritySchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateTemplateRequest = z.infer<typeof UpdateTemplateRequestSchema>;

export const PublicTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  body: z.string(),
  locale: z.string(),
  severity: AlertSeveritySchema,
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicTemplate = z.infer<typeof PublicTemplateSchema>;

export const TemplateListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().trim().max(200).optional(),
  active: z
    .enum(["true", "false", "all"])
    .default("true")
    .transform((v) => (v === "all" ? ("all" as const) : v === "true")),
});
export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;

/**
 * Compose a draft (optionally submit for approval in one step).
 * `submitForApproval` defaults true → lands in pending_approval.
 */
export const ComposeAlertRequestSchema = z.object({
  templateId: z.string().uuid().optional(),
  /** Override / free-text body; required when templateId omitted. */
  body: z.string().trim().min(1).max(ALERT_BODY_MAX_LENGTH).optional(),
  severity: AlertSeveritySchema.optional(),
  groupIds: z.array(z.string().uuid()).min(1).max(50),
  /** When true (default), transition draft → pending_approval immediately. */
  submitForApproval: z.boolean().default(true),
  /** Client idempotency key — same key + sender returns the prior alert. */
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
export type ComposeAlertRequest = z.infer<typeof ComposeAlertRequestSchema>;

export const RejectAlertRequestSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type RejectAlertRequest = z.infer<typeof RejectAlertRequestSchema>;

export const BypassAlertRequestSchema = z.object({
  /** Mandatory urgent-bypass reason (audited). */
  reason: z.string().trim().min(3).max(2000),
});
export type BypassAlertRequest = z.infer<typeof BypassAlertRequestSchema>;

export const AlertListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  state: AlertStateSchema.optional(),
});
export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

/** One SMS/push target frozen at approve/bypass time. */
export const SnapshotTargetSchema = z.object({
  memberId: z.string().uuid(),
  displayName: z.string(),
  channel: z.enum(["sms", "push"]),
  address: z.string().min(1),
  countryCode: z.string().length(2).optional(),
  userId: z.string().uuid().nullable().optional(),
});
export type SnapshotTarget = z.infer<typeof SnapshotTargetSchema>;

export const AlertTargetSnapshotSchema = z.object({
  groupIds: z.array(z.string().uuid()),
  resolvedAt: z.string().datetime(),
  targets: z.array(SnapshotTargetSchema),
});
export type AlertTargetSnapshot = z.infer<typeof AlertTargetSnapshotSchema>;

export const PublicAlertSchema = z.object({
  id: z.string().uuid(),
  state: AlertStateSchema,
  severity: AlertSeveritySchema,
  body: z.string(),
  templateId: z.string().uuid().nullable(),
  senderUserId: z.string().uuid(),
  approverUserId: z.string().uuid().nullable(),
  bypassReason: z.string().nullable(),
  rejectNote: z.string().nullable(),
  targetGroupIds: z.array(z.string().uuid()),
  targetSnapshot: AlertTargetSnapshotSchema.nullable(),
  idempotencyKey: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicAlert = z.infer<typeof PublicAlertSchema>;

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

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  alertId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string(),
  payload: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  alertId: z.string().uuid().optional(),
  action: z.string().trim().max(120).optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

/** Intended delivery recorded by the stub DeliveryPort (no live ACS). */
export const StubDeliveryRecordSchema = z.object({
  alertId: z.string().uuid(),
  channel: z.enum(["sms", "push"]),
  address: z.string(),
  memberId: z.string().uuid().optional(),
  status: z.enum(["queued", "submitted", "delivered", "failed"]).default("queued"),
});
export type StubDeliveryRecord = z.infer<typeof StubDeliveryRecordSchema>;
