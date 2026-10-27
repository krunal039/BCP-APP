import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SnapshotTarget } from "@bcp/shared";
import { AcsSmsDeliveryAdapter, type SmsClientLike } from "./acs-sms.js";
import { mapAcsDeliveryStatus } from "./webhook-map.js";
import { resolveAlertStateAfterFanOut } from "../jobs/fan-out.js";
import { StubDeliveryAdapter } from "./port.js";
import { createDeliveryPort, isAcsConfigured } from "./factory.js";
import { loadEnv } from "../env.js";

function smsTarget(
  address: string,
  memberId = "11111111-1111-4111-8111-111111111111",
): SnapshotTarget {
  return {
    memberId,
    displayName: "Test",
    channel: "sms",
    address,
    countryCode: "CD",
  };
}

function pushTarget(
  address: string,
  memberId = "11111111-1111-4111-8111-111111111111",
): SnapshotTarget {
  return {
    memberId,
    displayName: "Test",
    channel: "push",
    address,
    userId: "22222222-2222-4222-8222-222222222222",
  };
}

describe("mapAcsDeliveryStatus", () => {
  it("maps Delivered / Failed case-insensitively", () => {
    assert.equal(mapAcsDeliveryStatus("Delivered"), "delivered");
    assert.equal(mapAcsDeliveryStatus("failed"), "failed");
    assert.equal(mapAcsDeliveryStatus("FAILED"), "failed");
    assert.equal(mapAcsDeliveryStatus("unknown"), null);
    assert.equal(mapAcsDeliveryStatus(null), null);
  });
});

describe("resolveAlertStateAfterFanOut", () => {
  it("completes immediately for stub submits", () => {
    assert.equal(
      resolveAlertStateAfterFanOut({
        providerKind: "stub",
        results: [
          {
            channel: "sms",
            address: "+243911000001",
            status: "submitted",
            providerMessageId: "stub-1",
            errorCode: null,
            provider: "stub",
          },
        ],
      }),
      "completed",
    );
  });

  it("keeps ACS alerts sending while submitted awaiting DLR", () => {
    assert.equal(
      resolveAlertStateAfterFanOut({
        providerKind: "acs",
        results: [
          {
            channel: "sms",
            address: "+243911000001",
            status: "submitted",
            providerMessageId: "msg-1",
            errorCode: null,
            provider: "acs",
          },
        ],
      }),
      "sending",
    );
  });

  it("marks partial_failure when ACS send fails", () => {
    assert.equal(
      resolveAlertStateAfterFanOut({
        providerKind: "acs",
        results: [
          {
            channel: "sms",
            address: "+243911000001",
            status: "failed",
            providerMessageId: null,
            errorCode: "http_400",
            provider: "acs",
          },
        ],
      }),
      "partial_failure",
    );
  });
});

describe("createDeliveryPort", () => {
  it("uses stub when ACS env is absent (CI-safe)", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    });
    assert.equal(isAcsConfigured(env), false);
    const { deliveryPort, stubDelivery } = createDeliveryPort(env);
    assert.equal(deliveryPort.kind, "stub");
    assert.equal(deliveryPort, stubDelivery);
  });

  it("selects ACS when connection string + from number are set", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      ACS_CONNECTION_STRING:
        "endpoint=https://example.communication.azure.com/;accesskey=fake",
      ACS_PHONE_NUMBER: "+15555550100",
    });
    assert.equal(isAcsConfigured(env), true);
    const { deliveryPort } = createDeliveryPort(env);
    assert.equal(deliveryPort.kind, "acs");
  });

  it("accepts SMS_FROM as alias for ACS_PHONE_NUMBER", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      ACS_CONNECTION_STRING:
        "endpoint=https://example.communication.azure.com/;accesskey=fake",
      SMS_FROM: "+15555550100",
    });
    assert.equal(env.ACS_PHONE_NUMBER, "+15555550100");
    assert.equal(isAcsConfigured(env), true);
  });
});

describe("AcsSmsDeliveryAdapter with mocked SmsClient", () => {
  it("maps successful ACS send results to submitted + messageId", async () => {
    const calls: unknown[] = [];
    const mockClient: SmsClientLike = {
      async send(request, options) {
        calls.push({ request, options });
        return request.to.map((to, i) => ({
          to,
          messageId: `acs-msg-${i}`,
          successful: true,
          httpStatusCode: 202,
        }));
      },
    };

    const adapter = new AcsSmsDeliveryAdapter({
      connectionString: "unused",
      fromPhoneNumber: "+15555550100",
      smsClient: mockClient,
    });

    const result = await adapter.enqueue({
      alertId: "11111111-1111-1111-1111-111111111111",
      body: "BCP drill",
      targets: [
        smsTarget("+243911000001", "11111111-1111-4111-8111-111111111111"),
        smsTarget("+243911000002", "33333333-3333-4333-8333-333333333333"),
        pushTarget("ExponentPushToken[test]"),
      ],
    });

    assert.equal(result.recorded, 3);
    assert.equal(calls.length, 1);
    const call = calls[0] as {
      request: { from: string; to: string[]; message: string };
      options: { enableDeliveryReport?: boolean; tag?: string };
    };
    assert.equal(call.request.from, "+15555550100");
    assert.deepEqual(call.request.to, ["+243911000001", "+243911000002"]);
    assert.equal(call.options.enableDeliveryReport, true);
    assert.equal(call.options.tag, "11111111-1111-1111-1111-111111111111");

    const sms = result.results.filter((r) => r.channel === "sms");
    assert.equal(sms.length, 2);
    assert.ok(sms.every((r) => r.status === "submitted" && r.provider === "acs"));
    assert.equal(sms[0]!.providerMessageId, "acs-msg-0");

    const push = result.results.find((r) => r.channel === "push");
    assert.ok(push);
    assert.equal(push!.provider, "expo-stub");
    assert.equal(push!.status, "submitted");
  });

  it("marks failed when ACS reports unsuccessful", async () => {
    const mockClient: SmsClientLike = {
      async send(request) {
        return request.to.map((to) => ({
          to,
          successful: false,
          httpStatusCode: 400,
          errorMessage: "InvalidToPhoneNumber",
        }));
      },
    };

    const adapter = new AcsSmsDeliveryAdapter({
      connectionString: "unused",
      fromPhoneNumber: "+15555550100",
      smsClient: mockClient,
    });

    const result = await adapter.enqueue({
      alertId: "22222222-2222-2222-2222-222222222222",
      body: "fail",
      targets: [smsTarget("+243911000099")],
    });

    assert.equal(result.results[0]!.status, "failed");
    assert.equal(result.results[0]!.errorCode, "InvalidToPhoneNumber");
    assert.equal(result.results[0]!.providerMessageId, null);
  });

  it("marks all failed when ACS client throws", async () => {
    const mockClient: SmsClientLike = {
      async send() {
        throw new Error("network_down");
      },
    };

    const adapter = new AcsSmsDeliveryAdapter({
      connectionString: "unused",
      fromPhoneNumber: "+15555550100",
      smsClient: mockClient,
    });

    const result = await adapter.enqueue({
      alertId: "33333333-3333-3333-3333-333333333333",
      body: "fail",
      targets: [smsTarget("+243911000001"), smsTarget("+243911000002")],
    });

    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.status === "failed"));
    assert.ok(result.results.every((r) => r.errorCode === "network_down"));
  });

  it("batches recipients by batchSize", async () => {
    const batchSizes: number[] = [];
    const mockClient: SmsClientLike = {
      async send(request) {
        batchSizes.push(request.to.length);
        return request.to.map((to) => ({
          to,
          messageId: `id-${to}`,
          successful: true,
          httpStatusCode: 202,
        }));
      },
    };

    const adapter = new AcsSmsDeliveryAdapter({
      connectionString: "unused",
      fromPhoneNumber: "+15555550100",
      smsClient: mockClient,
      batchSize: 2,
    });

    await adapter.enqueue({
      alertId: "44444444-4444-4444-4444-444444444444",
      body: "batch",
      targets: [
        smsTarget("+243911000001"),
        smsTarget("+243911000002"),
        smsTarget("+243911000003"),
      ],
    });

    assert.deepEqual(batchSizes, [2, 1]);
  });
});

describe("StubDeliveryAdapter", () => {
  it("still records and returns submitted results", async () => {
    const stub = new StubDeliveryAdapter();
    const result = await stub.enqueue({
      alertId: "55555555-5555-5555-5555-555555555555",
      body: "hi",
      targets: [smsTarget("+243911000001")],
    });
    assert.equal(stub.kind, "stub");
    assert.equal(stub.records.length, 1);
    assert.equal(result.results[0]!.status, "submitted");
    assert.equal(result.results[0]!.provider, "stub");
  });
});
