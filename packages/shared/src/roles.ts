import { z } from "zod";

/** In-app roles. Auth is username/password for MVP (no Entra). */
export const RoleSchema = z.enum([
  "recipient",
  "sender",
  "approver",
  "admin",
]);
export type Role = z.infer<typeof RoleSchema>;

/** Capability flags layered on top of roles (not a role itself). */
export const CapabilitySchema = z.object({
  urgentBypass: z.boolean().default(false),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const UserRolesSchema = z.object({
  roles: z.array(RoleSchema).min(1),
  capabilities: CapabilitySchema.default({ urgentBypass: false }),
});
export type UserRoles = z.infer<typeof UserRolesSchema>;
