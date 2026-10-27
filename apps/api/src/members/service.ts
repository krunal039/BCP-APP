import type { ContactBasis, Prisma, PrismaClient } from "@prisma/client";
import {
  AddMemberPhoneRequestSchema,
  CreateMemberRequestSchema,
  MemberCsvRowSchema,
  MemberListQuerySchema,
  UpdateMemberPhoneRequestSchema,
  UpdateMemberRequestSchema,
  type MemberImportResult,
} from "@bcp/shared";
import { parseCsv } from "./csv.js";

type PhoneRow = {
  id: string;
  e164: string;
  countryCode: string;
  active: boolean;
};

type MemberRow = {
  id: string;
  displayName: string;
  active: boolean;
  contactBasis: ContactBasis;
  contactBasisAt: Date;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  phones: PhoneRow[];
};

export function toPublicMember(member: MemberRow) {
  return {
    id: member.id,
    displayName: member.displayName,
    active: member.active,
    contactBasis: member.contactBasis,
    contactBasisAt: member.contactBasisAt.toISOString(),
    userId: member.userId,
    phones: member.phones.map((p) => ({
      id: p.id,
      e164: p.e164,
      countryCode: p.countryCode,
      active: p.active,
    })),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
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

const memberInclude = { phones: { orderBy: { createdAt: "asc" as const } } };

export class MemberService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(rawQuery: unknown) {
    const parsed = MemberListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid list query" };
    }
    const { page, limit, q, active } = parsed.data;
    const where: Prisma.MemberWhereInput = {};
    if (active !== "all") {
      where.active = active;
    }
    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { phones: { some: { e164: { contains: q } } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({
        where,
        include: memberInclude,
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        items: items.map(toPublicMember),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: memberInclude,
    });
    if (!member) {
      return { ok: false as const, statusCode: 404 as const, message: "Member not found" };
    }
    return { ok: true as const, member: toPublicMember(member) };
  }

  async create(actorUserId: string, raw: unknown) {
    const parsed = CreateMemberRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid member payload",
      };
    }
    const data = parsed.data;

    if (data.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        return { ok: false as const, statusCode: 400 as const, message: "userId not found" };
      }
    }

    try {
      const member = await this.prisma.member.create({
        data: {
          displayName: data.displayName,
          active: data.active,
          contactBasis: data.contactBasis,
          contactBasisAt: data.contactBasisAt ?? new Date(),
          userId: data.userId,
          phones: {
            create: {
              e164: data.e164,
              countryCode: data.countryCode,
              active: true,
            },
          },
        },
        include: memberInclude,
      });

      await writeAudit(this.prisma, actorUserId, "member.create", {
        memberId: member.id,
        e164: data.e164,
        countryCode: data.countryCode,
      });

      return { ok: true as const, member: toPublicMember(member) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Member phone or user link already exists",
        };
      }
      throw err;
    }
  }

  async update(actorUserId: string, id: string, raw: unknown) {
    const parsed = UpdateMemberRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid update payload",
      };
    }

    const existing = await this.prisma.member.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false as const, statusCode: 404 as const, message: "Member not found" };
    }

    if (parsed.data.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: parsed.data.userId } });
      if (!user) {
        return { ok: false as const, statusCode: 400 as const, message: "userId not found" };
      }
    }

    try {
      const member = await this.prisma.member.update({
        where: { id },
        data: {
          displayName: parsed.data.displayName,
          active: parsed.data.active,
          contactBasis: parsed.data.contactBasis,
          contactBasisAt: parsed.data.contactBasisAt,
          userId: parsed.data.userId === undefined ? undefined : parsed.data.userId,
        },
        include: memberInclude,
      });

      await writeAudit(this.prisma, actorUserId, "member.update", {
        memberId: id,
        patch: parsed.data,
      });

      return { ok: true as const, member: toPublicMember(member) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "userId already linked to another member",
        };
      }
      throw err;
    }
  }

  /** Soft-delete: deactivate member and all phones. */
  async deactivate(actorUserId: string, id: string) {
    const existing = await this.prisma.member.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false as const, statusCode: 404 as const, message: "Member not found" };
    }

    const member = await this.prisma.$transaction(async (tx) => {
      await tx.phone.updateMany({
        where: { memberId: id },
        data: { active: false },
      });
      return tx.member.update({
        where: { id },
        data: { active: false },
        include: memberInclude,
      });
    });

    await writeAudit(this.prisma, actorUserId, "member.deactivate", { memberId: id });
    return { ok: true as const, member: toPublicMember(member) };
  }

  async addPhone(actorUserId: string, memberId: string, raw: unknown) {
    const parsed = AddMemberPhoneRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid phone payload",
      };
    }

    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) {
      return { ok: false as const, statusCode: 404 as const, message: "Member not found" };
    }

    try {
      const phone = await this.prisma.phone.create({
        data: {
          memberId,
          e164: parsed.data.e164,
          countryCode: parsed.data.countryCode,
          active: parsed.data.active,
        },
      });
      await writeAudit(this.prisma, actorUserId, "member.phone.add", {
        memberId,
        phoneId: phone.id,
        e164: phone.e164,
        countryCode: phone.countryCode,
      });
      return {
        ok: true as const,
        phone: {
          id: phone.id,
          e164: phone.e164,
          countryCode: phone.countryCode,
          active: phone.active,
        },
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Phone already exists for this member",
        };
      }
      throw err;
    }
  }

  async updatePhone(
    actorUserId: string,
    memberId: string,
    phoneId: string,
    raw: unknown,
  ) {
    const parsed = UpdateMemberPhoneRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid phone update",
      };
    }

    const phone = await this.prisma.phone.findFirst({
      where: { id: phoneId, memberId },
    });
    if (!phone) {
      return { ok: false as const, statusCode: 404 as const, message: "Phone not found" };
    }

    try {
      const updated = await this.prisma.phone.update({
        where: { id: phoneId },
        data: {
          e164: parsed.data.e164,
          countryCode: parsed.data.countryCode,
          active: parsed.data.active,
        },
      });
      await writeAudit(this.prisma, actorUserId, "member.phone.update", {
        memberId,
        phoneId,
        patch: parsed.data,
      });
      return {
        ok: true as const,
        phone: {
          id: updated.id,
          e164: updated.e164,
          countryCode: updated.countryCode,
          active: updated.active,
        },
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Phone already exists for this member",
        };
      }
      throw err;
    }
  }

  /**
   * Import members from CSV text. Successful rows commit; failed rows are reported.
   * Optional groupName creates/finds the group and adds the member.
   */
  async importCsv(actorUserId: string, csvText: string): Promise<
    | { ok: true; result: MemberImportResult }
    | { ok: false; statusCode: 400; message: string }
  > {
    if (typeof csvText !== "string" || csvText.trim().length === 0) {
      return { ok: false, statusCode: 400, message: "CSV body is required" };
    }

    const { rows, errors: parseErrors } = parseCsv(csvText);
    if (parseErrors.length > 0 && rows.length === 0) {
      return {
        ok: true,
        result: {
          committed: 0,
          failed: parseErrors.length,
          errors: parseErrors,
          memberIds: [],
        },
      };
    }

    const errors: MemberImportResult["errors"] = [...parseErrors];
    const memberIds: string[] = [];
    let committed = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // header is row 1
      const parsed = MemberCsvRowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          message: parsed.error.issues[0]?.message ?? "Invalid row",
        });
        continue;
      }

      const row = parsed.data;
      try {
        const member = await this.prisma.$transaction(async (tx) => {
          const created = await tx.member.create({
            data: {
              displayName: row.displayName,
              active: row.active,
              contactBasis: row.contactBasis,
              contactBasisAt: new Date(),
              phones: {
                create: {
                  e164: row.e164,
                  countryCode: row.countryCode,
                  active: true,
                },
              },
            },
          });

          if (row.groupName) {
            const group = await tx.group.upsert({
              where: { name: row.groupName },
              create: { name: row.groupName },
              update: {},
            });
            await tx.groupMember.upsert({
              where: {
                groupId_memberId: { groupId: group.id, memberId: created.id },
              },
              create: { groupId: group.id, memberId: created.id },
              update: {},
            });
          }

          return created;
        });

        memberIds.push(member.id);
        committed += 1;
      } catch (err) {
        errors.push({
          row: rowNumber,
          message: isUniqueViolation(err)
            ? "Duplicate phone for member"
            : "Failed to import row",
        });
      }
    }

    await writeAudit(this.prisma, actorUserId, "member.import", {
      committed,
      failed: errors.length,
      memberIds,
    });

    return {
      ok: true,
      result: {
        committed,
        failed: errors.length,
        errors,
        memberIds,
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
