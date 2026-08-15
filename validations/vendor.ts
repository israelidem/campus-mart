import { z } from "zod";

import { phoneSchema } from "@/validations/student";

/**
 * Vendor onboarding and store management validation (PRD §17–19, §23).
 *
 * As with students, `campusId` never appears in vendor input: campus comes from
 * the authenticated session. Status is also absent — a vendor cannot describe
 * itself as approved (Rule 29).
 */

/** URL-safe store identifier, derived server-side from the store name. */
export function slugifyStoreName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const storeNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your store name")
  .max(80, "Store name is too long")
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => slugifyStoreName(value).length >= 2, {
    message: "Store name must contain letters or numbers",
  });

const MINUTES_IN_DAY = 24 * 60;

/** Minutes from midnight. 1440 is accepted as end-of-day for closing times. */
const minuteOfDaySchema = z.number().int().min(0).max(MINUTES_IN_DAY);

/**
 * One day's trading hours. A closed day carries no times; an open day must have
 * both, and must close after it opens — an inverted range would silently make
 * the store unreachable.
 */
export const operatingHoursDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0, "Invalid day").max(6, "Invalid day"),
    isClosed: z.boolean(),
    opensAt: minuteOfDaySchema.nullable().optional(),
    closesAt: minuteOfDaySchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.isClosed) return;

    if (value.opensAt == null || value.closesAt == null) {
      ctx.addIssue({
        code: "custom",
        message: "Set both an opening and a closing time, or mark the day closed",
        path: ["opensAt"],
      });
      return;
    }
    if (value.closesAt <= value.opensAt) {
      ctx.addIssue({
        code: "custom",
        message: "Closing time must be after opening time",
        path: ["closesAt"],
      });
    }
  });
export type OperatingHoursDayInput = z.infer<typeof operatingHoursDaySchema>;

/** The full weekly schedule. Every day must appear exactly once. */
export const operatingHoursSchema = z
  .object({
    days: z.array(operatingHoursDaySchema).length(7, "Provide all seven days"),
  })
  .refine((value) => new Set(value.days.map((day) => day.dayOfWeek)).size === 7, {
    message: "Each day of the week must appear exactly once",
    path: ["days"],
  });
export type OperatingHoursInput = z.infer<typeof operatingHoursSchema>;

/**
 * Vendor application (PRD §17). Storefront evidence and an identity document
 * are referenced by upload id; the files themselves are already in private
 * storage by this point.
 */
export const vendorApplicationSchema = z.object({
  storeName: storeNameSchema,
  description: z.string().trim().max(1000, "Description is too long").optional(),
  phone: phoneSchema,
  storefrontLocation: z
    .string()
    .trim()
    .min(3, "Describe where your store is located")
    .max(200, "Location description is too long"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  storefrontDocumentId: z.string().min(1, "Upload a photograph of your storefront"),
  identityDocumentId: z.string().min(1, "Upload an identity or business document"),
});
export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;

/** Fields an approved vendor may change on their own store. */
export const vendorStoreUpdateSchema = z
  .object({
    storeName: storeNameSchema.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    phone: phoneSchema.optional(),
    storefrontLocation: z.string().trim().min(3).max(200).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type VendorStoreUpdateInput = z.infer<typeof vendorStoreUpdateSchema>;

export const acceptingOrdersSchema = z.object({ acceptingOrders: z.boolean() });
export type AcceptingOrdersInput = z.infer<typeof acceptingOrdersSchema>;

/** Campus Admin decision on a vendor application (PRD §16 review pattern). */
export const vendorReviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.decision === "APPROVE" || Boolean(value.note), {
    message: "A reason is required when rejecting or requesting a correction",
    path: ["note"],
  });
export type VendorReviewInput = z.infer<typeof vendorReviewSchema>;

/**
 * Suspension and reinstatement are separate from review because they apply to
 * an already-approved vendor and have different consequences (PRD §8, §48).
 */
export const vendorStatusSchema = z
  .object({
    action: z.enum(["SUSPEND", "REINSTATE"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.action !== "SUSPEND" || Boolean(value.reason), {
    message: "A reason is required when suspending a vendor",
    path: ["reason"],
  });
export type VendorStatusInput = z.infer<typeof vendorStatusSchema>;
