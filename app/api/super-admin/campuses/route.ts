import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";

import { requireRole } from "@/lib/auth/session";
import { createCampus, listCampuses } from "@/lib/campus/campus-service";
import { createCampusSchema } from "@/validations/campus";

/** Global campus list (PRD §9). Super Admin only. */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireRole("SUPER_ADMIN");
  const campuses = await listCampuses(actor);
  return jsonOk({ campuses });
});

/** Creates a campus and its settings row (PRD §11). Super Admin only. */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("SUPER_ADMIN");
  const input = createCampusSchema.parse(await request.json());
  const campus = await createCampus(actor, input);
  return jsonOk({ campus }, { status: 201 });

});
