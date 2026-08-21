import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { getDeliveryRatingState, submitRating } from "@/lib/ratings/rating-service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { ratingSubmitSchema } from "@/validations/rating";

/**
 * Rating one completed delivery (PRD §57).
 *
 * Keyed by the delivery rather than the order or the store: the delivery is the
 * experience being rated, and it is also what proves the caller bought it, which
 * store sold it and which agent carried it. The client therefore never names its
 * subject's id — it says "the store" or "the agent" and the server resolves both
 * from the row (Rule 1).
 */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    const state = await getDeliveryRatingState(actor, deliveryId);

    return jsonOk({ rating: state });
  },
);

/**
 * Rate limited from Phase 13 at thirty an hour.
 *
 * `@@unique([deliveryId, subject])` already caps how many ratings can exist, so
 * this is not a duplicate guard. It exists because every accepted rating updates a
 * store's or an agent's three aggregate columns in the same transaction, and the
 * edit window means the same row can be rewritten repeatedly — a loop of edits is
 * a loop of write-contended updates on a row the whole marketplace sorts by.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    await enforceRateLimit({
      action: "RATING_SUBMISSION",
      userId: actor.userId,
      headers: request.headers,
    });

    const input = ratingSubmitSchema.parse(await request.json());

    const rating = await submitRating(actor, deliveryId, input);

    return jsonOk({ rating }, { status: 201 });
  },
);
