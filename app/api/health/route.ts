import { apiHandler, jsonOk } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

/**
 * Liveness/readiness probe. Verifies the process is up and that the database
 * accepts a trivial query. Exposes no configuration details.
 */
export const GET = apiHandler(async () => {
  const startedAt = Date.now();
  let database: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  return jsonOk(
    {
      status: database === "up" ? "healthy" : "degraded",
      database,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: database === "up" ? 200 : 503 },
  );
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
