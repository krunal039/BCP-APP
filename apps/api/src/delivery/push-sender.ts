import type { SnapshotTarget } from "@bcp/shared";
import type { DeliverySendResult } from "./port.js";

/**
 * Push channel backend (Expo Push API or in-memory stub).
 * SMS stays on ACS / stub; this only handles channel === "push".
 */
export interface PushSender {
  readonly provider: "expo" | "expo-stub";
  send(input: {
    alertId: string;
    body: string;
    title?: string;
    targets: SnapshotTarget[];
  }): Promise<DeliverySendResult[]>;
}

/** In-memory stub — never calls Expo. Safe for CI / local without Expo. */
export class StubPushSender implements PushSender {
  readonly provider = "expo-stub" as const;

  async send(input: {
    alertId: string;
    body: string;
    title?: string;
    targets: SnapshotTarget[];
  }): Promise<DeliverySendResult[]> {
    return input.targets.map((t) => ({
      channel: "push" as const,
      address: t.address,
      memberId: t.memberId,
      status: "submitted" as const,
      providerMessageId: `expo-stub-${input.alertId}`,
      errorCode: null,
      provider: "expo-stub" as const,
    }));
  }
}
