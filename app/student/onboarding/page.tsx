import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/students/onboarding-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/students/student-service";

/**
 * Student verification screen (PRD §13–14).
 *
 * The state shown here is read on the server from the database, so the page can
 * never present a more permissive status than the student actually has.
 */
export default async function StudentOnboardingPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "STUDENT") redirect("/after-sign-in");

  const state = await getOnboardingState(actor);

  if (!state.emailVerified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm your email address first</CardTitle>
          <CardDescription>
            We sent a confirmation link to {actor.email}. Open it, then return here to submit your
            student details.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.status === "PENDING_VERIFICATION") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verification in progress</CardTitle>
          <CardDescription>
            Your campus admin is reviewing your submission. You will be able to shop as soon as it
            is approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="opacity-60">Matric number</dt>
            <dd>{state.matricNumber}</dd>
            <dt className="opacity-60">Submitted</dt>
            <dd>{state.submittedAt?.toLocaleString() ?? "—"}</dd>
            <dt className="opacity-60">Registry match</dt>
            <dd>{state.registryMatched ? "Found" : "Not found"}</dd>
          </dl>
        </CardContent>
      </Card>
    );
  }

  if (state.status === "APPROVED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You are verified</CardTitle>
          <CardDescription>Your account has been approved by your campus admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="underline" href="/marketplace">
            Go to the marketplace
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (state.status === "SUSPENDED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account suspended</CardTitle>
          <CardDescription>
            Contact your campus admin for help with your account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const needsCorrection = state.status === "CORRECTION_REQUESTED" || state.status === "REJECTED";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {needsCorrection ? "Update your student details" : "Verify your student details"}
        </CardTitle>
        <CardDescription>
          Your campus admin checks these details against the official student registry. Documents
          are stored privately and are only visible to you and your campus admin.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {needsCorrection && state.reviewNote ? (
          <p className="rounded-xl border border-current/15 p-3 text-sm">
            <span className="font-medium">Campus admin note: </span>
            {state.reviewNote}
          </p>
        ) : null}

        <OnboardingForm
          initial={{
            matricNumber: state.matricNumber ?? "",
            studentIdNumber: state.studentIdNumber ?? "",
            department: state.department ?? "",
            level: state.level ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
