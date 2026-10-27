import { z } from "zod";

export const DeliveryChannelSchema = z.enum(["sms", "push"]);
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;

/** Per-recipient delivery lifecycle (ACS webhooks + Expo receipts). */
export const DeliveryStatusSchema = z.enum([
  "queued",
  "submitted",
  "delivered",
  "failed",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const DeliveryEventSchema = z.object({
  id: z.string().uuid(),
  alertId: z.string().uuid(),
  channel: DeliveryChannelSchema,
  status: DeliveryStatusSchema,
  providerMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type DeliveryEvent = z.infer<typeof DeliveryEventSchema>;
