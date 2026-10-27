import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { AlertStateSchema, RoleSchema } from "@bcp/shared";
import type { Env } from "./env.js";
import { authPlugin } from "./auth/plugin.js";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never emit Authorization headers or bodies that may contain passwords/tokens.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.password",
          "req.body.accessToken",
          "body.password",
          "body.accessToken",
        ],
        censor: "[Redacted]",
      },
    },
  });

  await app.register(sensible);
  await app.register(authPlugin, { env });

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "bcp-api",
      timestamp: new Date().toISOString(),
      // Prove shared package is importable at runtime.
      domain: {
        roles: RoleSchema.options,
        alertStates: AlertStateSchema.options,
      },
    };
  });

  return app;
}
