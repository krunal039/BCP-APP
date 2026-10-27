import { SmsClient } from "@azure/communication-sms";
import type { SnapshotTarget } from "@bcp/shared";
import type {
  DeliveryPort,
  DeliverySendResult,
} from "./port.js";

/** Narrow surface so unit tests can mock ACS without the real SDK. */
export type SmsClientLike = {
  send(
    request: { from: string; to: string[]; message: string },
    options?: { enableDeliveryReport?: boolean; tag?: string },
  ): Promise<
    Array<{
      to: string;
      messageId?: string;
      successful: boolean;
      httpStatusCode: number;
      errorMessage?: string;
    }>
  >;
};

export type AcsSmsDeliveryOptions = {
  connectionString: string;
  /** ACS-owned E.164 sender (or alphanumeric sender ID where supported). */
  fromPhoneNumber: string;
  /** Injected for tests; production constructs SmsClient from connectionString. */
  smsClient?: SmsClientLike;
  /** Max recipients per ACS send() call (SDK accepts a batch). */
  batchSize?: number;
};

/**
 * DeliveryPort that sends SMS via Azure Communication Services.
 * Push targets are recorded as Expo placeholders (E6 lands real push).
 */
export class AcsSmsDeliveryAdapter implements DeliveryPort {
  readonly kind = "acs" as const;
  private readonly from: string;
  private readonly client: SmsClientLike;
  private readonly batchSize: number;

  constructor(options: AcsSmsDeliveryOptions) {
    this.from = options.fromPhoneNumber;
    this.batchSize = Math.max(1, options.batchSize ?? 100);
    this.client =
      options.smsClient ??
      (new SmsClient(options.connectionString) as unknown as SmsClientLike);
  }

  async enqueue(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<{ recorded: number; results: DeliverySendResult[] }> {
    const results: DeliverySendResult[] = [];
    const smsTargets = input.targets.filter((t) => t.channel === "sms");
    const pushTargets = input.targets.filter((t) => t.channel === "push");

    for (let i = 0; i < smsTargets.length; i += this.batchSize) {
      const batch = smsTargets.slice(i, i + this.batchSize);
      const batchResults = await this.sendSmsBatch({
        alertId: input.alertId,
        body: input.body,
        targets: batch,
      });
      results.push(...batchResults);
    }

    for (const t of pushTargets) {
      // Expo push remains a placeholder until E6.
      results.push({
        channel: "push",
        address: t.address,
        memberId: t.memberId,
        status: "submitted",
        providerMessageId: `expo-stub-${input.alertId}`,
        errorCode: null,
        provider: "expo-stub",
      });
    }

    return { recorded: results.length, results };
  }

  private async sendSmsBatch(input: {
    alertId: string;
    body: string;
    targets: SnapshotTarget[];
  }): Promise<DeliverySendResult[]> {
    const to = input.targets.map((t) => t.address);
    const byAddress = new Map(input.targets.map((t) => [t.address, t]));

    let sendResults: Awaited<ReturnType<SmsClientLike["send"]>>;
    try {
      sendResults = await this.client.send(
        {
          from: this.from,
          to,
          message: input.body,
        },
        {
          enableDeliveryReport: true,
          // Echoed on Event Grid delivery reports for correlation fallback.
          tag: input.alertId,
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "acs_send_failed";
      return input.targets.map((t) => ({
        channel: "sms" as const,
        address: t.address,
        memberId: t.memberId,
        status: "failed" as const,
        providerMessageId: null,
        errorCode: message.slice(0, 200),
        provider: "acs" as const,
      }));
    }

    const seen = new Set<string>();
    const mapped: DeliverySendResult[] = sendResults.map((r) => {
      seen.add(r.to);
      const target = byAddress.get(r.to);
      return {
        channel: "sms" as const,
        address: r.to,
        memberId: target?.memberId,
        status: r.successful ? ("submitted" as const) : ("failed" as const),
        providerMessageId: r.messageId ?? null,
        errorCode: r.successful
          ? null
          : (r.errorMessage ?? `http_${r.httpStatusCode}`).slice(0, 200),
        provider: "acs" as const,
      };
    });

    // Any targets missing from ACS response → failed.
    for (const t of input.targets) {
      if (!seen.has(t.address)) {
        mapped.push({
          channel: "sms",
          address: t.address,
          memberId: t.memberId,
          status: "failed",
          providerMessageId: null,
          errorCode: "acs_missing_result",
          provider: "acs",
        });
      }
    }

    return mapped;
  }
}
