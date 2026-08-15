import { assertKobo, clampKobo, type Kobo } from "@/lib/money";

/**
 * Delivery pricing engine (PRD §29).
 *
 * The fee is a pure function of a distance and the campus's configured pricing,
 * so it can be unit-tested and, more importantly, recomputed identically at
 * checkout and in any later audit. Nothing here reads the database or the clock.
 *
 * `MAP_PROVIDER=haversine` (the default) means the distance is the straight line
 * between two coordinates. A real routing provider will replace
 * `distanceMeters` in Phase 5+, but the fee formula it feeds is unchanged.
 */

/** Mean Earth radius in metres, per WGS-84. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const METERS_PER_KM = 1_000;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type DeliveryPricing = {
  /** Charged on every delivery regardless of distance. */
  deliveryBaseFeeKobo: Kobo;
  /** Added per kilometre travelled. */
  deliveryPerKmKobo: Kobo;
  deliveryMinimumFeeKobo: Kobo;
  deliveryMaximumFeeKobo: Kobo;
};

export type DeliveryQuote = {
  /** Null when either end has no coordinates. */
  distanceMeters: number | null;
  feeKobo: Kobo;
  /** True when the fee was pinned to the campus minimum or maximum. */
  clamped: boolean;
};

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in whole metres.
 *
 * Rounded to a metre because a campus delivery is priced per kilometre; keeping
 * fractions would only invite floating-point noise into a stored value.
 */
export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const deltaLat = toLat - fromLat;
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a))));
}

/**
 * Base fee plus the per-kilometre rate applied to the distance, clamped to the
 * campus's configured minimum and maximum.
 *
 * A null distance means the campus or the destination has no coordinates yet.
 * That must not block a checkout, so the base fee alone is charged — still
 * clamped, so the floor and ceiling the campus configured always hold.
 *
 * Rounding is to the nearest kobo: the distance component is a rate times a
 * fraction of a kilometre and will rarely land on a whole kobo.
 */
export function quoteDeliveryFee(
  distanceMeters: number | null,
  pricing: DeliveryPricing,
): DeliveryQuote {
  assertKobo(pricing.deliveryBaseFeeKobo, "deliveryBaseFeeKobo");
  assertKobo(pricing.deliveryPerKmKobo, "deliveryPerKmKobo");

  if (distanceMeters !== null && (!Number.isFinite(distanceMeters) || distanceMeters < 0)) {
    throw new Error(`distanceMeters must be a non-negative number, received ${distanceMeters}`);
  }

  const distanceComponent =
    distanceMeters === null
      ? 0
      : Math.round((distanceMeters / METERS_PER_KM) * pricing.deliveryPerKmKobo);

  const raw = pricing.deliveryBaseFeeKobo + distanceComponent;
  const feeKobo = clampKobo(
    raw,
    pricing.deliveryMinimumFeeKobo,
    pricing.deliveryMaximumFeeKobo,
  );

  return { distanceMeters, feeKobo, clamped: feeKobo !== raw };
}

/**
 * Distance from a campus's pickup area to a destination, or null when either
 * end is missing a coordinate.
 *
 * Phase 5 measures from the campus centre rather than from each vendor: one
 * invoice carries one delivery fee (PRD §26), so the fee cannot depend on which
 * of several stores the agent visits first. Phase 6 may refine the route, but
 * not the price the student already agreed to.
 */
/** A point that may not have been geocoded yet. */
export type MaybeCoordinates = {
  latitude?: number | null;
  longitude?: number | null;
};

export function distanceBetween(
  from: MaybeCoordinates | null | undefined,
  to: MaybeCoordinates | null | undefined,
): number | null {

  if (
    from == null ||
    to == null ||
    typeof from.latitude !== "number" ||
    typeof from.longitude !== "number" ||
    typeof to.latitude !== "number" ||
    typeof to.longitude !== "number"
  ) {
    return null;
  }

  return haversineMeters(
    { latitude: from.latitude, longitude: from.longitude },
    { latitude: to.latitude, longitude: to.longitude },
  );
}
