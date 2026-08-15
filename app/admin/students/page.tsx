import { redirect } from "next/navigation";

import { StudentReviewList, type ReviewableStudent } from "@/components/admin/student-review-list";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listStudentsForReview } from "@/lib/students/student-service";

/**
 * Campus Admin student verification queue (PRD §14).
 *
 * The campus is taken from the authenticated admin, so this page can only ever
 * show the admin's own campus (Rule 25).
 */
export default async function AdminStudentsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN") redirect("/after-sign-in");

  const [campus, pending] = await Promise.all([
    actor.campusId
      ? prisma.campus.findUnique({
          where: { id: actor.campusId },
          select: { name: true, code: true },
        })
      : null,
    listStudentsForReview(actor, { status: "PENDING_VERIFICATION" }),
  ]);

  const students: ReviewableStudent[] = pending.map((student) => ({
    id: student.id,
    name: student.name,
    email: student.email,
    matricNumber: student.matricNumber,
    studentIdNumber: student.studentIdNumber,
    department: student.department,
    level: student.level,
    registryMatched: student.registryMatched,
    submittedAt: student.submittedAt?.toISOString() ?? null,
    documents: student.documents,
  }));

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Student verification</h1>
        <p className="text-sm opacity-70">
          {campus ? `${campus.name} (${campus.code})` : "Your campus"} ·{" "}
          {students.length === 1 ? "1 submission" : `${students.length} submissions`} awaiting review
        </p>
      </header>

      <StudentReviewList students={students} />
    </section>
  );
}
