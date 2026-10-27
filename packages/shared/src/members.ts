import { z } from "zod";

/** ISO 3166-1 alpha-2; DRC first, schema extensible for later countries. */
export const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2)
  .regex(/^[A-Z]{2}$/, "countryCode must be ISO 3166-1 alpha-2");
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/** Default country for DRC-first MVP. */
export const DEFAULT_COUNTRY_CODE = "CD" as const satisfies CountryCode;

/** E.164 phone number (e.g. +243… for DRC). */
export const E164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (e.g. +243XXXXXXXXX)");
export type E164Phone = z.infer<typeof E164PhoneSchema>;

/** Compliance hygiene: why we may contact this member (E3.4). */
export const ContactBasisSchema = z.enum(["employment", "consent", "other"]);
export type ContactBasis = z.infer<typeof ContactBasisSchema>;

export const MemberPhoneSchema = z.object({
  id: z.string().uuid().optional(),
  e164: E164PhoneSchema,
  countryCode: CountryCodeSchema.default(DEFAULT_COUNTRY_CODE),
  active: z.boolean().default(true),
});
export type MemberPhone = z.infer<typeof MemberPhoneSchema>;

export const MemberSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  phones: z.array(MemberPhoneSchema).min(1),
  active: z.boolean().default(true),
  contactBasis: ContactBasisSchema.default("employment"),
  contactBasisAt: z.coerce.date().optional(),
  countryCode: CountryCodeSchema.default(DEFAULT_COUNTRY_CODE),
});
export type Member = z.infer<typeof MemberSchema>;

/** Create member + primary phone (DRC default). */
export const CreateMemberRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  e164: E164PhoneSchema,
  countryCode: CountryCodeSchema.default(DEFAULT_COUNTRY_CODE),
  active: z.boolean().default(true),
  contactBasis: ContactBasisSchema.default("employment"),
  contactBasisAt: z.coerce.date().optional(),
  /** Optional link to an auth User (recipient app login). */
  userId: z.string().uuid().optional(),
});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>;

export const UpdateMemberRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    active: z.boolean().optional(),
    contactBasis: ContactBasisSchema.optional(),
    contactBasisAt: z.coerce.date().optional(),
    userId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

export const AddMemberPhoneRequestSchema = z.object({
  e164: E164PhoneSchema,
  countryCode: CountryCodeSchema.default(DEFAULT_COUNTRY_CODE),
  active: z.boolean().default(true),
});
export type AddMemberPhoneRequest = z.infer<typeof AddMemberPhoneRequestSchema>;

export const UpdateMemberPhoneRequestSchema = z
  .object({
    e164: E164PhoneSchema.optional(),
    countryCode: CountryCodeSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateMemberPhoneRequest = z.infer<
  typeof UpdateMemberPhoneRequestSchema
>;

export const PaginationQuerySchema = z.object({
  /** 1-based page index. Offset pagination is fine at ~10k with indexes. */
  page: z.coerce.number().int().positive().default(1),
  /** Page size capped to keep list payloads bounded. */
  limit: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().trim().max(200).optional(),
  active: z
    .enum(["true", "false", "all"])
    .default("true")
    .transform((v) => (v === "all" ? "all" : v === "true")),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const MemberListQuerySchema = PaginationQuerySchema;
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;

export const PublicMemberPhoneSchema = z.object({
  id: z.string().uuid(),
  e164: E164PhoneSchema,
  countryCode: CountryCodeSchema,
  active: z.boolean(),
});
export type PublicMemberPhone = z.infer<typeof PublicMemberPhoneSchema>;

export const PublicMemberSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  active: z.boolean(),
  contactBasis: ContactBasisSchema,
  contactBasisAt: z.string().datetime(),
  userId: z.string().uuid().nullable(),
  phones: z.array(PublicMemberPhoneSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicMember = z.infer<typeof PublicMemberSchema>;

export const PaginatedMembersSchema = z.object({
  items: z.array(PublicMemberSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedMembers = z.infer<typeof PaginatedMembersSchema>;

const OptionalCsvString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/** CSV import row (header-flexible; see members/csv parser). */
export const MemberCsvRowSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  e164: E164PhoneSchema,
  countryCode: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    CountryCodeSchema.default(DEFAULT_COUNTRY_CODE),
  ),
  contactBasis: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    ContactBasisSchema.default("employment"),
  ),
  groupName: OptionalCsvString.pipe(z.string().min(1).max(120).optional()),
  active: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return true;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return v;
  }, z.boolean()),
});
export type MemberCsvRow = z.infer<typeof MemberCsvRowSchema>;

export const MemberImportResultSchema = z.object({
  committed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      row: z.number().int().positive(),
      message: z.string(),
    }),
  ),
  memberIds: z.array(z.string().uuid()),
});
export type MemberImportResult = z.infer<typeof MemberImportResultSchema>;
