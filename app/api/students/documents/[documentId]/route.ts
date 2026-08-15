import { NextResponse } from "next/server";

import { apiHandler } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { readOnboardingDocument } from "@/lib/students/student-service";

/**
 * Streams a private onboarding document to an authorised viewer: its owner, a
 * Campus Admin of the same campus, or a Super Admin (PRD §56).
 *
 * Responses are marked private and no-store so that documents are never cached
 * by shared caches.
 */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ documentId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { documentId } = await context.params;

    const document = await readOnboardingDocument(actor, documentId);

    return new NextResponse(document.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.bytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
