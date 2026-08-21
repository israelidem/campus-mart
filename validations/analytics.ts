import { z } from "zod";

import { MAX_RANGE_DAYS, MS_PER_DAY } from "@/lib/analytics/analytics-policy";

/**
 * Analytics query validation (PRD §65–68, Phase 12).
 *
 * A reporting endpoint takes almost nothing from the client, and that is the whole
 * security story: `campusId` is *absent* by design for Campus Admins — the scope
 * comes from the session inside the service (Rule 25, Rule 29). A query parameter
 * that could widen the scope is a query parameter someone will eventually edit.
 *
 * What the client may choose is which window to look at and how many rows of a
 * leaderboard to show. Both are bounded here so a single request cannot be made to
 * scan a decade or return every vendor on the campus.
 */

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * Deliberately a date and not a datetime: a Campus Admin thinks in days, and
 * accepting an instant would invite a client to send a timezone-shifted midnight
 * that silently moves a day of trading from one report into another. The policy
 * layer expands a day into the half-open range that actually covers it.
 */
const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "That is not a real date");

export const analyticsRangeSchema = z
  .object({
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
  })
  .refine(
    (value) => {
      if (!value.from || !value.to) return true;
      return new Date(`${value.from}T00:00:00`) <= new Date(`${value.to}T00:00:00`);
    },
    { message: "The start of the range must not be after its end", path: ["from"] },
  )
  .refine(
    (value) => {
      if (!value.from || !value.to) return true;
      const span = new Date(`${value.to}T00:00:00`).getTime() - new Date(`${value.from}T00:00:00`).getTime();
      return span <= MAX_RANGE_DAYS * MS_PER_DAY;
    },
    { message: `A range may not exceed ${MAX_RANGE_DAYS} days`, path: ["to"] },
  );
export type AnalyticsRangeInput = z.infer<typeof analyticsRangeSchema>;

/**
 * The dashboard query.
 *
 * `campusId` *is* accepted, but only a Super Admin's request will get anywhere with
 * it: the service passes it to `campusScope`, which throws for a Campus Admin who
 * names a campus other than their own. Accepting it here and rejecting it there
 * keeps the authorisation decision in the one place that can make it.
 */
export const analyticsDashboardQuerySchema = analyticsRangeSchema.and(
  z.object({
    campusId: z.string().min(1).optional(),
    /** How many rows of each leaderboard. Small by default: a dashboard, not a report. */
    topLimit: z.coerce.number().int().min(1).max(50).optional(),
  }),
);
export type AnalyticsDashboardQuery = z.infer<typeof analyticsDashboardQuerySchema>;

/** The daily series behind the headline figures. */
export const analyticsSeriesQuerySchema = analyticsRangeSchema.and(
  z.object({
    campusId: z.string().min(1).optional(),
    metric: z.enum(["orders", "revenue", "deliveries"]).optional(),
  }),
);
export type AnalyticsSeriesQuery = z.infer<typeof analyticsSeriesQuerySchema>;

/**
 * Turns validated day strings into `Date`s the policy layer can resolve.
 *
 * Parsing happens here rather than in the schema so the schema stays a description
 * of the wire format, and so a caller reading the type knows it is holding strings
 * that came from a URL — not dates it can trust arithmetic on.
 */
export function toRangeDates(input: AnalyticsRangeInput): {
  from: Date | null;
  to: Date | null;
} {
  return {
    from: input.from ? new Date(`${input.from}T00:00:00`) : null,
    to: input.to ? new Date(`${input.to}T00:00:00`) : null,
  };
}
