import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { applyToBeAgent, getMyAgentProfile, setDutyStatus } from "@/lib/delivery/agent-service";
import { agentApplicationSchema, agentDutySchema } from "@/validations/delivery";

/** The caller's own agent standing. Null means they have never applied. */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const agent = await getMyAgentProfile(actor);
  return jsonOk({ agent });
});

/** Apply to deliver, or resubmit after a correction request (PRD §36). */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = agentApplicationSchema.parse(await request.json());

  const agent = await applyToBeAgent(actor, input);

  return jsonOk({ agent }, { status: 201 });
});

/** Go on or off duty (PRD §38). */
export const PATCH = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = agentDutySchema.parse(await request.json());

  const agent = await setDutyStatus(actor, input);

  return jsonOk({ agent });
});
