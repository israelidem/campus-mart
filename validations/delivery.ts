import { z } from "zod";

/**
 * Request shapes for the delivery engine (PRD §36–44).
 *
 * Nothing here carries a state, a deadline or a fee: those are decided by the
 * server. A client may say *which* delivery it means and, at most, why it is
 * giving up on one.
 */

const phone = z
  .string()
  .trim()
  .min(7, "Enter a phone number the student can reach you on")
  .max(20, "That phone number is too long");

const reason = z
  .string()
  .trim()
  .min(3, "Give a short reason")
  .max(300, "Keep the reason under 300 characters");

/** A student applying to carry deliveries on their campus. */
export const agentApplicationSchema = z.object({
  phone,
});
export type AgentApplicationInput = z.infer<typeof agentApplicationSchema>;

/** The agent's own on/off duty switch (PRD §38). */
export const agentDutySchema = z.object({
  isOnDuty: z.boolean(),
});
export type AgentDutyInput = z.infer<typeof agentDutySchema>;

/**
 * A Campus Admin's decision on an application.
 *
 * The note is required for anything other than an approval, because a rejection
 * a student cannot act on is worse than no answer.
 */
export const agentReviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION", "SUSPEND", "REINSTATE"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.decision === "APPROVE" || value.decision === "REINSTATE" || !!value.note, {
    message: "Explain the decision so the applicant knows what to do next",
    path: ["note"],
  });
export type AgentReviewInput = z.infer<typeof agentReviewSchema>;

/**
 * A delivery hand-over step an agent may take.
 *
 * These are the only forward moves Phase 6 exposes; the OTP and payment steps
 * arrive in Phases 7–8 and are deliberately not reachable from here.
 */
export const deliveryProgressSchema = z.object({
  action: z.enum(["PICKED_UP", "IN_TRANSIT", "ARRIVED"]),
});
export type DeliveryProgressInput = z.infer<typeof deliveryProgressSchema>;

/** An agent abandoning an accepted delivery (PRD §42). */
export const deliveryCancelSchema = z.object({
  reason,
});
export type DeliveryCancelInput = z.infer<typeof deliveryCancelSchema>;

/**
 * The code an agent types at the door (PRD §45).
 *
 * Spaces and dashes are stripped before length is judged, because a student
 * reading "482 917" aloud should not fail on punctuation. Nothing else about the
 * hand-over is a client input: the code itself is issued by the server, and the
 * payment window it opens is computed from campus settings.
 */
export const handoverVerifySchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => /^\d{6}$/.test(value), "Enter the 6-digit code the student is showing you"),
});
export type HandoverVerifyInput = z.infer<typeof handoverVerifySchema>;

/** The student never came to collect (PRD §44). */

export const deliveryUnavailableSchema = z.object({
  note: z.string().trim().max(300).optional(),
});
export type DeliveryUnavailableInput = z.infer<typeof deliveryUnavailableSchema>;
