import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { RegistryFormatError } from "@/lib/students/registry-csv";
import { importStudentRegistry } from "@/lib/students/student-service";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB ≈ 40k rows

/**
 * Imports an official student registry CSV for a campus (PRD §16).
 *
 * Accepts `multipart/form-data` with a `file` field (and optional `campusId`
 * for Super Admins). Invalid rows are reported back rather than silently
 * dropped, and nothing outside the admin's campus can be written.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");

  const form = await request.formData();
  const file = form.get("file");
  const campusId = form.get("campusId");

  if (!(file instanceof File)) throw new ValidationError("Attach a CSV file");
  if (file.size > MAX_CSV_BYTES) throw new ValidationError("The file must be 2 MB or smaller");

  const csv = await file.text();

  try {
    const result = await importStudentRegistry(actor, csv, {
      campusId: typeof campusId === "string" && campusId ? campusId : undefined,
    });

    return jsonOk({
      created: result.created,
      updated: result.updated,
      // Capped so a badly formatted file cannot produce an enormous response.
      invalid: result.invalid.slice(0, 100),
      invalidCount: result.invalid.length,
      duplicates: result.duplicates.slice(0, 100),
      duplicateCount: result.duplicates.length,
    });
  } catch (error) {
    if (error instanceof RegistryFormatError) throw new ValidationError(error.message);
    throw error;
  }
});
