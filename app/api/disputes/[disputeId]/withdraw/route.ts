import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { withdrawDispute } from "@/lib/disputes/dispute-service";
import { disputeWithdrawSchema } from "@/validations/dispute";

/**
 * The student takes their case back (PRD §60).
 *
 * POST, not DELETE: a withdrawal is a recorded outcome, not the removal of a
 * record. The case and its reason survive, which is what lets support tell the
 * difference between "resolved" and "the student gave up".
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ disputeId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { disputeId } = await context.params;

    // An empty body is legitimate here: the note is optional.
    const raw = await request.text();
    const input = disputeWithdrawSchema.parse(raw ? JSON.parse(raw) : {});

    return jsonOk(await withdrawDispute(actor, disputeId, input));
  },
);
