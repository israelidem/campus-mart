import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { removeProductImage } from "@/lib/products/product-service";

export const DELETE = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ productId: string; imageId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId, imageId } = await context.params;

    return jsonOk({ image: await removeProductImage(actor, productId, imageId) });
  },
);
