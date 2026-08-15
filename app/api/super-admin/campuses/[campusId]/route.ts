import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getCampus, updateCampus } from "@/lib/campus/campus-service";
import { updateCampusSchema } from "@/validations/campus";

type Context = { params: Promise<{ campusId: string }> };

/** One campus with its settings. Super Admin only. */
export const GET = apiHandler(async (_request: Request, context: Context): Promise<NextResponse> => {
  const actor = await requireRole("SUPER_ADMIN");
  const { campusId } = await context.params;
  const campus = await getCampus(actor, campusId);
  return jsonOk({ campus });
});

/** Updates campus details. The campus code is immutable. Super Admin only. */
export const PATCH = apiHandler(
  async (request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireRole("SUPER_ADMIN");
    const { campusId } = await context.params;
    const input = updateCampusSchema.parse(await request.json());
    const campus = await updateCampus(actor, campusId, input);
    return jsonOk({ campus });
  },
);
