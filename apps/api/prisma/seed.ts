/**
 * Seed an initial Admin user for local/dev.
 *
 * Usage:
 *   SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api db:seed
 *
 * Passwords are argon2id-hashed; never stored plaintext.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordPolicy } from "../src/auth/password.js";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD;
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME ?? "BCP Admin";

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required (min 12 chars, letter + number)",
    );
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    throw new Error(policy.message);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { username },
    create: {
      username,
      displayName,
      passwordHash,
      urgentBypass: false,
      roles: { create: [{ role: "admin" }] },
    },
    update: {
      displayName,
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    include: { roles: true },
  });

  const hasAdmin = user.roles.some((r) => r.role === "admin");
  if (!hasAdmin) {
    await prisma.userRole.create({
      data: { userId: user.id, role: "admin" },
    });
  }

  await prisma.auditEvent.create({
    data: {
      actorUserId: user.id,
      action: "user.seed_admin",
      payload: { username: user.username },
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded admin user "${username}" (${user.id})`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
