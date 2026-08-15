import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { assertSameCampus } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import type {
  DeliveryLocationCreateInput,
  DeliveryLocationUpdateInput,
} from "@/validations/order";

/**
 * Campus delivery locations (PRD §28).
 *
 * Destinations are curated by the Campus Admin rather than typed by students:
 * the delivery fee is derived from the destination's coordinates and an agent
 * has to be able to find the place. Students choose from this list and add their
 * own room or flat detail on the order.
 */

export type DeliveryLocationSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  sortOrder: number;
  isActive: boolean;
};

const locationSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  latitude: true,
  longitude: true,
  sortOrder: true,
  isActive: true,
} as const;

function requireAdmin(actor: Actor): void {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a campus admin can manage delivery locations");
  }
}

/** The actor's own campus, except for a Super Admin, who must name one. */
function targetCampus(actor: Actor, requestedCampusId?: string): string {
  const campusId = actor.role === "SUPER_ADMIN" ? requestedCampusId : actor.campusId;
  if (!campusId) throw new ValidationError("A campus must be specified");
  assertSameCampus(actor, campusId);
  return campusId;
}

/**
 * Coordinates are stored as a pair or not at all: one half of a coordinate
 * cannot be placed on a map, and a half-set point would silently change the
 * delivery fee.
 */
function normaliseCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number | null; longitude: number | null } {
  const lat = latitude ?? null;
  const lon = longitude ?? null;
  if ((lat === null) !== (lon === null)) {
    throw new ValidationError("Provide both a latitude and a longitude, or neither");
  }
  return { latitude: lat, longitude: lon };
}

/**
 * Locations on the actor's campus.
 *
 * Inactive locations are only returned to an admin: a student must not be able
 * to choose a destination the campus has retired, and the query — not the
 * client — is what enforces that (Rule 25).
 */
export async function listDeliveryLocations(
  actor: Actor,
  options?: { campusId?: string; includeInactive?: boolean },
): Promise<DeliveryLocationSummary[]> {
  const campusId = targetCampus(actor, options?.campusId);

  const includeInactive =
    (actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN") &&
    options?.includeInactive === true;

  return prisma.deliveryLocation.findMany({
    where: { campusId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: locationSelect,
  });
}

export async function createDeliveryLocation(
  actor: Actor,
  input: DeliveryLocationCreateInput,
  options?: { campusId?: string },
): Promise<DeliveryLocationSummary> {
  requireAdmin(actor);
  const campusId = targetCampus(actor, options?.campusId);

  const slug = slugify(input.name);
  if (slug.length < 2) throw new ValidationError("Location name must contain letters or numbers");

  const coordinates = normaliseCoordinates(input.latitude, input.longitude);

  const clash = await prisma.deliveryLocation.findFirst({
    where: { campusId, slug },
    select: { id: true },
  });
  if (clash) throw new ConflictError("This campus already has a delivery location with that name");

  return prisma.$transaction(async (tx) => {
    const location = await tx.deliveryLocation.create({
      data: {
        campusId,
        name: input.name,
        slug,
        description: input.description ?? null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        sortOrder: input.sortOrder ?? 0,
      },
      select: locationSelect,
    });

    await recordAudit(
      {
        action: AuditAction.DELIVERY_LOCATION_CREATED,
        entityType: "DeliveryLocation",
        entityId: location.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        after: { name: location.name, slug: location.slug },
      },
      tx,
    );

    return location;
  });
}

/**
 * Renames, moves, reorders, or retires a location.
 *
 * Retiring is deactivation, never deletion: orders keep a foreign key to the
 * location they were delivered to, and their history must stay readable.
 */
export async function updateDeliveryLocation(
  actor: Actor,
  locationId: string,
  input: DeliveryLocationUpdateInput,
): Promise<DeliveryLocationSummary> {
  requireAdmin(actor);

  const existing = await prisma.deliveryLocation.findUnique({
    where: { id: locationId },
    select: { ...locationSelect, campusId: true },
  });
  if (!existing) throw new NotFoundError("Delivery location not found");
  assertSameCampus(actor, existing.campusId);

  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (input.latitude !== undefined || input.longitude !== undefined) {
    const coordinates = normaliseCoordinates(
      input.latitude === undefined ? existing.latitude : input.latitude,
      input.longitude === undefined ? existing.longitude : input.longitude,
    );
    data.latitude = coordinates.latitude;
    data.longitude = coordinates.longitude;
  }

  if (input.name !== undefined) {
    const slug = slugify(input.name);
    if (slug.length < 2) throw new ValidationError("Location name must contain letters or numbers");

    const clash = await prisma.deliveryLocation.findFirst({
      where: { campusId: existing.campusId, slug, id: { not: existing.id } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError("This campus already has a delivery location with that name");
    }

    data.name = input.name;
    data.slug = slug;
  }

  return prisma.$transaction(async (tx) => {
    const location = await tx.deliveryLocation.update({
      where: { id: existing.id },
      data,
      select: locationSelect,
    });

    await recordAudit(
      {
        action: AuditAction.DELIVERY_LOCATION_UPDATED,
        entityType: "DeliveryLocation",
        entityId: location.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: {
          name: existing.name,
          latitude: existing.latitude,
          longitude: existing.longitude,
          isActive: existing.isActive,
        },
        after: data,
      },
      tx,
    );

    return location;
  });
}
