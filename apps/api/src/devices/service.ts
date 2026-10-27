import type { PrismaClient } from "@prisma/client";
import {
  RegisterDeviceTokenRequestSchema,
  type PublicDeviceToken,
} from "@bcp/shared";

function toPublicDeviceToken(row: {
  id: string;
  expoToken: string;
  active: boolean;
  updatedAt: Date;
}): PublicDeviceToken {
  return {
    id: row.id,
    expoToken: row.expoToken,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DeviceTokenService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert Expo push token for the authenticated user.
   * If the token was previously owned by another user, reassign it.
   */
  async register(
    userId: string,
    body: unknown,
  ): Promise<
    | { ok: true; token: PublicDeviceToken }
    | { ok: false; statusCode: 400; message: string }
  > {
    const parsed = RegisterDeviceTokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        statusCode: 400,
        message: parsed.error.issues[0]?.message ?? "Invalid device token",
      };
    }

    const { expoToken } = parsed.data;
    const row = await this.prisma.deviceToken.upsert({
      where: { expoToken },
      create: {
        userId,
        expoToken,
        active: true,
      },
      update: {
        userId,
        active: true,
      },
    });

    return { ok: true, token: toPublicDeviceToken(row) };
  }

  /** Soft-deactivate a token for this user (logout / permission revoke). */
  async deactivate(
    userId: string,
    expoToken: string,
  ): Promise<
    | { ok: true; deactivated: boolean }
    | { ok: false; statusCode: 400; message: string }
  > {
    const trimmed = expoToken.trim();
    if (!trimmed) {
      return { ok: false, statusCode: 400, message: "expoToken is required" };
    }

    const result = await this.prisma.deviceToken.updateMany({
      where: { userId, expoToken: trimmed, active: true },
      data: { active: false },
    });

    return { ok: true, deactivated: result.count > 0 };
  }

  async listForUser(userId: string): Promise<PublicDeviceToken[]> {
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId, active: true },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toPublicDeviceToken);
  }
}
