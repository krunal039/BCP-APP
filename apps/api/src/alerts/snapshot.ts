import type { PrismaClient } from "@prisma/client";
import type { AlertTargetSnapshot, SnapshotTarget } from "@bcp/shared";

/**
 * Resolve target groups → immutable SMS (+ optional push) recipient snapshot.
 * Later membership changes must not alter an in-flight alert.
 */
export async function resolveTargetSnapshot(
  prisma: PrismaClient,
  groupIds: string[],
): Promise<
  | { ok: true; snapshot: AlertTargetSnapshot }
  | { ok: false; statusCode: 400; message: string }
> {
  const uniqueGroupIds = [...new Set(groupIds)];
  const groups = await prisma.group.findMany({
    where: { id: { in: uniqueGroupIds } },
    select: { id: true },
  });
  if (groups.length !== uniqueGroupIds.length) {
    return {
      ok: false,
      statusCode: 400,
      message: "One or more groupIds do not exist",
    };
  }

  const memberships = await prisma.groupMember.findMany({
    where: {
      groupId: { in: uniqueGroupIds },
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

  const targets: SnapshotTarget[] = [];
  const seenSms = new Set<string>();
  const seenPush = new Set<string>();
  const linkedUserIds = new Set<string>();

  for (const row of memberships) {
    const member = row.member;
    for (const phone of member.phones) {
      const key = phone.e164;
      if (seenSms.has(key)) continue;
      seenSms.add(key);
      targets.push({
        memberId: member.id,
        displayName: member.displayName,
        channel: "sms",
        address: phone.e164,
        countryCode: phone.countryCode,
        userId: member.userId,
      });
    }
    if (member.userId) {
      linkedUserIds.add(member.userId);
    }
  }

  if (linkedUserIds.size > 0) {
    const tokens = await prisma.deviceToken.findMany({
      where: {
        userId: { in: [...linkedUserIds] },
        active: true,
      },
    });
    const userToMember = new Map<string, { memberId: string; displayName: string }>();
    for (const row of memberships) {
      if (row.member.userId) {
        userToMember.set(row.member.userId, {
          memberId: row.member.id,
          displayName: row.member.displayName,
        });
      }
    }
    for (const token of tokens) {
      if (seenPush.has(token.expoToken)) continue;
      seenPush.add(token.expoToken);
      const meta = userToMember.get(token.userId);
      if (!meta) continue;
      targets.push({
        memberId: meta.memberId,
        displayName: meta.displayName,
        channel: "push",
        address: token.expoToken,
        userId: token.userId,
      });
    }
  }

  if (targets.filter((t) => t.channel === "sms").length === 0) {
    return {
      ok: false,
      statusCode: 400,
      message: "No active SMS recipients in targeted groups (empty / non-sendable)",
    };
  }

  return {
    ok: true,
    snapshot: {
      groupIds: uniqueGroupIds,
      resolvedAt: new Date().toISOString(),
      targets,
    },
  };
}
