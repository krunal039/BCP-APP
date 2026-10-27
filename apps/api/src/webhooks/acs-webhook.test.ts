/**
 * ACS webhook unit tests — no DB / no Azure secrets required.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";

describe("ACS SMS delivery webhook", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    JWT_EXPIRES_IN: "1h",
    ACS_WEBHOOK_SECRET: "webhook-test-secret",
    // Intentionally omit ACS_CONNECTION_STRING so CI stays secret-free.
  });

  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    app = await buildApp(env);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("rejects missing webhook secret when configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/acs/sms-delivery",
      payload: [],
    });
    assert.equal(res.statusCode, 401);
  });

  it("handles Event Grid subscription validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/acs/sms-delivery",
      headers: { "x-acs-webhook-secret": "webhook-test-secret" },
      payload: [
        {
          id: "val-1",
          eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
          eventTime: "2026-10-27T00:00:00Z",
          data: {
            validationCode: "abc-validation-code",
            validationUrl: "https://example.invalid",
          },
        },
      ],
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      validationResponse: "abc-validation-code",
    });
  });

  it("ignores non-delivery event types without hitting the DB", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/acs/sms-delivery",
      headers: { "x-acs-webhook-secret": "webhook-test-secret" },
      payload: [
        {
          id: "evt-2",
          eventType: "Microsoft.Communication.SMSReceived",
          data: { messageId: "inbound" },
        },
      ],
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { updated: number };
    assert.equal(body.updated, 0);
  });
});
