import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { fileDispute, listMyDisputes } from "@/lib/disputes/dispute-service";
import { disputeFileSchema, disputeListQuerySchema } from "@/validations/dispute";

/**
 * The student's own cases (PRD §60).
 *
 * No filter parameter identifies *whose* cases: the list is scoped to the caller
 * by the service, from the session. A client that could ask for another student's
 * complaints would be able to read the reason they complained (Rule 25).
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const query = disputeListQuerySchema.parse({
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  return jsonOk({ disputes: await listMyDisputes(actor, query) });
});

/**
 * Opens a case against one purchase.
 *
 * `requireActor` rather than `requireRole("STUDENT")`: the right to complain
 * follows from having bought the thing, which the service verifies against the
 * order, and a student who has since become an agent has not lost that right.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = disputeFileSchema.parse(await request.json());

  return jsonOk(await fileDispute(actor, input), { status: 201 });
});
