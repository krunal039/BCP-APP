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
  })
  .transform((env) => ({
    ...env,
    JWT_EXPIRES_IN_SECONDS: parseDurationToSeconds(env.JWT_EXPIRES_IN),
  }));

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
