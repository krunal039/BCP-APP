import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { AlertStateSchema, RoleSchema } from "@bcp/shared";
import type { Env } from "./env.js";

export async function buildApp(env: Env) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  await app.register(sensible);

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
