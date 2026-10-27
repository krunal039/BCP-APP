import type { Prisma, PrismaClient } from "@prisma/client";

export async function writeAudit(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    actorUserId: string | null;
    action: string;
    alertId?: string | null;
    payload?: Prisma.InputJsonValue;
  },
) {
  await prisma.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      alertId: input.alertId ?? undefined,
      payload: input.payload ?? undefined,
    },
  });
}
