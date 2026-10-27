import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@bcp/shared";
import type { Env } from "../env.js";
import { getPrisma } from "../db.js";
import { AuthService } from "./service.js";
import { authorize } from "./rbac.js";
import {
  toAccessTokenPayload,
  toPublicUser,
  type AuthUserSnapshot,
} from "./tokens.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      username: string;
      roles: Role[];
      urgentBypass: boolean;
      tokenVersion: number;
    };
    user: {
      sub: string;
      username: string;
      roles: Role[];
      urgentBypass: boolean;
      tokenVersion: number;
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireRoles: (
      ...roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAccessToken: (user: AuthUserSnapshot) => string;
  }

  interface FastifyRequest {
    authUser: AuthUserSnapshot;
  }
}

export const authPlugin = fp(async (app, opts: { env: Env }) => {
  const { env } = opts;

  await app.register(fjwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  // Auth routes need DB; construct lazily so /health still works without it.
  let cachedAuthService: AuthService | undefined;
  const resolveAuthService = (): AuthService => {
    if (!cachedAuthService) {
      cachedAuthService = new AuthService(getPrisma());
    }
    return cachedAuthService;
  };
  app.decorate("authService", null as unknown as AuthService);
  Object.defineProperty(app, "authService", {
    configurable: true,
    enumerable: true,
    get: resolveAuthService,
  });

  app.decorate(
    "signAccessToken",
    (user: AuthUserSnapshot) => app.jwt.sign(toAccessTokenPayload(user)),
  );

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.unauthorized("Authentication required");
      }

      const claims = request.user;
      const snapshot = await app.authService.findAuthUserById(claims.sub);
      if (!snapshot) {
        return reply.unauthorized("User no longer exists");
      }
      if (snapshot.tokenVersion !== claims.tokenVersion) {
        return reply.unauthorized("Token has been revoked");
      }

      request.authUser = snapshot;
    },
  );

  app.decorate("requireRoles", (...roles: Role[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      if (reply.sent) return;

      if (!authorize(request.authUser.roles, roles)) {
        return reply.forbidden(
          `Requires one of roles: ${roles.join(", ")} (admin always allowed)`,
        );
      }
    };
  });

  app.get(
    "/auth/me",
    { preHandler: [app.authenticate] },
    async (request) => ({ user: toPublicUser(request.authUser) }),
  );

  app.post("/auth/login", async (request, reply) => {
    const result = await app.authService.login(request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        statusCode: result.statusCode,
        error:
          result.statusCode === 423
            ? "Locked"
            : result.statusCode === 400
              ? "Bad Request"
              : "Unauthorized",
        message: result.message,
      });
    }

    const accessToken = app.signAccessToken(result.user);
    // Never log tokens or passwords.
    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresInSeconds: env.JWT_EXPIRES_IN_SECONDS,
      user: toPublicUser(result.user),
    };
  });

  app.post(
    "/auth/logout",
    { preHandler: [app.authenticate] },
    async (request) => {
      await app.authService.logout(request.authUser.id);
      return { ok: true };
    },
  );

  app.post(
    "/users",
    { preHandler: [app.requireRoles("admin")] },
    async (request, reply) => {
      const result = await app.authService.createUser(
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
      return reply.code(201).send({ user: result.user });
    },
  );

  app.patch(
    "/users/:id/roles",
    { preHandler: [app.requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await app.authService.updateRoles(
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
      return { user: result.user };
    },
  );

  /**
   * Minimal RBAC probe routes for smoke tests.
   * Real compose/approve enforcement lands in E4 (Approver ≠ Sender).
   */
  app.get(
    "/rbac/sender",
    { preHandler: [app.requireRoles("sender")] },
    async (request) => ({
      ok: true,
      route: "sender",
      userId: request.authUser.id,
      roles: request.authUser.roles,
    }),
  );

  app.get(
    "/rbac/approver",
    { preHandler: [app.requireRoles("approver")] },
    async (request) => ({
      ok: true,
      route: "approver",
      userId: request.authUser.id,
      roles: request.authUser.roles,
    }),
  );

  app.get(
    "/rbac/admin",
    { preHandler: [app.requireRoles("admin")] },
    async (request) => ({
      ok: true,
      route: "admin",
      userId: request.authUser.id,
      roles: request.authUser.roles,
    }),
  );
});
