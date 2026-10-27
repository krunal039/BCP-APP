import argon2 from "argon2";
import { PasswordSchema } from "@bcp/shared";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function validatePasswordPolicy(password: string): {
  ok: true;
} | {
  ok: false;
  message: string;
} {
  const parsed = PasswordSchema.safeParse(password);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Password does not meet policy";
    return { ok: false, message };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    throw new Error(policy.message);
  }
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
