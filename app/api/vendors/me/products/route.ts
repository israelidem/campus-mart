import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { createProduct, listVendorProducts } from "@/lib/products/product-service";
import { productCreateSchema } from "@/validations/product";

/**
 * The signed-in vendor's own catalogue (PRD §21).
 *
 * Both handlers resolve the store from the session through
 * `requireApprovedVendor`, so a vendor id is never accepted from the client.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const products = await listVendorProducts(actor, {
    includeDeleted: url.searchParams.get("includeDeleted") === "true",
  });

  return jsonOk({ products });
});

export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = productCreateSchema.parse(await request.json());

  const product = await createProduct(actor, input);

  return jsonOk({ product }, { status: 201 });
});
