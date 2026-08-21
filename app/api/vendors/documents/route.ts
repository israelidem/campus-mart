import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import type { DocumentType } from "@/lib/generated/prisma/enums";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { MAX_DOCUMENT_BYTES } from "@/lib/storage/storage";
import { uploadVendorDocument } from "@/lib/vendors/vendor-service";

/** Document types a vendor may upload while applying (PRD §17). */
const ACCEPTED_TYPES = new Set<DocumentType>(["VENDOR_STOREFRONT", "VENDOR_IDENTITY"]);

/**
 * Uploads private vendor evidence (storefront photograph or identity document).
 *
 * Any authenticated campus user may upload, because an applicant is not a
 * vendor yet; eligibility is enforced in the service layer and again at
 * submission.
 *
 * Rate limited from Phase 13, sharing the `DOCUMENT_UPLOAD` bucket with student
 * onboarding: the limit protects storage and bandwidth, and it makes no difference
 * to either which endpoint the bytes came through. Applied before `formData()` for
 * the same reason as there — refusing after reading the body pays the cost anyway.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();

  await enforceRateLimit({
    action: "DOCUMENT_UPLOAD",
    userId: actor.userId,
    headers: request.headers,
  });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOCUMENT_BYTES + 8 * 1024) {
    throw new ValidationError("Files must be 5 MB or smaller");
  }

  const form = await request.formData();
  const rawType = form.get("type");
  const file = form.get("file");

  if (typeof rawType !== "string" || !ACCEPTED_TYPES.has(rawType as DocumentType)) {
    throw new ValidationError("Specify a valid document type");
  }
  if (!(file instanceof File)) {
    throw new ValidationError("Attach a file");
  }

  const document = await uploadVendorDocument(actor, {
    type: rawType as DocumentType,
    filename: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });

  return jsonOk({ document }, { status: 201 });
});
