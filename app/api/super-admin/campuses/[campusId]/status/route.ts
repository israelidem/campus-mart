import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { setCampusStatus } from "@/lib/campus/campus-service";
import { campusStatusSchema } from "@/validations/campus";

/**
 * Activates or deactivates a campus (PRD §9). Super Admin only.
 *
 * Deactivating removes the campus from registration immediately; existing data
 * is untouched.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ campusId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("SUPER_ADMIN");
    const { campusId } = await context.params;
    const input = campusStatusSchema.parse(await request.json());
    const campus = await setCampusStatus(actor, campusId, input);
    return jsonOk({ campus });
  },
);
