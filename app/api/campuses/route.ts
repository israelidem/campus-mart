import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

/**
 * Active campuses, for the registration form.
 *
 * Intentionally public and minimal: only the fields needed to choose a campus
 * are exposed, and inactive campuses are never listed.
 */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const campuses = await prisma.campus.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, name: true, city: true },
    orderBy: { name: "asc" },
  });

  return jsonOk({ campuses });
});
