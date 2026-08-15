import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listAgentsForAdmin } from "@/lib/delivery/agent-service";
import type { VerificationStatus } from "@/lib/generated/prisma/enums";

/**
 * The Campus Admin's agent review queue.
 *
 * Campus scoping is applied by the service, in the query: an admin cannot widen
 * it by asking for another campus (Rule 25).
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const status = new URL(request.url).searchParams.get("status");

  const agents = await listAgentsForAdmin(actor, {
    status: (status ?? undefined) as VerificationStatus | undefined,
  });

  return jsonOk({ agents });
});
