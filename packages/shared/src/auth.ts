import { z } from "zod";
import { CapabilitySchema, RoleSchema } from "./roles.js";

/** Password policy for MVP username/password auth (no Entra). */
export const PASSWORD_MIN_LENGTH = 12;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const UsernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(64, "Username must be at most 64 characters")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Username may only contain letters, numbers, '.', '_' and '-'",
  );

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  roles: z.array(RoleSchema).min(1),
  capabilities: CapabilitySchema,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresInSeconds: z.number().int().positive(),
  user: PublicUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreateUserRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1).max(120),
  roles: z.array(RoleSchema).min(1),
  urgentBypass: z.boolean().default(false),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRolesRequestSchema = z.object({
  roles: z.array(RoleSchema).min(1),
  urgentBypass: z.boolean().optional(),
});
export type UpdateUserRolesRequest = z.infer<typeof UpdateUserRolesRequestSchema>;

/** JWT claim shape (server verifies; clients must not be trusted for authz). */
export const AccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  roles: z.array(RoleSchema),
  urgentBypass: z.boolean(),
  tokenVersion: z.number().int().nonnegative(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;
