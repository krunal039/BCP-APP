import type {
  AlertSeverity,
  AlertState,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  AlertListQuerySchema,
  AuditListQuerySchema,
  BypassAlertRequestSchema,
  ComposeAlertRequestSchema,
  RejectAlertRequestSchema,
  type AlertTargetSnapshot,
  type SnapshotTarget,
} from "@bcp/shared";
import { writeAudit } from "../audit/write.js";
import type { DeliveryPort } from "../delivery/port.js";
import { resolveTargetSnapshot } from "./snapshot.js";

type AlertRow = {
  id: string;
  state: AlertState;
  severity: AlertSeverity;
  body: string;
  templateId: string | null;
  senderUserId: string;
  approverUserId: string | null;
  bypassReason: string | null;
  rejectNote: string | null;
  targetGroupIds: Prisma.JsonValue;
  targetSnapshot: Prisma.JsonValue | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asSnapshot(
  value: Prisma.JsonValue | null,
): AlertTargetSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.groupIds) || !Array.isArray(obj.targets)) return null;
  if (typeof obj.resolvedAt !== "string") return null;
  return value as unknown as AlertTargetSnapshot;
}

export function toPublicAlert(alert: AlertRow) {
  return {
    id: alert.id,
    state: alert.state,
    severity: alert.severity,
    body: alert.body,
    templateId: alert.templateId,
    senderUserId: alert.senderUserId,
    approverUserId: alert.approverUserId,
    bypassReason: alert.bypassReason,
    rejectNote: alert.rejectNote,
    targetGroupIds: asStringArray(alert.targetGroupIds),
    targetSnapshot: asSnapshot(alert.targetSnapshot),
    idempotencyKey: alert.idempotencyKey,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  };
}

type Actor = {
  id: string;
  roles: readonly string[];
  urgentBypass: boolean;
};

export class AlertService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly delivery: DeliveryPort,
  ) {}

  async list(rawQuery: unknown) {
    const parsed = AlertListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid list query" };
    }
    const { page, limit, state } = parsed.data;
    const where: Prisma.AlertWhereInput = state ? { state } : {};

    const [total, items] = await Promise.all([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        items: items.map(toPublicAlert),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    return { ok: true as const, alert: toPublicAlert(alert) };
  }

  /**
   * Sender composes from template + groups (+ optional body/severity override).
   * Default path lands in pending_approval (dual-control).
   */
  async compose(actor: Actor, raw: unknown) {
    const parsed = ComposeAlertRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid compose payload",
      };
    }
    const data = parsed.data;

    if (data.idempotencyKey) {
      const existing = await this.prisma.alert.findFirst({
        where: {
          senderUserId: actor.id,
          idempotencyKey: data.idempotencyKey,
        },
      });
      if (existing) {
        return { ok: true as const, alert: toPublicAlert(existing), idempotent: true as const };
      }
    }

    let body = data.body;
    let severity = data.severity;
    let templateId: string | null = data.templateId ?? null;

    if (data.templateId) {
      const template = await this.prisma.template.findUnique({
        where: { id: data.templateId },
      });
      if (!template || !template.active) {
        return {
          ok: false as const,
          statusCode: 400 as const,
          message: "Template not found or inactive",
        };
      }
      body = body ?? template.body;
      severity = severity ?? template.severity;
      templateId = template.id;
    }

    if (!body) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: "body is required when templateId is omitted",
      };
    }
    if (!severity) {
      severity = "info";
    }

    const groupCheck = await this.validateGroupsSendable(data.groupIds);
    if (!groupCheck.ok) return groupCheck;

    const state: AlertState = data.submitForApproval
      ? "pending_approval"
      : "draft";

    try {
      const alert = await this.prisma.$transaction(async (tx) => {
        const created = await tx.alert.create({
          data: {
            state,
            severity: severity!,
            body,
            templateId,
            senderUserId: actor.id,
            targetGroupIds: data.groupIds,
            idempotencyKey: data.idempotencyKey ?? null,
          },
        });
        await writeAudit(tx, {
          actorUserId: actor.id,
          alertId: created.id,
          action:
            state === "pending_approval"
              ? "alert.submit_for_approval"
              : "alert.compose_draft",
          payload: {
            groupIds: data.groupIds,
            severity,
            templateId,
            state,
          },
        });
        return created;
      });

      return { ok: true as const, alert: toPublicAlert(alert), idempotent: false as const };
    } catch (err) {
      if (isUniqueViolation(err) && data.idempotencyKey) {
        const existing = await this.prisma.alert.findFirst({
          where: {
            senderUserId: actor.id,
            idempotencyKey: data.idempotencyKey,
          },
        });
        if (existing) {
          return {
            ok: true as const,
            alert: toPublicAlert(existing),
            idempotent: true as const,
          };
        }
      }
      throw err;
    }
  }

  /** Transition draft → pending_approval. */
  async submitForApproval(actor: Actor, alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    if (alert.senderUserId !== actor.id && !actor.roles.includes("admin")) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "Only the sender (or admin) can submit this alert",
      };
    }
    if (alert.state !== "draft") {
      return {
        ok: false as const,
        statusCode: 409 as const,
        message: `Cannot submit alert in state ${alert.state}`,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.alert.update({
        where: { id: alertId },
        data: { state: "pending_approval" },
      });
      await writeAudit(tx, {
        actorUserId: actor.id,
        alertId,
        action: "alert.submit_for_approval",
        payload: { from: "draft", to: "pending_approval" },
      });
      return next;
    });

    return { ok: true as const, alert: toPublicAlert(updated) };
  }

  /**
   * Approver ≠ Sender enforced here. Same userId as sender → 403.
   * On success: snapshot recipients, enqueue stub delivery, mark sent.
   */
  async approve(actor: Actor, alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    if (alert.state !== "pending_approval") {
      return {
        ok: false as const,
        statusCode: 409 as const,
        message: `Cannot approve alert in state ${alert.state}`,
      };
    }
    if (actor.id === alert.senderUserId) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "Approver must not be the same person as the Sender",
      };
    }

    const resolved = await resolveTargetSnapshot(
      this.prisma,
      asStringArray(alert.targetGroupIds),
    );
    if (!resolved.ok) return resolved;

    const updated = await this.persistSendPath({
      alert,
      actorUserId: actor.id,
      nextState: "approved",
      approverUserId: actor.id,
      snapshot: resolved.snapshot,
      auditAction: "alert.approve",
      approvalDecision: "approved",
    });

    return { ok: true as const, alert: toPublicAlert(updated) };
  }

  async reject(actor: Actor, alertId: string, raw: unknown) {
    const parsed = RejectAlertRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid reject payload",
      };
    }

    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    if (alert.state !== "pending_approval") {
      return {
        ok: false as const,
        statusCode: 409 as const,
        message: `Cannot reject alert in state ${alert.state}`,
      };
    }
    if (actor.id === alert.senderUserId) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "Approver must not be the same person as the Sender",
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.alert.update({
        where: { id: alertId },
        data: {
          state: "rejected",
          approverUserId: actor.id,
          rejectNote: parsed.data.note ?? null,
        },
      });
      await tx.approval.create({
        data: {
          alertId,
          actorUserId: actor.id,
          decision: "rejected",
          note: parsed.data.note ?? null,
        },
      });
      await writeAudit(tx, {
        actorUserId: actor.id,
        alertId,
        action: "alert.reject",
        payload: {
          note: parsed.data.note ?? null,
          senderUserId: alert.senderUserId,
        },
      });
      return next;
    });

    return { ok: true as const, alert: toPublicAlert(updated) };
  }

  /**
   * Urgent bypass: draft|pending_approval → bypassed → sending → completed.
   * Requires urgentBypass capability + mandatory reason; fully audited.
   */
  async bypass(actor: Actor, alertId: string, raw: unknown) {
    const parsed = BypassAlertRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "bypassReason is required",
      };
    }
    if (!actor.urgentBypass) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "urgentBypass capability required",
      };
    }

    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    if (alert.state !== "draft" && alert.state !== "pending_approval") {
      return {
        ok: false as const,
        statusCode: 409 as const,
        message: `Cannot bypass alert in state ${alert.state}`,
      };
    }
    if (alert.senderUserId !== actor.id && !actor.roles.includes("admin")) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "Only the sender (or admin) with bypass capability can bypass",
      };
    }

    const resolved = await resolveTargetSnapshot(
      this.prisma,
      asStringArray(alert.targetGroupIds),
    );
    if (!resolved.ok) return resolved;

    const updated = await this.persistSendPath({
      alert,
      actorUserId: actor.id,
      nextState: "bypassed",
      approverUserId: null,
      bypassReason: parsed.data.reason,
      snapshot: resolved.snapshot,
      auditAction: "alert.bypass",
      approvalDecision: "bypassed",
    });

    return { ok: true as const, alert: toPublicAlert(updated) };
  }

  /**
   * Compose + bypass in one call for capable senders (draft → bypassed).
   * Still requires mandatory reason.
   */
  async composeAndBypass(actor: Actor, raw: unknown) {
    if (!actor.urgentBypass) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        message: "urgentBypass capability required",
      };
    }

    const body = (raw ?? {}) as Record<string, unknown>;
    const reason =
      typeof body.reason === "string"
        ? body.reason
        : typeof body.bypassReason === "string"
          ? body.bypassReason
          : undefined;

    const reasonParsed = BypassAlertRequestSchema.safeParse({ reason });
    if (!reasonParsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: reasonParsed.error.issues[0]?.message ?? "reason is required",
      };
    }

    const composeRaw = {
      templateId: body.templateId,
      body: body.body,
      severity: body.severity,
      groupIds: body.groupIds,
      submitForApproval: false,
      idempotencyKey: body.idempotencyKey,
    };
    const composed = await this.compose(actor, composeRaw);
    if (!composed.ok) return composed;

    return this.bypass(actor, composed.alert.id, {
      reason: reasonParsed.data.reason,
    });
  }

  async listAudit(rawQuery: unknown) {
    const parsed = AuditListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid audit query" };
    }
    const { page, limit, alertId, action } = parsed.data;
    const where: Prisma.AuditEventWhereInput = {};
    if (alertId) where.alertId = alertId;
    if (action) where.action = action;

    const [total, items] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        items: items.map((e) => ({
          id: e.id,
          alertId: e.alertId,
          actorUserId: e.actorUserId,
          action: e.action,
          payload: e.payload,
          createdAt: e.createdAt.toISOString(),
        })),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async listDeliveries(alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return { ok: false as const, statusCode: 404 as const, message: "Alert not found" };
    }
    const events = await this.prisma.deliveryEvent.findMany({
      where: { alertId },
      orderBy: [{ channel: "asc" }, { targetAddress: "asc" }],
    });
    return {
      ok: true as const,
      result: {
        alertId,
        items: events.map((e) => ({
          id: e.id,
          channel: e.channel,
          status: e.status,
          targetAddress: e.targetAddress,
          recipientUserId: e.recipientUserId,
          providerMessageId: e.providerMessageId,
          errorCode: e.errorCode,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
      },
    };
  }

  private async validateGroupsSendable(groupIds: string[]) {
    const unique = [...new Set(groupIds)];
    const groups = await this.prisma.group.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (groups.length !== unique.length) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: "One or more groupIds do not exist",
      };
    }

    for (const groupId of unique) {
      const hit = await this.prisma.groupMember.findFirst({
        where: {
          groupId,
          member: {
            active: true,
            phones: { some: { active: true } },
          },
        },
        select: { memberId: true },
      });
      if (!hit) {
        return {
          ok: false as const,
          statusCode: 400 as const,
          message: `Group ${groupId} is empty or non-sendable`,
        };
      }
    }

    return { ok: true as const };
  }

  /**
   * Shared approve/bypass send path:
   * approved|bypassed → persist snapshot + delivery rows → stub enqueue → sending → completed.
   */
  private async persistSendPath(input: {
    alert: AlertRow;
    actorUserId: string;
    nextState: "approved" | "bypassed";
    approverUserId: string | null;
    bypassReason?: string;
    snapshot: AlertTargetSnapshot;
    auditAction: string;
    approvalDecision: string;
  }) {
    const {
      alert,
      actorUserId,
      nextState,
      approverUserId,
      bypassReason,
      snapshot,
      auditAction,
      approvalDecision,
    } = input;

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.alert.update({
        where: { id: alert.id },
        data: {
          state: nextState,
          approverUserId,
          bypassReason: bypassReason ?? null,
          targetSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.approval.create({
        data: {
          alertId: alert.id,
          actorUserId,
          decision: approvalDecision,
          note: bypassReason ?? null,
        },
      });

      await writeAudit(tx, {
        actorUserId,
        alertId: alert.id,
        action: auditAction,
        payload: {
          bypass: nextState === "bypassed",
          bypassReason: bypassReason ?? null,
          senderUserId: alert.senderUserId,
          approverUserId,
          groupIds: snapshot.groupIds,
          targetCount: snapshot.targets.length,
          targets: snapshot.targets.map((t) => ({
            channel: t.channel,
            address: t.address,
            memberId: t.memberId,
          })),
        },
      });

      // Persist delivery rows (idempotent unique on alert+channel+address).
      for (const target of snapshot.targets) {
        await tx.deliveryEvent.upsert({
          where: {
            alertId_channel_targetAddress: {
              alertId: alert.id,
              channel: target.channel,
              targetAddress: target.address,
            },
          },
          create: {
            alertId: alert.id,
            channel: target.channel,
            targetAddress: target.address,
            recipientUserId: target.userId ?? null,
            status: "queued",
          },
          update: {},
        });
      }

      return next;
    });

    // Stub adapter records intended SMS/push (no live ACS).
    await this.delivery.enqueue({
      alertId: alert.id,
      body: alert.body,
      targets: snapshot.targets as SnapshotTarget[],
    });

    // Advance sending → completed for stub path (real ACS worker is E5).
    const sent = await this.prisma.$transaction(async (tx) => {
      await tx.alert.update({
        where: { id: alert.id },
        data: { state: "sending" },
      });
      await tx.deliveryEvent.updateMany({
        where: { alertId: alert.id, status: "queued" },
        data: {
          status: "submitted",
          providerMessageId: `stub-${alert.id}`,
        },
      });
      const completed = await tx.alert.update({
        where: { id: alert.id },
        data: { state: "completed" },
      });
      await writeAudit(tx, {
        actorUserId,
        alertId: alert.id,
        action: "alert.delivery_stub_enqueued",
        payload: {
          targetCount: snapshot.targets.length,
          provider: "stub",
        },
      });
      return completed;
    });

    // Preserve approved/bypassed semantics in response via re-read fields;
    // final state is completed after stub send.
    return {
      ...sent,
      // Keep decision metadata from the pre-send update.
      approverUserId: updated.approverUserId,
      bypassReason: updated.bypassReason,
      targetSnapshot: updated.targetSnapshot,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
