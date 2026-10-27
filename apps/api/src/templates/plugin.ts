import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "../db.js";
import { TemplateService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    templateService: TemplateService;
  }
}

export const templatesPlugin = fp(async (app: FastifyInstance) => {
  let cached: TemplateService | undefined;
  const resolve = (): TemplateService => {
    if (!cached) cached = new TemplateService(getPrisma());
    return cached;
  };
  app.decorate("templateService", null as unknown as TemplateService);
  Object.defineProperty(app, "templateService", {
    configurable: true,
    enumerable: true,
    get: resolve,
  });

  const canRead = app.requireRoles("sender", "approver", "admin");
  const canMutate = app.requireRoles("admin");

  app.get("/templates", { preHandler: [canRead] }, async (request, reply) => {
    const result = await app.templateService.list(request.query);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return result.result;
  });

  app.post("/templates", { preHandler: [canMutate] }, async (request, reply) => {
    const result = await app.templateService.create(
      request.authUser.id,
      request.body,
    );
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: result.statusCode === 409 ? "Conflict" : "Bad Request",
        message: result.message,
      });
    }
    return reply.code(201).send({ template: result.template });
  });

  app.get("/templates/:id", { preHandler: [canRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.templateService.getById(id);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Not Found",
        message: result.message,
      });
    }
    return { template: result.template };
  });

  app.patch("/templates/:id", { preHandler: [canMutate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.templateService.update(
      request.authUser.id,
      id,
      request.body,
    );
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error:
          result.statusCode === 404
            ? "Not Found"
            : result.statusCode === 409
              ? "Conflict"
              : "Bad Request",
        message: result.message,
      });
    }
    return { template: result.template };
  });
});
