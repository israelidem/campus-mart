import "dotenv/config";

import { auth } from "@/lib/auth/auth";
import { ensureSuperAdmin, isBootstrapSuperAdmin } from "@/lib/auth/bootstrap";
import { createCampus } from "@/lib/campus/campus-service";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { createCampusSchema } from "@/validations/campus";

/**
 * Platform bootstrap seed.
 *
 * Campus Mart has a deliberate chicken-and-egg at first launch: a student can
 * only register into an existing campus, campuses can only be created by the
 * Super Admin, and the Super Admin is only granted to an allowlisted email that
 * has already verified itself (PRD §9). Email delivery is not wired up in the
 * MVP (PRD §53), so nobody can click a verification link either.
 *
 * This script resolves that once, on purpose, and only for the platform owner:
 *
 *  1. Creates the owner's account through Better Auth, so the password is hashed
 *     exactly as a normal sign-up would hash it.
 *  2. Marks that one email as verified, standing in for the verification email.
 *  3. Promotes it through `ensureSuperAdmin` — the same audited code path a
 *     sign-in would use, so the promotion appears in the audit log.
 *  4. Creates the first campus through `createCampus`, as that Super Admin.
 *
 * Everything after this happens through the UI. Re-running is safe: each step
 * checks for what it would create.
 *
 * Usage:
 *   set SEED_SUPER_ADMIN_PASSWORD=<a strong password>   (PowerShell: $env:...)
 *   npm run db:seed
 */

const OWNER_NAME = process.env["SEED_SUPER_ADMIN_NAME"] ?? "Platform Owner";

/** ABUAD is the pilot campus (PRD Phase 16); override through the environment. */
const CAMPUS_INPUT = createCampusSchema.parse({
  code: process.env["SEED_CAMPUS_CODE"] ?? "ABUAD",
  name: process.env["SEED_CAMPUS_NAME"] ?? "Afe Babalola University, Ado-Ekiti",
  city: process.env["SEED_CAMPUS_CITY"] ?? "Ado-Ekiti",
  state: process.env["SEED_CAMPUS_STATE"] ?? "Ekiti",
  country: "Nigeria",
  // Approximate campus centre; the delivery engine (Phase 5) prices from it.
  latitude: Number(process.env["SEED_CAMPUS_LATITUDE"] ?? 7.6113),
  longitude: Number(process.env["SEED_CAMPUS_LONGITUDE"] ?? 5.2647),
  timezone: "Africa/Lagos",
});

function ownerEmail(): string {
  const first = env()
    .SUPER_ADMIN_EMAILS.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)[0];

  if (!first) {
    throw new Error("SUPER_ADMIN_EMAILS is empty — set the platform owner's email in .env first");
  }
  return first;
}

/** The value shipped in `.env.example`; refusing it prevents a known password. */
const PLACEHOLDER_PASSWORD = "replace-with-a-strong-password";

function ownerPassword(): string {
  const password = process.env["SEED_SUPER_ADMIN_PASSWORD"];
  if (password === PLACEHOLDER_PASSWORD) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD is still the placeholder — set a real password");
  }
  if (!password || password.length < 10) {

    throw new Error(
      "Set SEED_SUPER_ADMIN_PASSWORD to at least 10 characters before running the seed. " +
        "It is only used to create the owner account; it is never stored in plain text.",
    );
  }
  return password;
}

/** Creates the owner's account if it does not exist, and returns its id. */
async function ensureOwnerAccount(email: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const result = await auth.api.signUpEmail({
    body: { name: OWNER_NAME, email, password: ownerPassword() },
    asResponse: false,
  });

  return { id: result.user.id, created: true };
}

async function main(): Promise<void> {
  const email = ownerEmail();
  if (!isBootstrapSuperAdmin(email)) {
    // Defensive: ownerEmail() reads the same allowlist, so this cannot normally fire.
    throw new Error(`${email} is not on the SUPER_ADMIN_EMAILS allowlist`);
  }

  const owner = await ensureOwnerAccount(email);
  console.log(`${owner.created ? "Created" : "Found"} owner account ${email}`);

  // Stands in for clicking the verification link, which no mail provider can
  // deliver yet. Only ever applied to the allowlisted owner address.
  const verified = await prisma.user.update({
    where: { id: owner.id },
    data: { emailVerified: true },
    select: { id: true, email: true, role: true, campusId: true, emailVerified: true },
  });

  const actorRole = await ensureSuperAdmin(verified);
  if (actorRole.role !== "SUPER_ADMIN") {
    throw new Error("Super Admin promotion did not apply — check SUPER_ADMIN_EMAILS");
  }
  console.log("Owner holds SUPER_ADMIN");

  const actor = {
    userId: verified.id,
    email: verified.email,
    name: OWNER_NAME,
    role: "SUPER_ADMIN" as const,
    campusId: null,
    emailVerified: true,
    isSuspended: false,
  };

  const existingCampus = await prisma.campus.findUnique({
    where: { code: CAMPUS_INPUT.code },
    select: { id: true, code: true },
  });

  if (existingCampus) {
    console.log(`Campus ${existingCampus.code} already exists`);
  } else {
    const campus = await createCampus(actor, CAMPUS_INPUT);
    console.log(`Created campus ${campus.code} (${campus.name}) with default settings`);
  }

  console.log("\nSeed complete. Sign in at /sign-in with the owner email and seeded password.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
