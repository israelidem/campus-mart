import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import { ensureSuperAdmin } from "@/lib/auth/bootstrap";

import { prisma } from "@/lib/db/prisma";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * The authenticated actor, resolved from the database on every request.
 *
 * The session cookie is only used to identify *who* is calling. Role, campus
 * and suspension state are always re-read from the database so that a stale
 * cookie can never grant elevated access (PRD §61, Rule 29).
 */
export type Actor = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  campusId: string | null;
  emailVerified: boolean;
  isSuspended: boolean;
};

export async function getActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      campusId: true,
      emailVerified: true,
      suspendedAt: true,
    },
  });
  if (!user) return null;

  // Platform-owner bootstrap: promotes an allowlisted email once, then no-ops.
  const { role, campusId } = await ensureSuperAdmin({
    id: user.id,
    email: user.email,
    role: user.role,
    campusId: user.campusId,
    emailVerified: user.emailVerified,
  });

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role,
    campusId,

    emailVerified: user.emailVerified,
    isSuspended: user.suspendedAt !== null,
  };
}

/** Requires a signed-in, non-suspended user. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  if (actor.isSuspended) {
    throw new ForbiddenError("Your account has been suspended. Contact your campus admin.");
  }
  return actor;
}

/** Requires one of the given roles. */
export async function requireRole(...roles: readonly UserRole[]): Promise<Actor> {
  const actor = await requireActor();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
  return actor;
}

/** An actor guaranteed to belong to a campus. */
export type CampusActor = Actor & { campusId: string };

/**
 * Requires an actor bound to a campus. Super Admins are excluded here on
 * purpose: global roles must use the explicit cross-campus helpers so that
 * campus-scoped queries can never accidentally run unscoped.
 */
export async function requireCampusActor(...roles: readonly UserRole[]): Promise<CampusActor> {
  const actor = roles.length ? await requireRole(...roles) : await requireActor();
  if (!actor.campusId) {
    throw new ForbiddenError("Your account is not associated with a campus");
  }
  return actor as CampusActor;
}

export function isSuperAdmin(actor: Actor): boolean {
  return actor.role === "SUPER_ADMIN";
}
