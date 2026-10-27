import { z } from "zod";

/** Expo push token shape (ExponentPushToken[…] or ExpoPushToken[…]). */
export const ExpoPushTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(512)
  .regex(
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/,
    "Must be an Expo push token (ExponentPushToken[…] or ExpoPushToken[…])",
  );

export const RegisterDeviceTokenRequestSchema = z.object({
  expoToken: ExpoPushTokenSchema,
});
export type RegisterDeviceTokenRequest = z.infer<
  typeof RegisterDeviceTokenRequestSchema
>;

export const PublicDeviceTokenSchema = z.object({
  id: z.string().uuid(),
  expoToken: z.string(),
  active: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type PublicDeviceToken = z.infer<typeof PublicDeviceTokenSchema>;
