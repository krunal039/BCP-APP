/**
 * ACS webhook → delivery_events persistence.
 * Skips when DATABASE_URL is unset (CI unit job uses a placeholder URL only —
 * set BCP_RUN_DB_TESTS=1 to force these when a migrated Postgres is available).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";

const hasDb =
  Boolean(process.env.DATABASE_URL) &&
  (process.env.BCP_RUN_DB_TESTS === "1" ||
    process.env.npm_lifecycle_event === "test:integration");

describe("ACS webhook updates delivery_events", { skip: !hasDb }, () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  });

  const prisma = new PrismaClient();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let alertId = "";

  before(async () => {
    app = await buildApp(env);
    await app.ready();

    const sender = await prisma.user.upsert({
      where: { username: "acs_wh_sender" },
      create: {
        username: "acs_wh_sender",
        displayName: "ACS WH",
        passwordHash: "x",
        roles: { create: [{ role: "sender" }] },
      },
      update: {},
    });

    const alert = await prisma.alert.create({
      data: {
        state: "sending",
        severity: "critical",
        body: "webhook drill",
        senderUserId: sender.id,
        targetGroupIds: [],
      },
    });
    alertId = alert.id;

    await prisma.deliveryEvent.create({
      data: {
        alertId: alert.id,
        channel: "sms",
        targetAddress: "+243911000777",
        status: "submitted",
        providerMessageId: "acs-dlr-message-777",
      },
    });
  });

  after(async () => {
    if (alertId) {
      await prisma.deliveryEvent.deleteMany({ where: { alertId } });
      await prisma.auditEvent.deleteMany({ where: { alertId } });
      await prisma.alert.deleteMany({ where: { id: alertId } });
      await prisma.userRole.deleteMany({
        where: { user: { username: "acs_wh_sender" } },
      });
      await prisma.user.deleteMany({ where: { username: "acs_wh_sender" } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it("logs unknown providerMessageId without failing the webhook", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/acs/sms-delivery",
      payload: [
        {
          id: "evt-1",
          eventType: "Microsoft.Communication.SMSDeliveryReportReceived",
          data: {
            messageId: "unknown-acs-message-id",
            from: "15555550100",
            to: "+243911000001",
            deliveryStatus: "Delivered",
            deliveryStatusDetails: "No error.",
            tag: "11111111-1111-1111-1111-111111111111",
          },
        },
      ],
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      unknownMessageIds: string[];
      results: Array<{ messageId: string; deliveryEventId: string | null }>;
    };
    assert.equal(body.ok, true);
    assert.deepEqual(body.unknownMessageIds, ["unknown-acs-message-id"]);
    assert.equal(body.results[0]!.deliveryEventId, null);
  });

  it("maps Delivered webhook onto delivery_event and completes alert", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/acs/sms-delivery",
      payload: [
        {
          id: "evt-dlr",
          eventType: "Microsoft.Communication.SMSDeliveryReportReceived",
          data: {
            messageId: "acs-dlr-message-777",
            to: "+243911000777",
            deliveryStatus: "Delivered",
            deliveryStatusDetails: "No error.",
          },
        },
      ],
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      results: Array<{ status: string; deliveryEventId: string | null }>;
    };
    assert.equal(body.results[0]!.status, "delivered");
    assert.ok(body.results[0]!.deliveryEventId);

    const row = await prisma.deliveryEvent.findFirst({
      where: { providerMessageId: "acs-dlr-message-777" },
    });
    assert.equal(row?.status, "delivered");
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    assert.equal(alert?.state, "completed");
  });
});
