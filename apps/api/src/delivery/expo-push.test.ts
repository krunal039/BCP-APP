import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SnapshotTarget } from "@bcp/shared";
import { ExpoPushSender, type ExpoPushClientLike } from "./expo-push.js";
import {
  createDeliveryPort,
  createPushSender,
  isExpoPushEnabled,
} from "./factory.js";
import { StubPushSender } from "./push-sender.js";
import { loadEnv } from "../env.js";

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

describe("createPushSender / isExpoPushEnabled", () => {
  it("stubs push when EXPO_PUSH_ENABLED is unset (CI-safe)", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    });
    assert.equal(isExpoPushEnabled(env), false);
    const sender = createPushSender(env);
    assert.equal(sender.provider, "expo-stub");
    assert.ok(sender instanceof StubPushSender);
  });

  it("selects live Expo sender when EXPO_PUSH_ENABLED=true", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      EXPO_PUSH_ENABLED: "true",
      EXPO_ACCESS_TOKEN: "test-expo-token",
    });
    assert.equal(isExpoPushEnabled(env), true);
    const sender = createPushSender(env);
    assert.equal(sender.provider, "expo");
  });

  it("wires StubSmsExpoDeliveryAdapter when Expo on and ACS off", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      EXPO_PUSH_ENABLED: "1",
    });
    const { deliveryPort } = createDeliveryPort(env);
    assert.equal(deliveryPort.kind, "stub");
  });
});

describe("ExpoPushSender with mocked client", () => {
  it("maps ok tickets to submitted + providerMessageId", async () => {
    const calls: unknown[] = [];
    const mockClient: ExpoPushClientLike = {
      async send(messages) {
        calls.push(messages);
        return messages.map((_, i) => ({
          status: "ok" as const,
          id: `ticket-${i}`,
        }));
      },
    };

    const sender = new ExpoPushSender({ client: mockClient });
    const results = await sender.send({
      alertId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      body: "Drill alert",
      targets: [
        pushTarget("ExponentPushToken[aaa]"),
        pushTarget("ExponentPushToken[bbb]"),
      ],
    });

    assert.equal(calls.length, 1);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.provider === "expo"));
    assert.ok(results.every((r) => r.status === "submitted"));
    assert.equal(results[0]!.providerMessageId, "ticket-0");
  });

  it("maps DeviceNotRegistered to failed with that errorCode", async () => {
    const mockClient: ExpoPushClientLike = {
      async send() {
        return [
          {
            status: "error",
            message: "Not registered",
            details: { error: "DeviceNotRegistered" },
          },
        ];
      },
    };

    const sender = new ExpoPushSender({ client: mockClient });
    const results = await sender.send({
      alertId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      body: "x",
      targets: [pushTarget("ExponentPushToken[stale]")],
    });

    assert.equal(results[0]!.status, "failed");
    assert.equal(results[0]!.errorCode, "DeviceNotRegistered");
  });

  it("marks all failed when client throws", async () => {
    const mockClient: ExpoPushClientLike = {
      async send() {
        throw new Error("network_down");
      },
    };

    const sender = new ExpoPushSender({ client: mockClient });
    const results = await sender.send({
      alertId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      body: "x",
      targets: [
        pushTarget("ExponentPushToken[a]"),
        pushTarget("ExponentPushToken[b]"),
      ],
    });

    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.status === "failed"));
    assert.ok(results.every((r) => r.errorCode === "network_down"));
  });

  it("batches by batchSize", async () => {
    const sizes: number[] = [];
    const mockClient: ExpoPushClientLike = {
      async send(messages) {
        sizes.push(messages.length);
        return messages.map(() => ({ status: "ok" as const, id: "t" }));
      },
    };

    const sender = new ExpoPushSender({ client: mockClient, batchSize: 2 });
    await sender.send({
      alertId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      body: "batch",
      targets: [
        pushTarget("ExponentPushToken[1]"),
        pushTarget("ExponentPushToken[2]"),
        pushTarget("ExponentPushToken[3]"),
      ],
    });

    assert.deepEqual(sizes, [2, 1]);
  });
});

describe("StubPushSender", () => {
  it("returns submitted expo-stub results without network", async () => {
    const stub = new StubPushSender();
    const results = await stub.send({
      alertId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      body: "hi",
      targets: [pushTarget("ExponentPushToken[x]")],
    });
    assert.equal(results[0]!.provider, "expo-stub");
    assert.equal(results[0]!.status, "submitted");
  });
});
