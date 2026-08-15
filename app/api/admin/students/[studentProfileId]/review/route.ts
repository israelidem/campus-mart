import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { reviewStudentProfile } from "@/lib/students/student-service";
import { studentReviewSchema } from "@/validations/student";

/**
 * Approve, reject or request a correction on a student submission (PRD §14).
 *
 * Campus ownership of the submission is verified in the service layer, so a
 * Campus Admin cannot review another campus's students.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ studentProfileId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { studentProfileId } = await context.params;
    const input = studentReviewSchema.parse(await request.json());

    const profile = await reviewStudentProfile(actor, studentProfileId, input);

    return jsonOk({ profile });
  },
);
