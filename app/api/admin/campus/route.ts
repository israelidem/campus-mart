import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getCampus, updateCampusSettings } from "@/lib/campus/campus-service";
import { ForbiddenError } from "@/lib/errors";
import { campusSettingsSchema } from "@/validations/campus";

/**
 * A Campus Admin's own campus and its settings (PRD §8).
 *
 * The campus id is never taken from the request: it comes from the session, so
 * there is nothing for a caller to tamper with (Rule 25, Rule 29).
 */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN");
  if (!actor.campusId) throw new ForbiddenError("Your account is not attached to a campus");

  const campus = await getCampus(actor, actor.campusId);
  return jsonOk({ campus });
});

/** Updates the settings of the admin's own campus (PRD §18, §29, §35, §47). */
export const PATCH = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN");
  if (!actor.campusId) throw new ForbiddenError("Your account is not attached to a campus");

  const input = campusSettingsSchema.parse(await request.json());
  const settings = await updateCampusSettings(actor, actor.campusId, input);
  return jsonOk({ settings });
});
