import { z } from "zod";
import {
  PaginationQuerySchema,
  PublicMemberPhoneSchema,
  PublicMemberSchema,
} from "./members.js";

export const CreateGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const UpdateGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

export const GroupMembershipRequestSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(500),
});
export type GroupMembershipRequest = z.infer<typeof GroupMembershipRequestSchema>;

export const GroupListQuerySchema = PaginationQuerySchema.omit({
  active: true,
}).extend({
  q: z.string().trim().max(200).optional(),
});
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>;

export const PublicGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  /** True when the group has ≥1 active member with ≥1 active phone (sendable). */
  sendable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicGroup = z.infer<typeof PublicGroupSchema>;

export const PaginatedGroupsSchema = z.object({
  items: z.array(PublicGroupSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedGroups = z.infer<typeof PaginatedGroupsSchema>;

export const GroupMembersResponseSchema = z.object({
  groupId: z.string().uuid(),
  items: z.array(PublicMemberSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type GroupMembersResponse = z.infer<typeof GroupMembersResponseSchema>;

/** Resolved phones for send-time targeting (immutable snapshot built in E4). */
export const ResolvedGroupPhoneSchema = z.object({
  memberId: z.string().uuid(),
  displayName: z.string(),
  phone: PublicMemberPhoneSchema,
});
export type ResolvedGroupPhone = z.infer<typeof ResolvedGroupPhoneSchema>;

export const ResolveGroupPhonesResponseSchema = z.object({
  groupId: z.string().uuid(),
  sendable: z.boolean(),
  phones: z.array(ResolvedGroupPhoneSchema),
});
export type ResolveGroupPhonesResponse = z.infer<
  typeof ResolveGroupPhonesResponseSchema
>;
