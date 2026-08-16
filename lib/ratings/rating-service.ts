import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, NotFoundError, StateConflictError, ValidationError } from "@/lib/errors";
import type { RatingSubject } from "@/lib/generated/prisma/enums";
import {
  aggregateFrom,
  applyEditedRating,
  applyNewRating,
  applyRemovedRating,
  applyRestoredRating,
  canEditRating,
  editHoursRemaining,
  formatAverage,
  isRateableDeliveryStatus,
  isValidScore,
  type RatingAggregate,
} from "@/lib/ratings/rating-policy";
import type {
  RatingHideInput,
  RatingListQuery,
  RatingModerationQuery,
  RatingSubmitInput,
  RatingUpdateInput,
} from "@/validations/rating";

/**
 * Ratings and reviews (PRD §24, §57–59).
 *
 * Three invariants hold everywhere in this file.
 *
 *  1. **The delivery decides who may rate what.** A client sends a score and a
 *     subject; the server reads the delivery to find out whether it completed,
 *     who bought it, which store sold it and which agent carried it. Nothing
 *     about the subject's identity is ever taken from the request (Rule 1).
 *  2. **The aggregate moves in the same transaction as the rating.** A stored
 *     average that is written by a later job can be wrong for as long as the job
 *     is late, and the marketplace sorts on it.
 *  3. **Hiding is not deleting.** A moderated rating keeps its row and its text
 *     and merely stops counting, so the decision is reversible and auditable
 *     (PRD §59).
 */

export type RatingView = {
  id: string;
  subject: RatingSubject;
  score: number;
  comment: string | null;
  /** Who wrote it, first name only: a review is not an introduction. */
  raterName: string;
  createdAt: Date;
  updatedAt: Date;
  /** True when this rating has been edited since it was given. */
  edited: boolean;
};

/** What a subject's reviews add up to, ready for display. */
export type RatingSummary = {
  count: number;
  averageHundredths: number;
  /** "4.3", or null when there are no ratings yet. */
  average: string | null;
};

/** One of the two ratings a student may leave for one delivery. */
export type RatingSlot = {
  subject: RatingSubject;
  /** Who is being rated, as the delivery snapshotted them. */
  subjectName: string;
  /** The student's own rating, when they have already given one. */
  mine: {
    id: string;
    score: number;
    comment: string | null;
    createdAt: Date;
    /** False once the edit window has closed or an admin has hidden it. */
    editable: boolean;
    /** Whole hours left to change it. Zero when it can no longer be edited. */
    hoursLeft: number;
  } | null;
  /** False when there is nobody to rate — an unassigned agent, for instance. */
  available: boolean;
};

/** Everything the "rate this delivery" panel needs. */
export type DeliveryRatingState = {
  deliveryId: string;
  orderReference: string;
  /** False for any delivery that did not complete; nothing may be rated then. */
  rateable: boolean;
  slots: readonly RatingSlot[];
};

/** A rating as an admin sees it in the moderation queue (PRD §59). */
export type ModeratedRatingView = RatingView & {
  deliveryId: string;
  orderReference: string;
  /** The store or agent this is about, named for the queue. */
  subjectName: string;
  raterEmail: string;
  hiddenAt: Date | null;
  hiddenReason: string | null;
};

/**
 * Only a verified student may rate, and only their own purchase.
 *
 * The delivery's order carries the buyer, so ownership is proven from the row
 * rather than from a claim: passing someone else's delivery id yields a 404,
 * not a rating.
 */
async function loadRateableDelivery(actor: Actor, deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      campusId: true,
      status: true,
      pickupName: true,
      agentProfileId: true,
      agentUserId: true,
      vendorOrder: {
        select: {
          vendorProfileId: true,
          order: { select: { reference: true, studentId: true } },
        },
      },
      ratings: {
        select: {
          id: true,
          subject: true,
          score: true,
          comment: true,
          hiddenAt: true,
          createdAt: true,
          raterId: true,
        },
      },
    },
  });
  if (!delivery) throw new NotFoundError("Delivery not found");

  // Campus isolation first: a delivery on another campus does not exist here.
  if (actor.role !== "SUPER_ADMIN" && delivery.campusId !== actor.campusId) {
    throw new NotFoundError("Delivery not found");
  }
  if (delivery.vendorOrder.order.studentId !== actor.userId) {
    throw new ForbiddenError("You can only rate your own deliveries");
  }

  return delivery;
}

/** The agent's display name, read at request time for the rating panel. */
async function agentDisplayName(agentUserId: string | null): Promise<string | null> {
  if (!agentUserId) return null;
  const user = await prisma.user.findUnique({
    where: { id: agentUserId },
    select: { name: true },
  });
  return user?.name ?? null;
}

/**
 * What the student may rate on one delivery, and what they already said.
 *
 * Returns a state rather than throwing for an unrateable delivery: the order
 * page shows this panel for every delivery, and "you cannot rate a returned
 * package" is information, not an error.
 */
export async function getDeliveryRatingState(
  actor: Actor,
  deliveryId: string,
  now: Date = new Date(),
): Promise<DeliveryRatingState> {
  const delivery = await loadRateableDelivery(actor, deliveryId);
  const rateable = isRateableDeliveryStatus(delivery.status);

  const agentName = await agentDisplayName(delivery.agentUserId);

  const slotFor = (subject: RatingSubject, subjectName: string | null): RatingSlot => {
    const mine = delivery.ratings.find(
      (rating) => rating.subject === subject && rating.raterId === actor.userId,
    );
    return {
      subject,
      subjectName: subjectName ?? "—",
      available: rateable && subjectName !== null,
      mine: mine
        ? {
            id: mine.id,
            score: mine.score,
            comment: mine.comment,
            createdAt: mine.createdAt,
            editable: canEditRating(mine, now),
            hoursLeft: mine.hiddenAt ? 0 : editHoursRemaining(mine.createdAt, now),
          }
        : null,
    };
  };

  return {
    deliveryId: delivery.id,
    orderReference: delivery.vendorOrder.order.reference,
    rateable,
    slots: [
      slotFor("VENDOR", delivery.pickupName),
      // An agent slot only exists when an agent actually carried it.
      slotFor("DELIVERY_AGENT", delivery.agentProfileId ? (agentName ?? "Your agent") : null),
    ],
  };
}

/**
 * Reads a subject's current aggregate inside a transaction.
 *
 * Read as part of the same transaction that writes it, so two ratings landing at
 * once cannot both start from the same stale sum.
 */
type AggregateTarget =
  | { subject: "VENDOR"; vendorProfileId: string }
  | { subject: "DELIVERY_AGENT"; agentProfileId: string };

async function readAggregate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  target: AggregateTarget,
): Promise<RatingAggregate> {
  if (target.subject === "VENDOR") {
    const row = await tx.vendorProfile.findUnique({
      where: { id: target.vendorProfileId },
      select: { ratingCount: true, ratingSum: true },
    });
    if (!row) throw new NotFoundError("Store not found");
    return aggregateFrom(row.ratingSum, row.ratingCount);
  }

  const row = await tx.deliveryAgentProfile.findUnique({
    where: { id: target.agentProfileId },
    select: { ratingCount: true, ratingSum: true },
  });
  if (!row) throw new NotFoundError("Delivery agent not found");
  return aggregateFrom(row.ratingSum, row.ratingCount);
}

async function writeAggregate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  target: AggregateTarget,
  next: RatingAggregate,
): Promise<void> {
  const data = {
    ratingCount: next.count,
    ratingSum: next.sum,
    ratingAverageHundredths: next.averageHundredths,
  };

  if (target.subject === "VENDOR") {
    await tx.vendorProfile.update({ where: { id: target.vendorProfileId }, data });
    return;
  }
  await tx.deliveryAgentProfile.update({ where: { id: target.agentProfileId }, data });
}

/**
 * Leaves a rating for one party on one completed delivery (PRD §57).
 *
 * The unique index on `[deliveryId, subject]` is the real guard against a double
 * submission, so a retried request is a conflict rather than a second row — and
 * a second row is what would otherwise quietly double a store's rating count.
 */
export async function submitRating(
  actor: Actor,
  deliveryId: string,
  input: RatingSubmitInput,
): Promise<RatingView> {
  if (!isValidScore(input.score)) throw new ValidationError("Give between 1 and 5 stars");

  const delivery = await loadRateableDelivery(actor, deliveryId);

  if (!isRateableDeliveryStatus(delivery.status)) {
    throw new StateConflictError("You can only rate a delivery that was completed");
  }

  const target: AggregateTarget =
    input.subject === "VENDOR"
      ? { subject: "VENDOR", vendorProfileId: delivery.vendorOrder.vendorProfileId }
      : delivery.agentProfileId
        ? { subject: "DELIVERY_AGENT", agentProfileId: delivery.agentProfileId }
        : (() => {
            throw new StateConflictError("This delivery has no agent to rate");
          })();

  const created = await prisma.$transaction(async (tx) => {
    // The unique index does the enforcing; this read makes the failure a clear
    // 409 instead of a raw constraint error.
    const existing = await tx.rating.findUnique({
      where: { deliveryId_subject: { deliveryId, subject: input.subject } },
      select: { id: true },
    });
    if (existing) {
      throw new StateConflictError("You have already rated this. Edit that rating instead.");
    }

    const rating = await tx.rating.create({
      data: {
        campusId: delivery.campusId,
        deliveryId,
        subject: input.subject,
        raterId: actor.userId,
        vendorProfileId:
          target.subject === "VENDOR" ? delivery.vendorOrder.vendorProfileId : null,
        agentProfileId: target.subject === "DELIVERY_AGENT" ? target.agentProfileId : null,
        score: input.score,
        comment: input.comment ?? null,
      },
      select: {
        id: true,
        subject: true,
        score: true,
        comment: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const next = applyNewRating(await readAggregate(tx, target), input.score);
    await writeAggregate(tx, target, next);

    await recordAudit(
      {
        action: AuditAction.RATING_SUBMITTED,
        entityType: "Rating",
        entityId: rating.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: delivery.campusId,
        after: { subject: input.subject, score: input.score, deliveryId },
      },
      tx,
    );

    return rating;
  });

  return {
    id: created.id,
    subject: created.subject,
    score: created.score,
    comment: created.comment,
    raterName: actor.name.split(" ")[0] ?? actor.name,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    edited: false,
  };
}

/**
 * Changes a rating the caller gave, inside the edit window (PRD §58).
 *
 * The window is checked against the server's clock and the stored `createdAt`,
 * so a late request is refused whatever the client believes the time is.
 */
export async function updateRating(
  actor: Actor,
  ratingId: string,
  input: RatingUpdateInput,
  now: Date = new Date(),
): Promise<RatingView> {
  if (input.score !== undefined && !isValidScore(input.score)) {
    throw new ValidationError("Give between 1 and 5 stars");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const rating = await tx.rating.findUnique({
      where: { id: ratingId },
      select: {
        id: true,
        campusId: true,
        raterId: true,
        subject: true,
        score: true,
        comment: true,
        hiddenAt: true,
        createdAt: true,
        vendorProfileId: true,
        agentProfileId: true,
      },
    });
    if (!rating) throw new NotFoundError("Rating not found");
    if (actor.role !== "SUPER_ADMIN" && rating.campusId !== actor.campusId) {
      throw new NotFoundError("Rating not found");
    }
    if (rating.raterId !== actor.userId) {
      throw new ForbiddenError("You can only change your own rating");
    }
    if (rating.hiddenAt) {
      throw new StateConflictError("This review was hidden by an admin and cannot be changed");
    }
    if (!canEditRating(rating, now)) {
      throw new StateConflictError("The time to change this rating has passed");
    }

    const nextScore = input.score ?? rating.score;
    const nextComment =
      input.comment === undefined ? rating.comment : (input.comment?.trim() || null);

    const row = await tx.rating.update({
      where: { id: rating.id },
      data: { score: nextScore, comment: nextComment },
      select: {
        id: true,
        subject: true,
        score: true,
        comment: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Only the score touches the aggregate, and only when it actually changed.
    if (nextScore !== rating.score) {
      const target: AggregateTarget = rating.vendorProfileId
        ? { subject: "VENDOR", vendorProfileId: rating.vendorProfileId }
        : { subject: "DELIVERY_AGENT", agentProfileId: rating.agentProfileId! };

      const next = applyEditedRating(await readAggregate(tx, target), rating.score, nextScore);
      await writeAggregate(tx, target, next);
    }

    await recordAudit(
      {
        action: AuditAction.RATING_UPDATED,
        entityType: "Rating",
        entityId: rating.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: rating.campusId,
        before: { score: rating.score, comment: rating.comment },
        after: { score: nextScore, comment: nextComment },
      },
      tx,
    );

    return row;
  });

  return {
    id: updated.id,
    subject: updated.subject,
    score: updated.score,
    comment: updated.comment,
    raterName: actor.name.split(" ")[0] ?? actor.name,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    edited: updated.updatedAt.getTime() !== updated.createdAt.getTime(),
  };
}

/**
 * A store's or an agent's visible reviews, newest first (PRD §24).
 *
 * Hidden ratings are excluded here as well as from the aggregates, so a
 * moderated review disappears from the storefront without disappearing from the
 * record. Cursor pagination rather than offset: reviews are appended constantly
 * and an offset page would skip or repeat rows as they arrive.
 */
export async function listRatings(
  actor: Actor,
  query: RatingListQuery,
): Promise<{ ratings: RatingView[]; nextCursor: string | null; summary: RatingSummary }> {
  if (!query.vendorProfileId && !query.agentProfileId) {
    throw new ValidationError("Choose a store or an agent to list reviews for");
  }

  const campusId = actor.role === "SUPER_ADMIN" ? undefined : (actor.campusId ?? undefined);
  const take = query.limit ?? 10;

  const rows = await prisma.rating.findMany({
    where: {
      ...(campusId ? { campusId } : {}),
      ...(query.vendorProfileId ? { vendorProfileId: query.vendorProfileId } : {}),
      ...(query.agentProfileId ? { agentProfileId: query.agentProfileId } : {}),
      hiddenAt: null,
    },
    select: {
      id: true,
      subject: true,
      score: true,
      comment: true,
      createdAt: true,
      updatedAt: true,
      rater: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? (page.at(-1)?.id ?? null) : null;

  // The summary comes from the subject's stored aggregate, not from this page:
  // ten reviews on screen must not imply a store has only ten.
  const summary = await getRatingSummary(query);

  return {
    ratings: page.map((row) => ({
      id: row.id,
      subject: row.subject,
      score: row.score,
      comment: row.comment,
      raterName: row.rater.name.split(" ")[0] ?? row.rater.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      edited: row.updatedAt.getTime() !== row.createdAt.getTime(),
    })),
    nextCursor,
    summary,
  };
}

/** A subject's stored aggregate, formatted for display. */
export async function getRatingSummary(target: {
  vendorProfileId?: string;
  agentProfileId?: string;
}): Promise<RatingSummary> {
  const row = target.vendorProfileId
    ? await prisma.vendorProfile.findUnique({
        where: { id: target.vendorProfileId },
        select: { ratingCount: true, ratingAverageHundredths: true },
      })
    : target.agentProfileId
      ? await prisma.deliveryAgentProfile.findUnique({
          where: { id: target.agentProfileId },
          select: { ratingCount: true, ratingAverageHundredths: true },
        })
      : null;

  const count = row?.ratingCount ?? 0;
  const averageHundredths = row?.ratingAverageHundredths ?? 0;

  return { count, averageHundredths, average: formatAverage(averageHundredths, count) };
}

/**
 * The Campus Admin moderation queue (PRD §59).
 *
 * Defaults to visible ratings, because moderation is about what buyers are
 * currently reading. `maxScore` exists because the queue that matters in
 * practice is "one- and two-star reviews on my campus this week".
 */
export async function listRatingsForModeration(
  actor: Actor,
  query: RatingModerationQuery,
): Promise<ModeratedRatingView[]> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError();
  }

  const state = query.state ?? "visible";

  const rows = await prisma.rating.findMany({
    where: {
      ...(actor.role === "SUPER_ADMIN" ? {} : { campusId: actor.campusId! }),
      ...(state === "visible" ? { hiddenAt: null } : {}),
      ...(state === "hidden" ? { hiddenAt: { not: null } } : {}),
      ...(query.subject ? { subject: query.subject } : {}),
      ...(query.maxScore ? { score: { lte: query.maxScore } } : {}),
    },
    select: {
      id: true,
      subject: true,
      score: true,
      comment: true,
      createdAt: true,
      updatedAt: true,
      hiddenAt: true,
      hiddenReason: true,
      deliveryId: true,
      rater: { select: { name: true, email: true } },
      delivery: {
        select: {
          pickupName: true,
          vendorOrder: { select: { order: { select: { reference: true } } } },
        },
      },
      agentProfile: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: query.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    score: row.score,
    comment: row.comment,
    raterName: row.rater.name,
    raterEmail: row.rater.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    edited: row.updatedAt.getTime() !== row.createdAt.getTime(),
    deliveryId: row.deliveryId,
    orderReference: row.delivery.vendorOrder.order.reference,
    subjectName:
      row.subject === "VENDOR"
        ? row.delivery.pickupName
        : (row.agentProfile?.user.name ?? "Delivery agent"),
    hiddenAt: row.hiddenAt,
    hiddenReason: row.hiddenReason,
  }));
}

/**
 * Hides an abusive or irrelevant review (PRD §59).
 *
 * The row survives; only its contribution to the aggregate is withdrawn, in the
 * same transaction. Idempotent: hiding an already-hidden rating changes nothing,
 * so a double click cannot subtract the same score twice.
 */
export async function hideRating(
  actor: Actor,
  ratingId: string,
  input: RatingHideInput,
): Promise<{ hidden: true }> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError();
  }

  await prisma.$transaction(async (tx) => {
    const rating = await tx.rating.findUnique({
      where: { id: ratingId },
      select: {
        id: true,
        campusId: true,
        score: true,
        hiddenAt: true,
        vendorProfileId: true,
        agentProfileId: true,
      },
    });
    if (!rating) throw new NotFoundError("Rating not found");
    if (actor.role !== "SUPER_ADMIN" && rating.campusId !== actor.campusId) {
      throw new NotFoundError("Rating not found");
    }
    if (rating.hiddenAt) return;

    await tx.rating.update({
      where: { id: rating.id },
      data: {
        hiddenAt: new Date(),
        hiddenById: actor.userId,
        hiddenReason: input.reason,
      },
    });

    const target: AggregateTarget = rating.vendorProfileId
      ? { subject: "VENDOR", vendorProfileId: rating.vendorProfileId }
      : { subject: "DELIVERY_AGENT", agentProfileId: rating.agentProfileId! };

    const next = applyRemovedRating(await readAggregate(tx, target), rating.score);
    await writeAggregate(tx, target, next);

    await recordAudit(
      {
        action: AuditAction.RATING_HIDDEN,
        entityType: "Rating",
        entityId: rating.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: rating.campusId,
        after: { reason: input.reason, score: rating.score },
      },
      tx,
    );
  });

  return { hidden: true };
}

/** Reverses a hide, restoring the score to the aggregate. Idempotent. */
export async function unhideRating(
  actor: Actor,
  ratingId: string,
): Promise<{ hidden: false }> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError();
  }

  await prisma.$transaction(async (tx) => {
    const rating = await tx.rating.findUnique({
      where: { id: ratingId },
      select: {
        id: true,
        campusId: true,
        score: true,
        hiddenAt: true,
        hiddenReason: true,
        vendorProfileId: true,
        agentProfileId: true,
      },
    });
    if (!rating) throw new NotFoundError("Rating not found");
    if (actor.role !== "SUPER_ADMIN" && rating.campusId !== actor.campusId) {
      throw new NotFoundError("Rating not found");
    }
    if (!rating.hiddenAt) return;

    await tx.rating.update({
      where: { id: rating.id },
      data: { hiddenAt: null, hiddenById: null, hiddenReason: null },
    });

    const target: AggregateTarget = rating.vendorProfileId
      ? { subject: "VENDOR", vendorProfileId: rating.vendorProfileId }
      : { subject: "DELIVERY_AGENT", agentProfileId: rating.agentProfileId! };

    const next = applyRestoredRating(await readAggregate(tx, target), rating.score);
    await writeAggregate(tx, target, next);

    await recordAudit(
      {
        action: AuditAction.RATING_UNHIDDEN,
        entityType: "Rating",
        entityId: rating.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: rating.campusId,
        before: { hiddenReason: rating.hiddenReason },
      },
      tx,
    );
  });

  return { hidden: false };
}

/**
 * Recomputes a subject's aggregate from its visible ratings.
 *
 * Not called on the write path — the aggregates are maintained transactionally
 * there — but kept as the repair operation for the one case the transactional
 * path cannot cover: rows removed by a cascade (an erased student account takes
 * their ratings with it) leave the counters one rating too high. Exposed to
 * admins only, and audited, because it overwrites a stored figure.
 */
export async function recomputeRatingAggregate(
  actor: Actor,
  target: { vendorProfileId?: string; agentProfileId?: string },
): Promise<RatingSummary> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError();
  }
  if (!target.vendorProfileId && !target.agentProfileId) {
    throw new ValidationError("Choose a store or an agent");
  }

  const summary = await prisma.$transaction(async (tx) => {
    const where = {
      ...(target.vendorProfileId ? { vendorProfileId: target.vendorProfileId } : {}),
      ...(target.agentProfileId ? { agentProfileId: target.agentProfileId } : {}),
      hiddenAt: null,
      ...(actor.role === "SUPER_ADMIN" ? {} : { campusId: actor.campusId! }),
    };

    const totals = await tx.rating.aggregate({
      where,
      _count: { _all: true },
      _sum: { score: true },
    });

    const next = aggregateFrom(totals._sum.score ?? 0, totals._count._all);

    const aggregateTarget: AggregateTarget = target.vendorProfileId
      ? { subject: "VENDOR", vendorProfileId: target.vendorProfileId }
      : { subject: "DELIVERY_AGENT", agentProfileId: target.agentProfileId! };

    await writeAggregate(tx, aggregateTarget, next);

    await recordAudit(
      {
        action: AuditAction.RATING_AGGREGATE_RECOMPUTED,
        entityType: target.vendorProfileId ? "VendorProfile" : "DeliveryAgentProfile",
        entityId: target.vendorProfileId ?? target.agentProfileId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: actor.campusId,
        after: next,
      },
      tx,
    );

    return next;
  });

  return {
    count: summary.count,
    averageHundredths: summary.averageHundredths,
    average: formatAverage(summary.averageHundredths, summary.count),
  };
}
