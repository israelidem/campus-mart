import { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The single Prisma Client for the application.
 *
 * Prisma 7 requires a driver adapter; Postgres uses `pg`. The instance is
 * cached on `globalThis` in development so Next.js hot reloading does not open
 * a new connection pool on every recompile.
 */
declare global {
  var __campusMartPrisma: PrismaClient | undefined;
}


function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot create the Prisma client");
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalThis.__campusMartPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__campusMartPrisma = prisma;
}

/** Transaction client type, for functions that must run inside a transaction. */
export type PrismaTransactionClient = Prisma.TransactionClient;


