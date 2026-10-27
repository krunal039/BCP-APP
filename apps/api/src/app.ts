import Fastify from "fastify";
import sensible from "@fastify/sensible";
import {
  AlertStateSchema,
  DEFAULT_COUNTRY_CODE,
  RoleSchema,
} from "@bcp/shared";
import type { Env } from "./env.js";
import { authPlugin } from "./auth/plugin.js";
import { membersPlugin } from "./members/plugin.js";
import { groupsPlugin } from "./groups/plugin.js";
import { templatesPlugin } from "./templates/plugin.js";
import { alertsPlugin } from "./alerts/plugin.js";

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

  // Allow text/csv bodies for /members/import (JSON still default for other routes).
  app.addContentTypeParser(
    ["text/csv", "text/plain"],
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  await app.register(sensible);
  await app.register(authPlugin, { env });
  await app.register(membersPlugin);
  await app.register(groupsPlugin);
  await app.register(templatesPlugin);
  await app.register(alertsPlugin);

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "bcp-api",
      timestamp: new Date().toISOString(),
      // Prove shared package is importable at runtime.
      domain: {
        roles: RoleSchema.options,
        alertStates: AlertStateSchema.options,
        defaultCountryCode: DEFAULT_COUNTRY_CODE,
      },
    };
  });

  return app;
}
