import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "../db.js";
import { GroupService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    groupService: GroupService;
  }
}

export const groupsPlugin = fp(async (app: FastifyInstance) => {
  let cached: GroupService | undefined;
  const resolve = (): GroupService => {
    if (!cached) cached = new GroupService(getPrisma());
    return cached;
  };
  app.decorate("groupService", null as unknown as GroupService);
  Object.defineProperty(app, "groupService", {
    configurable: true,
    enumerable: true,
    get: resolve,
  });

  const canRead = app.requireRoles("sender", "approver", "admin");
  const canMutate = app.requireRoles("admin");

  app.get("/groups", { preHandler: [canRead] }, async (request, reply) => {
    const result = await app.groupService.list(request.query);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return result.result;
  });

  app.get("/groups/:id", { preHandler: [canRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.groupService.getById(id);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Not Found",
        message: result.message,
      });
    }
    return { group: result.group };
  });

  app.post("/groups", { preHandler: [canMutate] }, async (request, reply) => {
    const result = await app.groupService.create(request.authUser.id, request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: result.statusCode === 409 ? "Conflict" : "Bad Request",
        message: result.message,
      });
    }
    return reply.code(201).send({ group: result.group });
  });

  app.patch("/groups/:id", { preHandler: [canMutate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.groupService.update(
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
    return { group: result.group };
  });

  app.delete("/groups/:id", { preHandler: [canMutate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.groupService.delete(request.authUser.id, id);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Not Found",
        message: result.message,
      });
    }
    return { ok: true };
  });

  app.get(
    "/groups/:id/members",
    { preHandler: [canRead] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.groupService.listMembers(id, request.query);
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: result.statusCode === 404 ? "Not Found" : "Bad Request",
          message: result.message,
        });
      }
      return result.result;
    },
  );

  app.post(
    "/groups/:id/members",
    { preHandler: [canMutate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.groupService.addMembers(
        request.authUser.id,
        id,
        request.body,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: result.statusCode === 404 ? "Not Found" : "Bad Request",
          message: result.message,
        });
      }
      return { group: result.group };
    },
  );

  app.delete(
    "/groups/:id/members/:memberId",
    { preHandler: [canMutate] },
    async (request, reply) => {
      const { id, memberId } = request.params as { id: string; memberId: string };
      const result = await app.groupService.removeMember(
        request.authUser.id,
        id,
        memberId,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Not Found",
          message: result.message,
        });
      }
      return { group: result.group };
    },
  );

  app.get(
    "/groups/:id/phones",
    { preHandler: [canRead] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.groupService.resolvePhones(id);
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
});
