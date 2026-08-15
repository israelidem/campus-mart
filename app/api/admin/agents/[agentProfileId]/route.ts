import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { reviewAgent } from "@/lib/delivery/agent-service";
import { agentReviewSchema } from "@/validations/delivery";

/** Approve, reject, ask for a correction, suspend or reinstate an agent. */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ agentProfileId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { agentProfileId } = await context.params;
    const input = agentReviewSchema.parse(await request.json());

    const agent = await reviewAgent(actor, agentProfileId, input);

    return jsonOk({ agent });
  },
);
