import { NextResponse } from "next/server";

import { apiHandler } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { readProductImage } from "@/lib/products/product-service";
import { privateFileHeaders } from "@/lib/security/headers";
import { contentDispositionFor, safeContentType } from "@/lib/security/upload-policy";

/**
 * Streams a product image to a member of the same campus.
 *
 * Product images live in private storage, so they are served here rather than
 * from a public URL (PRD §56).
 *
 * Phase 13 tightened the caching. This used to send `private, max-age=300`, which
 * is the reasonable-sounding choice and the wrong one: the response is
 * authorised per-caller, and a shared intermediary that honours `private` today is
 * still a five-minute window in which a mis-configured one does not. The right fix
 * is signed URLs on a CDN, which is Phase 14's work; until then the honest
 * position is `no-store` and a slower catalogue.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ imageId: string }> }) => {
    const actor = await requireActor();
    const { imageId } = await context.params;

    const image = await readProductImage(actor, imageId);
    const contentType = safeContentType(image.mimeType);

    return new NextResponse(image.bytes as unknown as BodyInit, {
      status: 200,
      headers: privateFileHeaders({
        contentType,
        contentLength: image.bytes.byteLength,
        disposition: contentDispositionFor(contentType),
      }),
    });
  },
);
