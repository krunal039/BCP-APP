import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { getPrisma } from "../db.js";
import { mapAcsDeliveryStatus } from "../delivery/webhook-map.js";
import { recomputeAlertDeliveryState } from "../jobs/fan-out.js";
import { writeAudit } from "../audit/write.js";

const EventGridEventSchema = z.object({
  id: z.string().optional(),
  eventType: z.string(),
  eventTime: z.string().optional(),
  data: z.unknown().optional(),
  subject: z.string().optional(),
});

const ValidationDataSchema = z.object({
  validationCode: z.string(),
  validationUrl: z.string().optional(),
});

const DeliveryReportDataSchema = z.object({
  messageId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  deliveryStatus: z.string(),
  deliveryStatusDetails: z.string().optional(),
  receivedTimestamp: z.string().optional(),
  /** ACS may send Tag or tag depending on serializer. */
  Tag: z.string().optional(),
  tag: z.string().optional(),
});

/**
 * ACS SMS delivery reports via Azure Event Grid.
 * POST /webhooks/acs/sms-delivery
 *
 * - Handles SubscriptionValidationEvent handshake
 * - Maps SMSDeliveryReportReceived → delivery_events by providerMessageId
 * - Optional shared secret (ACS_WEBHOOK_SECRET) — not required in CI
 */
export const acsWebhookPlugin = fp(async (app: FastifyInstance, opts: { env: Env }) => {
  const { env } = opts;

  app.post("/webhooks/acs/sms-delivery", async (request, reply) => {
    if (env.ACS_WEBHOOK_SECRET) {
      const header =
        (request.headers["x-acs-webhook-secret"] as string | undefined) ??
        (typeof request.headers.authorization === "string" &&
        request.headers.authorization.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length)
          : undefined);
      if (header !== env.ACS_WEBHOOK_SECRET) {
        return reply.code(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid ACS webhook secret",
        });
      }
    }

    const body = request.body;
    const eventsRaw = Array.isArray(body) ? body : body != null ? [body] : [];
    const parsedEvents = eventsRaw
      .map((e) => EventGridEventSchema.safeParse(e))
      .filter((r) => r.success)
      .map((r) => r.data);

    if (parsedEvents.length === 0) {
      return reply.code(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Expected Event Grid event array",
      });
    }

    // Event Grid subscription validation (single event typically).
    const validation = parsedEvents.find(
      (e) =>
        e.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent",
    );
    if (validation) {
      const data = ValidationDataSchema.safeParse(validation.data);
      if (!data.success) {
        return reply.code(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Missing validationCode",
        });
      }
      return reply.code(200).send({
        validationResponse: data.data.validationCode,
      });
    }

    const updated: Array<{
      messageId: string;
      status: string;
      deliveryEventId: string | null;
    }> = [];
    const unknownIds: string[] = [];
    // Lazily open Prisma only when a delivery report needs persistence
    // (keeps Event Grid validation / ignored events CI-safe without DATABASE_URL).
    let prisma: ReturnType<typeof getPrisma> | undefined;

    for (const event of parsedEvents) {
      if (
        event.eventType !==
        "Microsoft.Communication.SMSDeliveryReportReceived"
      ) {
        request.log.info(
          { eventType: event.eventType },
          "Ignoring non-delivery ACS event",
        );
        continue;
      }

      const data = DeliveryReportDataSchema.safeParse(event.data);
      if (!data.success) {
        request.log.warn(
          { issues: data.error.flatten() },
          "Malformed ACS delivery report",
        );
        continue;
      }

      const mapped = mapAcsDeliveryStatus(data.data.deliveryStatus);
      if (!mapped) {
        request.log.warn(
          {
            messageId: data.data.messageId,
            deliveryStatus: data.data.deliveryStatus,
          },
          "Unknown ACS deliveryStatus",
        );
        continue;
      }

      prisma ??= getPrisma();
      const messageId = data.data.messageId;
      const row = await prisma.deliveryEvent.findFirst({
        where: { providerMessageId: messageId, channel: "sms" },
      });

      if (!row) {
        unknownIds.push(messageId);
        request.log.warn(
          {
            messageId,
            tag: data.data.tag ?? data.data.Tag,
            to: data.data.to,
          },
          "ACS delivery report for unknown providerMessageId",
        );
        updated.push({
          messageId,
          status: mapped,
          deliveryEventId: null,
        });
        continue;
      }

      // Do not regress terminal states.
      if (row.status === "delivered" || row.status === "failed") {
        updated.push({
          messageId,
          status: row.status,
          deliveryEventId: row.id,
        });
        continue;
      }

      await prisma.deliveryEvent.update({
        where: { id: row.id },
        data: {
          status: mapped,
          errorCode:
            mapped === "failed"
              ? (data.data.deliveryStatusDetails ?? "acs_failed").slice(0, 200)
              : null,
        },
      });

      await writeAudit(prisma, {
        actorUserId: null,
        alertId: row.alertId,
        action: "alert.delivery_webhook",
        payload: {
          provider: "acs",
          messageId,
          status: mapped,
          to: data.data.to ?? null,
          deliveryEventId: row.id,
        },
      });

      await recomputeAlertDeliveryState(prisma, row.alertId);

      updated.push({
        messageId,
        status: mapped,
        deliveryEventId: row.id,
      });
    }

    return reply.code(200).send({
      ok: true,
      updated: updated.length,
      unknownMessageIds: unknownIds,
      results: updated,
    });
  });
});
