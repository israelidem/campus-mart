import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { assignCampusAdmin, listCampusAdmins } from "@/lib/campus/campus-service";
import { assignCampusAdminSchema } from "@/validations/campus";

type Context = { params: Promise<{ campusId: string }> };

/** Campus Admins of one campus (PRD §9). Super Admin only. */
export const GET = apiHandler(async (_request: Request, context: Context): Promise<NextResponse> => {
  const actor = await requireRole("SUPER_ADMIN");
  const { campusId } = await context.params;
  const admins = await listCampusAdmins(actor, campusId);
  return jsonOk({ admins });
});

/**
 * Promotes an existing, email-verified user to Campus Admin of this campus.
 *
 * The user must already have an account; the platform does not create admin
 * accounts with a password on their behalf.
 */
export const POST = apiHandler(
  async (request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireRole("SUPER_ADMIN");
    const { campusId } = await context.params;
    const input = assignCampusAdminSchema.parse(await request.json());
    const admin = await assignCampusAdmin(actor, campusId, input);
    return jsonOk({ admin }, { status: 201 });
  },
);
