import { NextResponse } from "next/server";

import { apiHandler } from "@/lib/api/handler";

import { requireActor } from "@/lib/auth/session";
import { readProductImage } from "@/lib/products/product-service";

/**
 * Streams a product image to a member of the same campus.
 *
 * Product images live in private storage, so they are served here rather than
 * from a public URL (PRD §56). The response is private to the caller, hence
 * `Cache-Control: private`.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ imageId: string }> }) => {
    const actor = await requireActor();
    const { imageId } = await context.params;

    const image = await readProductImage(actor, imageId);

    return new NextResponse(image.bytes as unknown as BodyInit, {

      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  },
);
