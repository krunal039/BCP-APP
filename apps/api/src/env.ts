import { z } from "zod";

/** Parse duration strings like "8h", "15m", "3600s", or plain seconds. */
function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)([smhd])?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return amount * (multipliers[unit] ?? 1);
}

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default("0.0.0.0"),
    /** Required for auth/DB routes; /health still works without it. */
    DATABASE_URL: z.string().url().optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** HMAC secret for access JWTs. Required in production. */
    JWT_SECRET: z
      .string()
      .min(32, "JWT_SECRET must be at least 32 characters")
      .default("dev-only-change-me-jwt-secret-32chars!!"),
    /** @fastify/jwt expiresIn string, e.g. 8h */
    JWT_EXPIRES_IN: z.string().default("8h"),
    /** Seed admin (optional — used by prisma seed / bootstrap). */
    SEED_ADMIN_USERNAME: z.string().default("admin"),
    SEED_ADMIN_PASSWORD: z.string().optional(),
    SEED_ADMIN_DISPLAY_NAME: z.string().default("BCP Admin"),
    /**
     * Azure Communication Services SMS (optional).
     * When both ACS_CONNECTION_STRING and ACS_PHONE_NUMBER (or SMS_FROM) are set,
     * fan-out uses the real ACS adapter; otherwise the in-memory stub is used (CI/dev).
     */
    ACS_CONNECTION_STRING: z.string().min(1).optional(),
    /** ACS-owned E.164 from-number (or registered sender ID). */
    ACS_PHONE_NUMBER: z.string().min(1).optional(),
    /** Alias for ACS_PHONE_NUMBER (SMS from). */
    SMS_FROM: z.string().min(1).optional(),
    /**
     * Optional shared secret for POST /webhooks/acs/sms-delivery
     * (header x-acs-webhook-secret or Authorization: Bearer …).
     * Leave unset in CI; set in Azure via Key Vault for production.
     */
    ACS_WEBHOOK_SECRET: z.string().min(1).optional(),
    /**
     * Expo Push (E6). Leave unset / false in CI — push uses in-memory expo-stub.
     * Set EXPO_PUSH_ENABLED=true to send via Expo Push API on alert fan-out.
     * EXPO_ACCESS_TOKEN is optional Bearer auth (recommended in production).
     */
    EXPO_PUSH_ENABLED: z
      .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
      .optional()
      .transform((v) => {
        if (v === undefined) return false;
        if (typeof v === "boolean") return v;
        return v === "true" || v === "1";
      }),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  })
  .transform((env) => {
    const from = env.ACS_PHONE_NUMBER ?? env.SMS_FROM;
    return {
      ...env,
      ACS_PHONE_NUMBER: from,
      JWT_EXPIRES_IN_SECONDS: parseDurationToSeconds(env.JWT_EXPIRES_IN),
    };
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(details)}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (
      !env.JWT_SECRET ||
      env.JWT_SECRET === "dev-only-change-me-jwt-secret-32chars!!"
    ) {
      throw new Error("JWT_SECRET must be set to a strong value in production");
    }
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production");
    }
  }
  return env;
}
