import { z } from "zod";

/**
 * Dispute validation (PRD §60–63, Phase 11).
 *
 * A student may state which purchase they are complaining about, why, and in
 * their own words what happened. An admin may state an outcome, an explanation
 * and — for a partial refund only — an amount.
 *
 * Everything else is read by the server: what the goods cost, what the platform's
 * cut was, whether the delivery completed, whether the window is still open, and
 * whether the person asking actually bought it (Rule 1). None of that appears
 * here, because a schema that accepted it would be accepting a claim.
 */

export const disputeReasonSchema = z.enum([
  "ITEM_NOT_RECEIVED",
  "WRONG_ITEM",
  "ITEM_INCOMPLETE",
  "ITEM_DAMAGED",
  "NOT_AS_DESCRIBED",
  "OVERCHARGED",
  "AGENT_CONDUCT",
  "OTHER",
]);

/**
 * The student's account of what went wrong.
 *
 * A minimum of twenty characters, not because longer complaints are better, but
 * because "bad" is not something an admin can investigate or a vendor can answer.
 * The floor is what makes the reason field worth reading.
 */
export const disputeDescriptionSchema = z
  .string()
  .trim()
  .min(20, "Tell us what happened, in at least a sentence")
  .max(2_000, "That description is too long — the essentials are enough");

/**
 * Filing a case. The purchase is identified by its vendor order: an invoice can
 * span two stores, and a complaint is always against one of them.
 */
export const disputeFileSchema = z.object({
  vendorOrderId: z.string().min(1, "Choose which purchase this is about"),
  reason: disputeReasonSchema,
  description: disputeDescriptionSchema,
});
export type DisputeFileInput = z.infer<typeof disputeFileSchema>;

/**
 * Resolving a case.
 *
 * `refundAmountKobo` is optional at the edge and required by the policy layer for
 * PARTIAL_REFUND only. It is deliberately *not* cross-validated here: the ceiling
 * is the snapshot on the dispute row, which this schema cannot see, and a check
 * that could only be approximate would give an admin false confidence.
 */
export const disputeResolveSchema = z.object({
  resolution: z.enum(["FULL_REFUND", "PARTIAL_REFUND", "NO_REFUND"]),
  /**
   * Whole kobo (PRD §64). Fractional input is rejected rather than rounded: a
   * client sending naira by mistake must fail loudly, not refund one hundredth of
   * what it meant.
   */
  refundAmountKobo: z
    .number()
    .int("Amounts are in whole kobo")
    .min(0, "An amount cannot be negative")
    .optional(),
  /** Required, because a decision nobody explained cannot be reviewed. */
  resolutionNote: z
    .string()
    .trim()
    .min(10, "Explain the decision — the student and the vendor both see this")
    .max(1_000, "That explanation is too long"),
});
export type DisputeResolveInput = z.infer<typeof disputeResolveSchema>;

/**
 * Taking a case back. A note is optional here, unlike a resolution: a student who
 * has changed their mind owes nobody an essay.
 */
export const disputeWithdrawSchema = z.object({
  note: z.string().trim().max(500, "That note is too long").optional(),
});
export type DisputeWithdrawInput = z.infer<typeof disputeWithdrawSchema>;

/** The student's own list of cases. */
export const disputeListQuerySchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "WITHDRAWN"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type DisputeListQuery = z.infer<typeof disputeListQuerySchema>;

/**
 * The admin queue.
 *
 * `state` defaults to "live" rather than "all", because the queue exists to show
 * what still needs doing; a page that opens on a year of closed cases is a report,
 * not a queue.
 */
export const disputeQueueQuerySchema = z.object({
  state: z.enum(["live", "open", "under_review", "resolved", "withdrawn", "all"]).optional(),
  reason: disputeReasonSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type DisputeQueueQuery = z.infer<typeof disputeQueueQuerySchema>;
