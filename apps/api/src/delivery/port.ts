import type { DeliveryStatus, SnapshotTarget } from "@bcp/shared";

/**
 * Delivery adapter boundary (ACS SMS + Expo push).
 * Stub keeps tests/dev working without Azure credentials.
 */

export type DeliveryProviderKind = "stub" | "acs";

export type DeliverySendResult = {
  channel: "sms" | "push";
  address: string;
  memberId?: string;
  /** Immediate post-send status (webhooks may refine later). */
  status: Extract<DeliveryStatus, "queued" | "submitted" | "failed">;
  providerMessageId: string | null;
  errorCode: string | null;
  provider: "acs" | "stub" | "expo-stub";
};

export interface DeliveryPort {
  /** Which backend will handle SMS fan-out. */
  readonly kind: DeliveryProviderKind;

  /**
   * Fan-out intended SMS/push deliveries for an alert on the send path
   * (approved or bypassed). Must be idempotent per (alertId, channel, address)
   * at the persistence layer.
   */
  enqueue(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<{ recorded: number; results: DeliverySendResult[] }>;
}

export type StubDeliveryRecord = {
  alertId: string;
  channel: "sms" | "push";
  address: string;
  memberId?: string;
  body: string;
  recordedAt: string;
};

/** In-memory stub — never calls ACS / Expo. Safe for tests + local MVP. */
export class StubDeliveryAdapter implements DeliveryPort {
  readonly kind = "stub" as const;
  readonly records: StubDeliveryRecord[] = [];

  async enqueue(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<{ recorded: number; results: DeliverySendResult[] }> {
    const now = new Date().toISOString();
    const results: DeliverySendResult[] = [];
    for (const t of input.targets) {
      this.records.push({
        alertId: input.alertId,
        channel: t.channel,
        address: t.address,
        memberId: t.memberId,
        body: input.body,
        recordedAt: now,
      });
      results.push({
        channel: t.channel,
        address: t.address,
        memberId: t.memberId,
        status: "submitted",
        providerMessageId: `stub-${input.alertId}`,
        errorCode: null,
        provider: t.channel === "sms" ? "stub" : "expo-stub",
      });
    }
    return { recorded: input.targets.length, results };
  }

  clear(): void {
    this.records.length = 0;
  }
}
