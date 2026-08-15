import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/students/student-service";

/** The signed-in student's onboarding and verification state. */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireRole("STUDENT");
  return jsonOk(await getOnboardingState(actor));
});
