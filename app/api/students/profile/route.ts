import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { submitStudentProfile } from "@/lib/students/student-service";
import { studentProfileSubmissionSchema } from "@/validations/student";

/**
 * Submits student details for Campus Admin verification (PRD §13–14).
 *
 * Campus is taken from the authenticated user, never from the request body.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("STUDENT");
  const input = studentProfileSubmissionSchema.parse(await request.json());

  const profile = await submitStudentProfile(actor, input);

  return jsonOk({ profile }, { status: 201 });
});
