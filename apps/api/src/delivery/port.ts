import type { SnapshotTarget } from "@bcp/shared";

/**
 * Delivery adapter boundary (ACS SMS + Expo push land in E5/E6).
 * MVP E4 uses a stub that records intended targets only — no live ACS.
 */
export interface DeliveryPort {
  /**
   * Record intended SMS/push deliveries for an alert that has entered
   * the send path (approved or bypassed). Must be idempotent per
   * (alertId, channel, address) at the persistence layer.
   */
  enqueue(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<{ recorded: number }>;
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
  readonly records: StubDeliveryRecord[] = [];

  async enqueue(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<{ recorded: number }> {
    const now = new Date().toISOString();
    for (const t of input.targets) {
      this.records.push({
        alertId: input.alertId,
        channel: t.channel,
        address: t.address,
        memberId: t.memberId,
        body: input.body,
        recordedAt: now,
      });
    }
    return { recorded: input.targets.length };
  }

  clear(): void {
    this.records.length = 0;
  }
}
