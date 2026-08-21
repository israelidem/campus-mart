import { NextResponse } from "next/server";

import { apiHandler } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { contentDispositionFor, safeContentType } from "@/lib/security/upload-policy";
import { privateFileHeaders } from "@/lib/security/headers";
import { readOnboardingDocument } from "@/lib/students/student-service";

/**
 * Streams a private onboarding document to an authorised viewer: its owner, a
 * Campus Admin of the same campus, or a Super Admin (PRD §56).
 *
 * Phase 13 changed two things about the response, both about what a browser does
 * with the bytes rather than who may read them:
 *
 *  - The `Content-Type` goes through `safeContentType`, so a stored string can
 *    only ever be one of the four accepted types or `application/octet-stream`.
 *    Before this, the column was the header, and the column came from an upload.
 *  - A PDF is now `Content-Disposition: attachment`. An inline PDF is a
 *    same-origin document with its own script context, and no screen here needs
 *    one rendered in place; images stay inline because an admin has to look at
 *    them.
 *
 * The headers themselves come from `privateFileHeaders`, which is also what the
 * product-image route uses — one definition of "private file", so a future route
 * cannot quietly serve a student's ID with a cacheable response.
 */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ documentId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { documentId } = await context.params;

    const document = await readOnboardingDocument(actor, documentId);
    const contentType = safeContentType(document.mimeType);

    return new NextResponse(document.bytes as unknown as BodyInit, {
      status: 200,
      headers: privateFileHeaders({
        contentType,
        contentLength: document.bytes.byteLength,
        disposition: contentDispositionFor(contentType),
      }),
    });
  },
);
