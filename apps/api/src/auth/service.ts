import type { Prisma, PrismaClient, Role as PrismaRole } from "@prisma/client";
import {
  CreateUserRequestSchema,
  LoginRequestSchema,
  type Role,
  UpdateUserRolesRequestSchema,
} from "@bcp/shared";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password.js";
import { isAccountLocked, nextFailedLoginState } from "./lockout.js";
import { toPublicUser, type AuthUserSnapshot } from "./tokens.js";

type UserWithRoles = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  urgentBypass: boolean;
  tokenVersion: number;
  lockedUntil: Date | null;
  failedLoginCount: number;
  roles: { role: PrismaRole }[];
};

function toSnapshot(user: UserWithRoles): AuthUserSnapshot {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles.map((r) => r.role as Role),
    urgentBypass: user.urgentBypass,
    tokenVersion: user.tokenVersion,
  };
}

async function writeAudit(
  prisma: PrismaClient,
  actorUserId: string | null,
  action: string,
  payload?: Prisma.InputJsonValue,
) {
  await prisma.auditEvent.create({
    data: {
      actorUserId,
      action,
      payload: payload ?? undefined,
    },
  });
}

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async findAuthUserById(id: string): Promise<AuthUserSnapshot | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!user) return null;
    return toSnapshot(user);
  }

  async login(raw: unknown): Promise<
    | { ok: true; user: AuthUserSnapshot }
    | { ok: false; statusCode: 400 | 401 | 423; message: string }
  > {
    const parsed = LoginRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, statusCode: 400, message: "Invalid login payload" };
    }

    const { username, password } = parsed.data;
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: true },
    });

    // Constant-ish failure path: do not reveal whether the username exists.
    if (!user) {
      return { ok: false, statusCode: 401, message: "Invalid username or password" };
    }

    if (isAccountLocked(user.lockedUntil)) {
      return {
        ok: false,
        statusCode: 423,
        message: "Account temporarily locked due to failed login attempts",
      };
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      const next = nextFailedLoginState(user.failedLoginCount);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: next.failedLoginCount,
          lockedUntil: next.lockedUntil,
        },
      });
      if (next.lockedUntil) {
        await writeAudit(this.prisma, user.id, "auth.lockout", {
          failedLoginCount: next.failedLoginCount,
        });
        return {
          ok: false,
          statusCode: 423,
          message: "Account temporarily locked due to failed login attempts",
        };
      }
      return { ok: false, statusCode: 401, message: "Invalid username or password" };
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
      include: { roles: true },
    });

    await writeAudit(this.prisma, updated.id, "auth.login", {
      username: updated.username,
    });

    return { ok: true, user: toSnapshot(updated) };
  }

  async logout(userId: string): Promise<AuthUserSnapshot | null> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      include: { roles: true },
    });
    await writeAudit(this.prisma, userId, "auth.logout", {});
    return toSnapshot(updated);
  }

  async createUser(
    actorUserId: string,
    raw: unknown,
  ): Promise<
    | { ok: true; user: ReturnType<typeof toPublicUser> }
    | { ok: false; statusCode: 400 | 409; message: string }
  > {
    const parsed = CreateUserRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid create-user payload";
      return { ok: false, statusCode: 400, message };
    }

    const policy = validatePasswordPolicy(parsed.data.password);
    if (!policy.ok) {
      return { ok: false, statusCode: 400, message: policy.message };
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: parsed.data.username },
    });
    if (existing) {
      return { ok: false, statusCode: 409, message: "Username already taken" };
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const created = await this.prisma.user.create({
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash,
        urgentBypass: parsed.data.urgentBypass,
        roles: {
          create: parsed.data.roles.map((role) => ({ role })),
        },
      },
      include: { roles: true },
    });

    await writeAudit(this.prisma, actorUserId, "user.create", {
      userId: created.id,
      username: created.username,
      roles: created.roles.map((r) => r.role),
      urgentBypass: created.urgentBypass,
    });

    return { ok: true, user: toPublicUser(toSnapshot(created)) };
  }

  async updateRoles(
    actorUserId: string,
    targetUserId: string,
    raw: unknown,
  ): Promise<
    | { ok: true; user: ReturnType<typeof toPublicUser> }
    | { ok: false; statusCode: 400 | 404; message: string }
  > {
    const parsed = UpdateUserRolesRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid roles payload";
      return { ok: false, statusCode: 400, message };
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: true },
    });
    if (!existing) {
      return { ok: false, statusCode: 404, message: "User not found" };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: targetUserId } });
      await tx.userRole.createMany({
        data: parsed.data.roles.map((role) => ({
          userId: targetUserId,
          role,
        })),
      });
      return tx.user.update({
        where: { id: targetUserId },
        data: {
          urgentBypass: parsed.data.urgentBypass ?? existing.urgentBypass,
          // Force re-login after role changes.
          tokenVersion: { increment: 1 },
        },
        include: { roles: true },
      });
    });

    await writeAudit(this.prisma, actorUserId, "user.roles.update", {
      userId: updated.id,
      roles: updated.roles.map((r) => r.role),
      urgentBypass: updated.urgentBypass,
    });

    return { ok: true, user: toPublicUser(toSnapshot(updated)) };
  }
}
