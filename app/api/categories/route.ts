import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { createCategory, listCategories } from "@/lib/products/category-service";
import { categoryCreateSchema } from "@/validations/product";

/** Categories on the caller's campus (PRD §20). */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const categories = await listCategories(actor, {
    campusId: url.searchParams.get("campusId") ?? undefined,
    includeInactive: url.searchParams.get("includeInactive") === "true",
  });

  return jsonOk({ categories });
});

/** Creates a category. Campus Admin (own campus) or Super Admin. */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const body = (await request.json()) as Record<string, unknown>;
  const input = categoryCreateSchema.parse(body);

  const category = await createCategory(actor, input, {
    campusId: typeof body.campusId === "string" ? body.campusId : undefined,
  });

  return jsonOk({ category }, { status: 201 });
});
