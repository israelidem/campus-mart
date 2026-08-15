import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { addProductImage } from "@/lib/products/product-service";

type Context = { params: Promise<{ productId: string }> };

/** Uploads a product photograph. Multipart, one file per request. */
export const POST = apiHandler(
  async (request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Attach an image file");

    const image = await addProductImage(actor, productId, {
      filename: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    return jsonOk({ image }, { status: 201 });
  },
);
