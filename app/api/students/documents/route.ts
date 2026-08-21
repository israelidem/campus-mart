import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import type { DocumentType } from "@/lib/generated/prisma/enums";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { MAX_DOCUMENT_BYTES } from "@/lib/storage/storage";
import { uploadStudentDocument } from "@/lib/students/student-service";

/** Document types a student may upload during onboarding. */
const ACCEPTED_TYPES = new Set<DocumentType>(["STUDENT_PASSPORT_PHOTO", "STUDENT_ID_CARD"]);

/**
 * Uploads a private onboarding document (passport photograph or student ID).
 *
 * The response contains only the document id; the file itself is never exposed
 * through a public URL (PRD §56).
 *
 * Rate limited from Phase 13, before the body is read. Ordering is the point: an
 * upload is the most expensive request the platform accepts, and the cost is paid
 * in bandwidth and memory during `formData()`, not after. A limit applied after
 * parsing would refuse the request having already done the work.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("STUDENT");

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

  const bytes = new Uint8Array(await file.arrayBuffer());

  const document = await uploadStudentDocument(actor, {
    type: rawType as DocumentType,
    filename: file.name,
    mimeType: file.type,
    bytes,
  });

  return jsonOk({ document }, { status: 201 });
});
