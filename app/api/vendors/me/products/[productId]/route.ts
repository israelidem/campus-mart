import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { deleteProduct, getVendorProduct, updateProduct } from "@/lib/products/product-service";
import { productUpdateSchema } from "@/validations/product";

type Context = { params: Promise<{ productId: string }> };

export const GET = apiHandler(
  async (_request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;

    return jsonOk({ product: await getVendorProduct(actor, productId) });
  },
);

/** Edits a product. Stock is not editable here — see the inventory route. */
export const PATCH = apiHandler(
  async (request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;
    const input = productUpdateSchema.parse(await request.json());

    return jsonOk({ product: await updateProduct(actor, productId, input) });
  },
);

/** Retires a product (soft delete, so order history stays readable). */
export const DELETE = apiHandler(
  async (_request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;

    return jsonOk({ product: await deleteProduct(actor, productId) });
  },
);
