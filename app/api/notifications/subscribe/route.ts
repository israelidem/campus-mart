import type { NextRequest, NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import {
  deletePushSubscription,
  savePushSubscription,
} from "@/lib/notifications/notification-service";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/validations/notification";

/**
 * Push subscription registration (PRD §54).
 *
 * The browser has already asked its user for permission and minted a
 * subscription by the time this runs; all the server does is remember which
 * account and campus it belongs to. The body may state the endpoint and keys and
 * nothing else — ownership comes from the session (Rule 1).
 */
export const POST = apiHandler(async (request: NextRequest): Promise<NextResponse> => {
  const actor = await requireActor();

  const input = pushSubscriptionSchema.parse(await request.json());
  const saved = await savePushSubscription(actor, input, {
    // Support only: which device stopped receiving pushes.
    userAgent: request.headers.get("user-agent"),
  });

  return jsonOk({ id: saved.id, subscribed: true });
});

/**
 * Unsubscribes this device.
 *
 * DELETE with a body because the endpoint is long and identifies the device, not
 * a resource path. Deleting is scoped to the caller, so an endpoint someone
 * scraped cannot be used to silence another student's phone.
 */
export const DELETE = apiHandler(async (request: NextRequest): Promise<NextResponse> => {
  const actor = await requireActor();

  const { endpoint } = pushUnsubscribeSchema.parse(await request.json());
  const removed = await deletePushSubscription(actor, endpoint);

  return jsonOk({ removed, subscribed: false });
});
