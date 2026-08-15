import { z } from "zod";

/**
 * Campus management validation (PRD §11, §18, §29, §35, §47).
 *
 * Money is validated as integer kobo — the API never accepts a fractional
 * amount (PRD §64). Ranges are deliberately narrow so a mistyped configuration
 * cannot produce an absurd delivery fee or commission.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** Campus codes are uppercase alphanumerics, e.g. ABUAD, UNILAG, UI. */
export const campusCodeSchema = z
  .string()
  .trim()
  .min(2, "A campus code must be at least 2 characters")
  .max(12, "A campus code must be at most 12 characters")
  .regex(/^[A-Za-z0-9]+$/, "A campus code may only contain letters and numbers")
  .transform((value) => value.toUpperCase());

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const createCampusSchema = z.object({
  code: campusCodeSchema,
  name: trimmed(120),
  city: trimmed(80),
  state: trimmed(80).optional(),
  country: trimmed(80).default("Nigeria"),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  timezone: trimmed(60).default("Africa/Lagos"),
});
export type CreateCampusInput = z.infer<typeof createCampusSchema>;

/** Code is immutable once issued: campus-scoped references depend on it. */
export const updateCampusSchema = z
  .object({
    name: trimmed(120).optional(),
    city: trimmed(80).optional(),
    state: trimmed(80).nullable().optional(),
    country: trimmed(80).optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    timezone: trimmed(60).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");
export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;

export const campusStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z.string().trim().max(500).optional(),
});
export type CampusStatusInput = z.infer<typeof campusStatusSchema>;

/** Assigns an existing, verified user as the Campus Admin of one campus. */
export const assignCampusAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
export type AssignCampusAdminInput = z.infer<typeof assignCampusAdminSchema>;

const kobo = (label: string, max: number) =>
  z
    .number()
    .int(`${label} must be a whole number of kobo`)
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} is unreasonably high`);

const MAX_FEE_KOBO = 2_000_000; // ₦20,000

export const campusSettingsSchema = z
  .object({
    allowStudentVendors: z.boolean().optional(),
    requireRegistryMatch: z.boolean().optional(),

    deliveryBaseFeeKobo: kobo("The base fee", MAX_FEE_KOBO).optional(),
    deliveryPerKmKobo: kobo("The per-kilometre rate", MAX_FEE_KOBO).optional(),
    deliveryMinimumFeeKobo: kobo("The minimum fee", MAX_FEE_KOBO).optional(),
    deliveryMaximumFeeKobo: kobo("The maximum fee", MAX_FEE_KOBO).optional(),

    /// 250 = 2.5%. Capped at 20% so a typo cannot wipe out vendor earnings.
    commissionBps: z
      .number()
      .int("The commission must be a whole number of basis points")
      .min(0)
      .max(2000, "The commission cannot exceed 20%")
      .optional(),

    pickupWindowMinutes: z.number().int().min(5).max(60).optional(),
    studentWaitMinutes: z.number().int().min(5).max(60).optional(),
    goodsPaymentWindowMinutes: z.number().int().min(5).max(60).optional(),

    announcement: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one setting to update");
export type CampusSettingsInput = z.infer<typeof campusSettingsSchema>;

/**
 * Cross-field rule checked after merging with the stored row, since a partial
 * update may change only one side of the minimum/maximum pair.
 */
export function assertFeeBoundsCoherent(settings: {
  deliveryMinimumFeeKobo: number;
  deliveryMaximumFeeKobo: number;
}): void {
  if (settings.deliveryMinimumFeeKobo > settings.deliveryMaximumFeeKobo) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["deliveryMinimumFeeKobo"],
        message: "The minimum fee cannot exceed the maximum fee",
      },
    ]);
  }
}
