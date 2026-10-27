import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "../db.js";
import { DeviceTokenService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    deviceTokenService: DeviceTokenService;
  }
}

/**
 * Device token registration for Expo push (any authenticated user).
 * Tokens are keyed by expoToken; fan-out resolves via Member.userId → DeviceToken.
 */
export const devicesPlugin = fp(async (app: FastifyInstance) => {
  let cached: DeviceTokenService | undefined;
  const resolve = (): DeviceTokenService => {
    if (!cached) cached = new DeviceTokenService(getPrisma());
    return cached;
  };
  app.decorate("deviceTokenService", null as unknown as DeviceTokenService);
  Object.defineProperty(app, "deviceTokenService", {
    configurable: true,
    enumerable: true,
    get: resolve,
  });

  app.post(
    "/me/device-tokens",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const result = await app.deviceTokenService.register(
        request.authUser.id,
        request.body,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Bad Request",
          message: result.message,
        });
      }
      return reply.code(200).send({ token: result.token });
    },
  );

  app.get(
    "/me/device-tokens",
    { preHandler: [app.authenticate] },
    async (request) => {
      const items = await app.deviceTokenService.listForUser(
        request.authUser.id,
      );
      return { items };
    },
  );

  app.delete(
    "/me/device-tokens",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = request.body as { expoToken?: string } | null;
      const expoToken =
        typeof body?.expoToken === "string" ? body.expoToken : "";
      const result = await app.deviceTokenService.deactivate(
        request.authUser.id,
        expoToken,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Bad Request",
          message: result.message,
        });
      }
      return { ok: true, deactivated: result.deactivated };
    },
  );
});
