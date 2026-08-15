import type { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/notifications/notification-service";

/**
 * Marks one notification read.
 *
 * A named operation rather than a PATCH of `readAt`: "read" is the only thing a
 * recipient may change about a notification, and the server sets the timestamp.
 * Ownership is asserted in the service, so an id from someone else's inbox is a
 * 404 rather than a silent write.
 */
export const POST = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ notificationId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { notificationId } = await context.params;

    const result = await markNotificationRead(actor, notificationId);
    return jsonOk(result);
  },
);
