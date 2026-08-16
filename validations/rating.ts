import { z } from "zod";

import { MAX_SCORE, MIN_SCORE } from "@/lib/ratings/rating-policy";

/**
 * Rating validation (PRD §57–59, Phase 10).
 *
 * A client may state a score, an optional comment and which of the two subjects
 * it is about. Everything else — which store, which agent, whether the delivery
 * was completed, whether the rater was the buyer — is read by the server from
 * the delivery row (Rule 1), so none of it appears here.
 */

export const ratingScoreSchema = z
  .number()
  .int("Give a whole number of stars")
  .min(MIN_SCORE, `Give at least ${MIN_SCORE} star`)
  .max(MAX_SCORE, `Give at most ${MAX_SCORE} stars`);

/**
 * Written review. Capped at a length a reader will actually read, and emptied
 * to `undefined` when blank so "  " never becomes a review that says nothing.
 */
export const ratingCommentSchema = z
  .string()
  .trim()
  .max(1_000, "That review is too long")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const ratingSubjectSchema = z.enum(["VENDOR", "DELIVERY_AGENT"]);

export const ratingSubmitSchema = z.object({
  subject: ratingSubjectSchema,
  score: ratingScoreSchema,
  comment: ratingCommentSchema,
});
export type RatingSubmitInput = z.infer<typeof ratingSubmitSchema>;

/**
 * An edit within the window. The subject is not editable: changing it would
 * mean rating a different party, which is a new rating, not an amendment.
 */
export const ratingUpdateSchema = z
  .object({
    score: ratingScoreSchema.optional(),
    comment: z.string().trim().max(1_000, "That review is too long").nullable().optional(),
  })
  .refine((value) => value.score !== undefined || value.comment !== undefined, {
    message: "Change the score or the review",
  });
export type RatingUpdateInput = z.infer<typeof ratingUpdateSchema>;

/**
 * Moderation (PRD §59). A reason is required: hiding someone's words without
 * recording why is not a decision anyone can review later.
 */
export const ratingHideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason for hiding this review")
    .max(300, "That reason is too long"),
});
export type RatingHideInput = z.infer<typeof ratingHideSchema>;

/** Public list of a store's or an agent's reviews. */
export const ratingListQuerySchema = z.object({
  vendorProfileId: z.string().min(1).optional(),
  agentProfileId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).optional(),
});
export type RatingListQuery = z.infer<typeof ratingListQuerySchema>;

/** The admin moderation queue filter. */
export const ratingModerationQuerySchema = z.object({
  /** "visible" (default), "hidden", or "all". */
  state: z.enum(["visible", "hidden", "all"]).optional(),
  subject: ratingSubjectSchema.optional(),
  /** Only ratings at or below this score — where complaints live. */
  maxScore: z.coerce.number().int().min(MIN_SCORE).max(MAX_SCORE).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type RatingModerationQuery = z.infer<typeof ratingModerationQuerySchema>;
