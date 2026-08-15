import { z } from "zod";

/**
 * Notification and push input schemas (PRD §54).
 *
 * The only thing a client may state about a push subscription is what its own
 * browser generated: an endpoint and two keys. Everything else — who owns it,
 * which campus it belongs to — is taken from the session (Rule 1).
 */

/**
 * A push service endpoint.
 *
 * Constrained to https so a subscription cannot be pointed at a plaintext
 * collector, and length-capped because these are URLs, not payloads.
 */
const endpoint = z
  .string()
  .trim()
  .min(1, "The push endpoint is required")
  .max(2000, "That push endpoint is not valid")
  .url("That push endpoint is not valid")
  .refine((value) => value.startsWith("https://"), {
    message: "Push endpoints must use https",
  });

/**
 * Base64url key material from the browser's own key pair.
 *
 * Validated for shape only: whether the keys actually encrypt is the push
 * service's business, and a wrong key simply produces a failed send.
 */
const keyMaterial = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is not valid`)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, `${label} is not valid`);

export const pushSubscriptionSchema = z.object({
  endpoint,
  keys: z.object({
    p256dh: keyMaterial("The device key", 200),
    auth: keyMaterial("The device secret", 100),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint });

export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

/** Inbox query parameters. `limit` is clamped again in the service. */
export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((value) => value === true || value === "true")
    .optional(),
});

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
