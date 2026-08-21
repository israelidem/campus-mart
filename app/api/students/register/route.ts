import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { studentSignUpSchema } from "@/validations/student";

/**
 * Student registration (PRD §13).
 *
 * Registration goes through this route rather than Better Auth's sign-up
 * endpoint directly because campus membership and role must be decided by the
 * server: the campus is verified to exist and be active, and the role is always
 * STUDENT regardless of what the client sends.
 *
 * Rate limited by IP from Phase 13. There is no session to key on — that is the
 * whole point of the endpoint — so the address is the only identity available, and
 * five accounts an hour from one address is generous for a real hostel behind one
 * NAT while still making bulk account creation pointless. Unlimited registration is
 * not merely noise: every account is a row, an inbox, and a possible verification
 * email, so it is a way to spend somebody else's money.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  await enforceRateLimit({ action: "STUDENT_REGISTRATION", headers: request.headers });

  const body = studentSignUpSchema.parse(await request.json());

  const campus = await prisma.campus.findUnique({
    where: { id: body.campusId },
    select: { id: true, status: true, code: true },
  });
  if (!campus || campus.status !== "ACTIVE") {
    throw new ValidationError("Select an active campus");
  }

  const existing = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("An account with that email address already exists");
  }

  const created = await auth.api.signUpEmail({
    body: { name: body.name, email: body.email, password: body.password },
    asResponse: false,
  });

  // Role and campus are applied server-side; they are not client-writable.
  await prisma.user.update({
    where: { id: created.user.id },
    data: { role: "STUDENT", campusId: campus.id },
  });

  logger.info("Student registered", { userId: created.user.id, campusId: campus.id });

  return jsonOk(
    {
      userId: created.user.id,
      email: created.user.email,
      campusCode: campus.code,
      emailVerificationRequired: true,
    },
    { status: 201 },
  );
});
