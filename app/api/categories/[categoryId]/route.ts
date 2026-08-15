import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { updateCategory } from "@/lib/products/category-service";
import { categoryUpdateSchema } from "@/validations/product";

/** Renames, reorders or (de)activates a category. Admins only. */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ categoryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { categoryId } = await context.params;
    const input = categoryUpdateSchema.parse(await request.json());

    const category = await updateCategory(actor, categoryId, input);

    return jsonOk({ category });
  },
);
