import { z } from "zod";

/** ISO 3166-1 alpha-2; DRC first, schema extensible for later countries. */
export const CountryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/)
  .default("CD");
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/** E.164 phone number (e.g. +243… for DRC). */
export const E164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (e.g. +243XXXXXXXXX)");
export type E164Phone = z.infer<typeof E164PhoneSchema>;

export const MemberPhoneSchema = z.object({
  e164: E164PhoneSchema,
  countryCode: CountryCodeSchema,
});
export type MemberPhone = z.infer<typeof MemberPhoneSchema>;

export const MemberSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  phones: z.array(MemberPhoneSchema).min(1),
  active: z.boolean().default(true),
});
export type Member = z.infer<typeof MemberSchema>;
