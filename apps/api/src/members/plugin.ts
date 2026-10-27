import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "../db.js";
import { MemberService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    memberService: MemberService;
  }
}

export const membersPlugin = fp(async (app: FastifyInstance) => {
  let cached: MemberService | undefined;
  const resolve = (): MemberService => {
    if (!cached) cached = new MemberService(getPrisma());
    return cached;
  };
  app.decorate("memberService", null as unknown as MemberService);
  Object.defineProperty(app, "memberService", {
    configurable: true,
    enumerable: true,
    get: resolve,
  });

  /** Reads: Admin / Sender / Approver (compose needs directory). Mutations: Admin only. */
  const canRead = app.requireRoles("sender", "approver", "admin");
  const canMutate = app.requireRoles("admin");

  app.get("/members", { preHandler: [canRead] }, async (request, reply) => {
    const result = await app.memberService.list(request.query);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Bad Request",
        message: result.message,
      });
    }
    return result.result;
  });

  app.post("/members", { preHandler: [canMutate] }, async (request, reply) => {
    const result = await app.memberService.create(request.authUser.id, request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: result.statusCode === 409 ? "Conflict" : "Bad Request",
        message: result.message,
      });
    }
    return reply.code(201).send({ member: result.member });
  });

  /**
   * CSV import — registered before /members/:id so "import" is not captured as an id.
   * Prefer text/csv or text/plain body; JSON `{ csv: "..." }` also accepted.
   */
  app.post(
    "/members/import",
    { preHandler: [canMutate] },
    async (request, reply) => {
      let csvText = "";
      const contentType = String(request.headers["content-type"] ?? "");
      if (contentType.includes("application/json")) {
        const body = request.body as { csv?: string } | string | null;
        if (typeof body === "string") csvText = body;
        else if (body && typeof body.csv === "string") csvText = body.csv;
      } else if (typeof request.body === "string") {
        csvText = request.body;
      } else if (Buffer.isBuffer(request.body)) {
        csvText = request.body.toString("utf8");
      }

      const result = await app.memberService.importCsv(
        request.authUser.id,
        csvText,
      );
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Bad Request",
          message: result.message,
        });
      }
      return result.result;
    },
  );

  app.get("/members/:id", { preHandler: [canRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.memberService.getById(id);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error: "Not Found",
        message: result.message,
      });
    }
    return { member: result.member };
  });

  app.patch("/members/:id", { preHandler: [canMutate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await app.memberService.update(
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
    return { member: result.member };
  });

  app.post(
    "/members/:id/deactivate",
    { preHandler: [canMutate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.memberService.deactivate(request.authUser.id, id);
      if (!result.ok) {
        return reply.code(result.statusCode).send({
          statusCode: result.statusCode,
          error: "Not Found",
          message: result.message,
        });
      }
      return { member: result.member };
    },
  );

  app.post(
    "/members/:id/phones",
    { preHandler: [canMutate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.memberService.addPhone(
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
      return reply.code(201).send({ phone: result.phone });
    },
  );

  app.patch(
    "/members/:id/phones/:phoneId",
    { preHandler: [canMutate] },
    async (request, reply) => {
      const { id, phoneId } = request.params as { id: string; phoneId: string };
      const result = await app.memberService.updatePhone(
        request.authUser.id,
        id,
        phoneId,
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
      return { phone: result.phone };
    },
  );
});
