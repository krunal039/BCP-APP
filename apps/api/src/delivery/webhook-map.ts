import type { DeliveryStatus } from "@bcp/shared";

/**
 * Map ACS Event Grid SMSDeliveryReportReceived.deliveryStatus → our enum.
 * ACS documents: Delivered | Failed (case may vary by payload).
 */
export function mapAcsDeliveryStatus(
  raw: string | undefined | null,
): Extract<DeliveryStatus, "delivered" | "failed"> | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "delivered") return "delivered";
  if (normalized === "failed") return "failed";
  return null;
}
