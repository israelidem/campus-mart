import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { getMarketplaceProduct } from "@/lib/products/marketplace-service";

export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ productId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;

    return jsonOk({ product: await getMarketplaceProduct(actor, productId) });
  },
);
