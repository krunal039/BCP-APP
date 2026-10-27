import type { Prisma, PrismaClient } from "@prisma/client";
import {
  CreateGroupRequestSchema,
  GroupListQuerySchema,
  GroupMembershipRequestSchema,
  UpdateGroupRequestSchema,
} from "@bcp/shared";
import { toPublicMember } from "../members/service.js";

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

type GroupCounts = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number };
};

async function isGroupSendable(
  prisma: PrismaClient,
  groupId: string,
): Promise<boolean> {
  const hit = await prisma.groupMember.findFirst({
    where: {
      groupId,
      member: {
        active: true,
        phones: { some: { active: true } },
      },
    },
    select: { memberId: true },
  });
  return Boolean(hit);
}

async function toPublicGroup(prisma: PrismaClient, group: GroupCounts) {
  const sendable =
    group._count.members > 0 ? await isGroupSendable(prisma, group.id) : false;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: group._count.members,
    sendable,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export class GroupService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(rawQuery: unknown) {
    const parsed = GroupListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid list query" };
    }
    const { page, limit, q } = parsed.data;
    const where: Prisma.GroupWhereInput = q
      ? { name: { contains: q, mode: "insensitive" } }
      : {};

    const [total, items] = await Promise.all([
      this.prisma.group.count({ where }),
      this.prisma.group.findMany({
        where,
        include: { _count: { select: { members: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        items: await Promise.all(items.map((g) => toPublicGroup(this.prisma, g))),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!group) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }
    return { ok: true as const, group: await toPublicGroup(this.prisma, group) };
  }

  async create(actorUserId: string, raw: unknown) {
    const parsed = CreateGroupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid group payload",
      };
    }

    try {
      const group = await this.prisma.group.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description,
        },
        include: { _count: { select: { members: true } } },
      });
      await writeAudit(this.prisma, actorUserId, "group.create", {
        groupId: group.id,
        name: group.name,
      });
      return { ok: true as const, group: await toPublicGroup(this.prisma, group) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Group name already exists",
        };
      }
      throw err;
    }
  }

  async update(actorUserId: string, id: string, raw: unknown) {
    const parsed = UpdateGroupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid group update",
      };
    }

    const existing = await this.prisma.group.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }

    try {
      const group = await this.prisma.group.update({
        where: { id },
        data: {
          name: parsed.data.name,
          description:
            parsed.data.description === undefined
              ? undefined
              : parsed.data.description,
        },
        include: { _count: { select: { members: true } } },
      });
      await writeAudit(this.prisma, actorUserId, "group.update", {
        groupId: id,
        patch: parsed.data,
      });
      return { ok: true as const, group: await toPublicGroup(this.prisma, group) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Group name already exists",
        };
      }
      throw err;
    }
  }

  async delete(actorUserId: string, id: string) {
    const existing = await this.prisma.group.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }
    await this.prisma.group.delete({ where: { id } });
    await writeAudit(this.prisma, actorUserId, "group.delete", {
      groupId: id,
      name: existing.name,
    });
    return { ok: true as const };
  }

  async listMembers(groupId: string, rawQuery: unknown) {
    const parsed = GroupListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid list query" };
    }
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }

    const { page, limit } = parsed.data;
    const where = { groupId };
    const [total, rows] = await Promise.all([
      this.prisma.groupMember.count({ where }),
      this.prisma.groupMember.findMany({
        where,
        include: {
          member: { include: { phones: { orderBy: { createdAt: "asc" } } } },
        },
        orderBy: { member: { displayName: "asc" } },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        groupId,
        items: rows.map((r) => toPublicMember(r.member)),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async addMembers(actorUserId: string, groupId: string, raw: unknown) {
    const parsed = GroupMembershipRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid membership payload",
      };
    }

    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }

    const members = await this.prisma.member.findMany({
      where: { id: { in: parsed.data.memberIds } },
      select: { id: true },
    });
    if (members.length !== parsed.data.memberIds.length) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: "One or more memberIds do not exist",
      };
    }

    await this.prisma.$transaction(
      parsed.data.memberIds.map((memberId) =>
        this.prisma.groupMember.upsert({
          where: { groupId_memberId: { groupId, memberId } },
          create: { groupId, memberId },
          update: {},
        }),
      ),
    );

    await writeAudit(this.prisma, actorUserId, "group.members.add", {
      groupId,
      memberIds: parsed.data.memberIds,
    });

    return this.getById(groupId);
  }

  async removeMember(actorUserId: string, groupId: string, memberId: string) {
    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_memberId: { groupId, memberId } },
    });
    if (!existing) {
      return {
        ok: false as const,
        statusCode: 404 as const,
        message: "Membership not found",
      };
    }

    await this.prisma.groupMember.delete({
      where: { groupId_memberId: { groupId, memberId } },
    });
    await writeAudit(this.prisma, actorUserId, "group.members.remove", {
      groupId,
      memberId,
    });
    return this.getById(groupId);
  }

  /**
   * Resolve active member phones for send-time targeting.
   * Empty / non-sendable groups return sendable=false (E4 will block targeting).
   */
  async resolvePhones(groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return { ok: false as const, statusCode: 404 as const, message: "Group not found" };
    }

    const memberships = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        member: { active: true },
      },
      include: {
        member: {
          include: {
            phones: { where: { active: true }, orderBy: { createdAt: "asc" } },
          },
        },
      },
    });

    const phones = memberships.flatMap((m) =>
      m.member.phones.map((p) => ({
        memberId: m.member.id,
        displayName: m.member.displayName,
        phone: {
          id: p.id,
          e164: p.e164,
          countryCode: p.countryCode,
          active: p.active,
        },
      })),
    );

    return {
      ok: true as const,
      result: {
        groupId,
        sendable: phones.length > 0,
        phones,
      },
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
