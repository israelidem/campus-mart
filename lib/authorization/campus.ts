import type { Actor } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";

/**
 * Campus isolation helpers (PRD Part D, Rule 25).
 *
 * Every campus-scoped query must pass its `where` clause through
 * `campusScope()` (or assert with `assertSameCampus`) so isolation is applied
 * in one auditable place instead of being re-implemented per query.
 */

/**
 * Returns the campusId filter an actor is allowed to read with.
 *
 * - Campus-bound roles are locked to their own campus.
 * - A Super Admin may read a specific campus when `requestedCampusId` is
 *   supplied, or all campuses when it is not.
 */
export function campusFilter(
  actor: Actor,
  requestedCampusId?: string | null,
): { campusId: string } | Record<string, never> {
  if (actor.role === "SUPER_ADMIN") {
    return requestedCampusId ? { campusId: requestedCampusId } : {};
  }

  if (!actor.campusId) {
    throw new ForbiddenError("Your account is not associated with a campus");
  }

  if (requestedCampusId && requestedCampusId !== actor.campusId) {
    throw new ForbiddenError("You cannot access data from another campus");
  }

  return { campusId: actor.campusId };
}

/**
 * Merges campus isolation into a Prisma `where` object.
 *
 * ```ts
 * prisma.product.findMany({ where: campusScope(actor, { isAvailable: true }) })
 * ```
 */
export function campusScope<T extends Record<string, unknown>>(
  actor: Actor,
  where: T = {} as T,
  requestedCampusId?: string | null,
): T & { campusId?: string } {
  return { ...where, ...campusFilter(actor, requestedCampusId) };
}

/** Throws unless the record's campus matches the actor's campus. */
export function assertSameCampus(actor: Actor, entityCampusId: string | null | undefined): void {
  if (actor.role === "SUPER_ADMIN") return;
  if (!actor.campusId || !entityCampusId || actor.campusId !== entityCampusId) {
    // Deliberately the same error as a missing record would produce upstream,
    // so cross-campus probing cannot be used to enumerate resources.
    throw new ForbiddenError("You cannot access data from another campus");
  }
}

/** Throws unless the actor owns the record (or is an admin of its campus). */
export function assertOwnership(
  actor: Actor,
  ownerUserId: string,
  options?: { allowCampusAdmin?: boolean; entityCampusId?: string | null },
): void {
  if (actor.userId === ownerUserId) return;

  if (actor.role === "SUPER_ADMIN") return;

  if (options?.allowCampusAdmin && actor.role === "CAMPUS_ADMIN") {
    assertSameCampus(actor, options.entityCampusId);
    return;
  }

  throw new ForbiddenError();
}
