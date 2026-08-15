import { z } from "zod";

/**
 * Cart, checkout and order validation (PRD §25–29, Phase 5).
 *
 * Quantities, a delivery location id, a note and a phone number are the only
 * things a client may state. Prices, the delivery fee, the commission and every
 * total are computed by the server from its own rows (Rule 1), so they are
 * deliberately absent from these schemas — if a request carries them, they are
 * ignored rather than trusted.
 */

/** A single cart line. One unit minimum; the ceiling is a sanity bound. */
export const cartQuantitySchema = z
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(1_000, "That quantity is unrealistically high");

export const cartItemAddSchema = z.object({
  productId: z.string().min(1, "Choose a product"),
  /** Defaults to one so "add to cart" needs no body beyond the product. */
  quantity: cartQuantitySchema.optional(),
});
export type CartItemAddInput = z.infer<typeof cartItemAddSchema>;

/**
 * Absolute quantity, not a delta: a client that retries a request must not be
 * able to double an increment.
 */
export const cartItemUpdateSchema = z.object({
  quantity: cartQuantitySchema,
});
export type CartItemUpdateInput = z.infer<typeof cartItemUpdateSchema>;

/**
 * Nigerian mobile number, stored as typed but validated loosely enough to
 * accept the local (0803…) and international (+234803…) forms an agent can dial.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a phone number an agent can call")
  .max(20, "That phone number is too long")
  .regex(/^\+?[0-9\s-]+$/, "Enter a valid phone number");

export const checkoutSchema = z.object({
  deliveryLocationId: z.string().min(1, "Choose where this should be delivered"),
  /** Room, flat or landmark. Optional, because some locations need no detail. */
  deliveryNote: z.string().trim().max(300, "That note is too long").optional(),
  contactPhone: contactPhoneSchema,
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason for the cancellation")
    .max(300, "That reason is too long"),
});
export type OrderCancelInput = z.infer<typeof orderCancelSchema>;

// ---------------------------------------------------------------------------
// Delivery locations (Campus Admin)
// ---------------------------------------------------------------------------

const latitudeSchema = z
  .number()
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

const longitudeSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

export const deliveryLocationCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter a location name")
    .max(80, "Location name is too long")
    .transform((value) => value.replace(/\s+/g, " ")),
  description: z.string().trim().max(300, "Description is too long").optional(),
  /** Both or neither: a single coordinate cannot place a point on a map. */
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
});
export type DeliveryLocationCreateInput = z.infer<typeof deliveryLocationCreateSchema>;

export const deliveryLocationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9_999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type DeliveryLocationUpdateInput = z.infer<typeof deliveryLocationUpdateSchema>;

// ---------------------------------------------------------------------------
// Vendor order fulfilment
// ---------------------------------------------------------------------------

/**
 * The states a vendor may move their own slice into during Phase 5. Assignment
 * and hand-over belong to the delivery engine (Phase 6) and are not settable
 * here, which is why COMPLETED is absent.
 */
export const vendorOrderStatusUpdateSchema = z.object({
  status: z.enum(["PREPARING", "READY_FOR_PICKUP"]),
});
export type VendorOrderStatusUpdateInput = z.infer<typeof vendorOrderStatusUpdateSchema>;
