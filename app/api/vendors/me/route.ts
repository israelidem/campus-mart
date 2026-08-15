import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import {
  getVendorState,
  submitVendorApplication,
  updateVendorStore,
} from "@/lib/vendors/vendor-service";
import { vendorApplicationSchema, vendorStoreUpdateSchema } from "@/validations/vendor";

/** The signed-in user's own vendor application/store state. */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  return jsonOk({ store: await getVendorState(actor) });
});

/**
 * Submits (or resubmits) a vendor application (PRD §17).
 *
 * Campus, status and student-vendor eligibility are all decided server-side;
 * the body carries only the store's own details.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = vendorApplicationSchema.parse(await request.json());

  const application = await submitVendorApplication(actor, input);

  return jsonOk({ application }, { status: 201 });
});

/** Updates the vendor's own store details. Approved vendors only. */
export const PATCH = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = vendorStoreUpdateSchema.parse(await request.json());

  const store = await updateVendorStore(actor, input);

  return jsonOk({ store });
});
