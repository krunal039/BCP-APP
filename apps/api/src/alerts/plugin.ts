import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Env } from "../env.js";
import { getPrisma } from "../db.js";
import { createDeliveryPort } from "../delivery/factory.js";
import {
  StubDeliveryAdapter,
  type DeliveryPort,
} from "../delivery/port.js";
import { AlertService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    alertService: AlertService;
    deliveryPort: DeliveryPort;
    stubDelivery: StubDeliveryAdapter;
  }
}

export const alertsPlugin = fp(async (app: FastifyInstance, opts: { env: Env }) => {
  const { deliveryPort, stubDelivery } = createDeliveryPort(opts.env);
  app.decorate("stubDelivery", stubDelivery);
  app.decorate("deliveryPort", deliveryPort);

  let cached: AlertService | undefined;
  const resolve = (): AlertService => {
    if (!cached) {
      cached = new AlertService(getPrisma(), app.deliveryPort);
    }
    return cached;
  };
  app.decorate("alertService", null as unknown as AlertService);
  Object.defineProperty(app, "alertService", {
    configurable: true,
    enumerable: true,
    get: resolve,
  });

  const canCompose = app.requireRoles("sender", "admin");
  const canApprove = app.requireRoles("approver", "admin");
  const canRead = app.requireRoles("sender", "approver", "admin");
  const canAudit = app.requireRoles("admin", "approver", "sender");

  app.get("/alerts", { preHandler: [canRead] }, async (request, reply) => {
    const result = await app.alertService.list(request.query);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return result.result;
  });

  app.post("/alerts", { preHandler: [canCompose] }, async (request, reply) => {
    const result = await app.alertService.compose(request.authUser, request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return reply.code(result.idempotent ? 200 : 201).send({
      alert: result.alert,
      idempotent: result.idempotent,
    });
  });

  /** Compose + urgent bypass in one shot (capability + reason required). */
  app.post(
    "/alerts/bypass",
    { preHandler: [canCompose] },
    async (request, reply) => {
      const result = await app.alertService.composeAndBypass(
        request.authUser,
        request.body,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error:
            result.statusCode === 403
              ? "Forbidden"
              : result.statusCode === 409
                ? "Conflict"
                : "Bad Request",
          message: result.message,
        });
      }
      return reply.code(201).send({ alert: result.alert });
    },
  );

  app.get("/alerts/:id", { preHandler: [canRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.alertService.getById(id);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Not Found",
        message: result.message,
      });
    }
    return { alert: result.alert };
  });

  app.post(
    "/alerts/:id/submit",
    { preHandler: [canCompose] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.alertService.submitForApproval(
        request.authUser,
        id,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error:
            result.statusCode === 403
              ? "Forbidden"
              : result.statusCode === 404
                ? "Not Found"
                : result.statusCode === 409
                  ? "Conflict"
                  : "Bad Request",
          message: result.message,
        });
      }
      return { alert: result.alert };
    },
  );

  app.post(
    "/alerts/:id/approve",
    { preHandler: [canApprove] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.alertService.approve(request.authUser, id);
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error:
            result.statusCode === 403
              ? "Forbidden"
              : result.statusCode === 404
                ? "Not Found"
                : result.statusCode === 409
                  ? "Conflict"
                  : "Bad Request",
          message: result.message,
        });
      }
      return { alert: result.alert };
    },
  );

  app.post(
    "/alerts/:id/reject",
    { preHandler: [canApprove] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.alertService.reject(
        request.authUser,
        id,
        request.body,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error:
            result.statusCode === 403
              ? "Forbidden"
              : result.statusCode === 404
                ? "Not Found"
                : result.statusCode === 409
                  ? "Conflict"
                  : "Bad Request",
          message: result.message,
        });
      }
      return { alert: result.alert };
    },
  );

  app.post(
    "/alerts/:id/bypass",
    { preHandler: [canCompose] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.alertService.bypass(
        request.authUser,
        id,
        request.body,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error:
            result.statusCode === 403
              ? "Forbidden"
              : result.statusCode === 404
                ? "Not Found"
                : result.statusCode === 409
                  ? "Conflict"
                  : "Bad Request",
          message: result.message,
        });
      }
      return { alert: result.alert };
    },
  );

  app.get(
    "/alerts/:id/deliveries",
    { preHandler: [canRead] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.alertService.listDeliveries(id);
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Not Found",
          message: result.message,
        });
      }
      return result.result;
    },
  );

  app.get("/audit", { preHandler: [canAudit] }, async (request, reply) => {
    const result = await app.alertService.listAudit(request.query);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return result.result;
  });
});
