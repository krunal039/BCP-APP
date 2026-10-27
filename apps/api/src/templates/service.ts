import type { AlertSeverity, Prisma, PrismaClient } from "@prisma/client";
import {
  CreateTemplateRequestSchema,
  TemplateListQuerySchema,
  UpdateTemplateRequestSchema,
} from "@bcp/shared";
import { writeAudit } from "../audit/write.js";

type TemplateRow = {
  id: string;
  name: string;
  body: string;
  locale: string;
  severity: AlertSeverity;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toPublicTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    locale: t.locale,
    severity: t.severity,
    active: t.active,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export class TemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(rawQuery: unknown) {
    const parsed = TemplateListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return { ok: false as const, statusCode: 400 as const, message: "Invalid list query" };
    }
    const { page, limit, q, active } = parsed.data;
    const where: Prisma.TemplateWhereInput = {};
    if (active !== "all") {
      where.active = active;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.template.count({ where }),
      this.prisma.template.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      ok: true as const,
      result: {
        items: items.map(toPublicTemplate),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template) {
      return { ok: false as const, statusCode: 404 as const, message: "Template not found" };
    }
    return { ok: true as const, template: toPublicTemplate(template) };
  }

  async create(actorUserId: string, raw: unknown) {
    const parsed = CreateTemplateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid template payload",
      };
    }

    try {
      const template = await this.prisma.template.create({
        data: {
          name: parsed.data.name,
          body: parsed.data.body,
          locale: parsed.data.locale,
          severity: parsed.data.severity,
          active: parsed.data.active,
        },
      });
      await writeAudit(this.prisma, {
        actorUserId,
        action: "template.create",
        payload: { templateId: template.id, name: template.name },
      });
      return { ok: true as const, template: toPublicTemplate(template) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Template name already exists",
        };
      }
      throw err;
    }
  }

  async update(actorUserId: string, id: string, raw: unknown) {
    const parsed = UpdateTemplateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        statusCode: 400 as const,
        message: parsed.error.issues[0]?.message ?? "Invalid template update",
      };
    }

    const existing = await this.prisma.template.findUnique({ where: { id } });
    if (!existing) {
      return { ok: false as const, statusCode: 404 as const, message: "Template not found" };
    }

    try {
      const template = await this.prisma.template.update({
        where: { id },
        data: {
          name: parsed.data.name,
          body: parsed.data.body,
          locale: parsed.data.locale,
          severity: parsed.data.severity,
          active: parsed.data.active,
        },
      });
      await writeAudit(this.prisma, {
        actorUserId,
        action: "template.update",
        payload: { templateId: id, patch: parsed.data },
      });
      return { ok: true as const, template: toPublicTemplate(template) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false as const,
          statusCode: 409 as const,
          message: "Template name already exists",
        };
      }
      throw err;
    }
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
