import type { NextRequest, NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import {
  listMyNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/notification-service";
import { notificationQuerySchema } from "@/validations/notification";

/**
 * The caller's own inbox (PRD §53).
 *
 * There is no "notifications for user X" endpoint and never will be: the only
 * inbox any request can read is the one belonging to its own session.
 */
export const GET = apiHandler(async (request: NextRequest): Promise<NextResponse> => {
  const actor = await requireActor();

  const params = request.nextUrl.searchParams;
  const query = notificationQuerySchema.parse({
    limit: params.get("limit") ?? undefined,
    unreadOnly: params.get("unreadOnly") ?? undefined,
  });

  const result = await listMyNotifications(actor, query);
  return jsonOk(result);
});

/** Marks the whole inbox read — what the "mark all read" control calls. */
export const POST = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const count = await markAllNotificationsRead(actor);
  return jsonOk({ markedRead: count });
});
