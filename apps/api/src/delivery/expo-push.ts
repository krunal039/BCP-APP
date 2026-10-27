import type { SnapshotTarget } from "@bcp/shared";
import type { DeliverySendResult } from "./port.js";
import type { PushSender } from "./push-sender.js";

const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts up to 100 messages per request. */
const DEFAULT_BATCH_SIZE = 100;

export type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type ExpoPushClientLike = {
  send(
    messages: Array<{
      to: string;
      title?: string;
      body: string;
      data?: Record<string, unknown>;
      sound?: string;
    }>,
  ): Promise<ExpoPushTicket[]>;
};

export type ExpoPushSenderOptions = {
  /** Optional Expo access token (Bearer) — recommended in production. */
  accessToken?: string;
  /** Override Expo Push HTTP endpoint (tests). */
  endpoint?: string;
  /** Injected for unit tests; production uses fetch. */
  client?: ExpoPushClientLike;
  batchSize?: number;
};

/**
 * Live Expo Push adapter (APNs/FCM via Expo).
 * Inject a mock `client` in tests — never hit exp.host from CI.
 */
export class ExpoPushSender implements PushSender {
  readonly provider = "expo" as const;
  private readonly client: ExpoPushClientLike;
  private readonly batchSize: number;

  constructor(options: ExpoPushSenderOptions = {}) {
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.client =
      options.client ??
      createFetchExpoPushClient({
        accessToken: options.accessToken,
        endpoint: options.endpoint ?? DEFAULT_EXPO_PUSH_URL,
      });
  }

  async send(input: {
    alertId: string;
    body: string;
    title?: string;
    targets: SnapshotTarget[];
  }): Promise<DeliverySendResult[]> {
    const results: DeliverySendResult[] = [];
    const title = input.title ?? "BCP Alert";

    for (let i = 0; i < input.targets.length; i += this.batchSize) {
      const batch = input.targets.slice(i, i + this.batchSize);
      const batchResults = await this.sendBatch({
        alertId: input.alertId,
        body: input.body,
        title,
        targets: batch,
      });
      results.push(...batchResults);
    }

    return results;
  }

  private async sendBatch(input: {
    alertId: string;
    body: string;
    title: string;
    targets: SnapshotTarget[];
  }): Promise<DeliverySendResult[]> {
    const messages = input.targets.map((t) => ({
      to: t.address,
      title: input.title,
      body: input.body,
      sound: "default",
      data: { alertId: input.alertId },
    }));

    let tickets: ExpoPushTicket[];
    try {
      tickets = await this.client.send(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : "expo_send_failed";
      return input.targets.map((t) => ({
        channel: "push" as const,
        address: t.address,
        memberId: t.memberId,
        status: "failed" as const,
        providerMessageId: null,
        errorCode: message.slice(0, 200),
        provider: "expo" as const,
      }));
    }

    return input.targets.map((t, index) => {
      const ticket = tickets[index];
      if (!ticket) {
        return {
          channel: "push" as const,
          address: t.address,
          memberId: t.memberId,
          status: "failed" as const,
          providerMessageId: null,
          errorCode: "expo_missing_ticket",
          provider: "expo" as const,
        };
      }
      if (ticket.status === "ok") {
        return {
          channel: "push" as const,
          address: t.address,
          memberId: t.memberId,
          status: "submitted" as const,
          providerMessageId: ticket.id ?? null,
          errorCode: null,
          provider: "expo" as const,
        };
      }
      const errorCode = (
        ticket.details?.error ??
        ticket.message ??
        "expo_error"
      ).slice(0, 200);
      return {
        channel: "push" as const,
        address: t.address,
        memberId: t.memberId,
        status: "failed" as const,
        providerMessageId: null,
        errorCode,
        provider: "expo" as const,
      };
    });
  }
}

function createFetchExpoPushClient(options: {
  accessToken?: string;
  endpoint: string;
}): ExpoPushClientLike {
  return {
    async send(messages) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      };
      if (options.accessToken) {
        headers.Authorization = `Bearer ${options.accessToken}`;
      }

      const res = await fetch(options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `expo_http_${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
        );
      }

      const json = (await res.json()) as {
        data?: ExpoPushTicket | ExpoPushTicket[];
        errors?: unknown;
      };

      if (Array.isArray(json.data)) return json.data;
      if (json.data && typeof json.data === "object") return [json.data];
      throw new Error("expo_invalid_response");
    },
  };
}
