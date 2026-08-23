import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/students/onboarding-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/state";
import { getActor } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/students/student-service";
import { cn } from "@/lib/utils";

/**
 * Student verification screen (PRD §13–14).
 *
 * The state shown here is read on the server from the database, so the page can
 * never present a more permissive status than the student actually has.
 *
 * It is now also reachable from the account menu as "Verification", which is why
 * the approved case says what was approved instead of only offering a link out:
 * a student who opens this deliberately is asking about their standing, not
 * looking for the marketplace.
 */

type StepState = "done" | "current" | "todo";

/**
 * The §15 progress spine.
 *
 * Registration is three things a student cannot do in one sitting — create an
 * account, confirm an email, wait for a human to check a matric number — and the
 * screen previously showed only the third. A student who had just uploaded a
 * document had no way to tell whether anything had been received. Showing the
 * completed steps is the difference between "waiting" and "stuck".
 */
function Step({
  state,
  title,
  description,
}: {
  state: StepState;
  title: string;
  description?: string;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          state === "done" && "border-success bg-success text-white",
          state === "current" && "border-brand-600 bg-brand-50 text-brand-700",
          state === "todo" && "border-rule bg-sunken text-ink-3",
        )}
      >
        {state === "done" ? "✓" : state === "current" ? "●" : ""}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            state === "todo" ? "text-ink-3" : "text-ink",
          )}
        >
          {title}
          <span className="sr-only">
            {state === "done" ? " — complete" : state === "current" ? " — in progress" : " — not started"}
          </span>
        </p>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
    </li>
  );
}

function Progress({
  emailVerified,
  submitted,
  reviewed,
}: {
  emailVerified: boolean;
  submitted: boolean;
  reviewed: StepState;
}) {
  return (
    <ol className="space-y-4">
      <Step state="done" title="Account created" />
      <Step
        state={emailVerified ? "done" : "current"}
        title="Email confirmed"
        description={emailVerified ? undefined : "Open the link we sent you."}
      />
      <Step
        state={submitted ? "done" : emailVerified ? "current" : "todo"}
        title="Student details submitted"
      />
      <Step
        state={reviewed}
        title="Campus verification"
        description={
          reviewed === "current"
            ? "Your campus administration is checking your details against the official student registry."
            : undefined
        }
      />
    </ol>
  );
}

/**
 * Day precision, deliberately.
 *
 * This renders on the server, which on Vercel means UTC — a timestamp would have
 * shown a Lagos student the wrong clock time. The campus timezone is not part of
 * this query and adding a join for one label is not worth it, so the label is
 * reduced to the precision that is true in any timezone.
 */
function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function StudentOnboardingPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "STUDENT") redirect("/after-sign-in");

  const state = await getOnboardingState(actor);

  if (!state.emailVerified) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold text-ink">You&rsquo;re almost there</h1>
          <p className="text-muted">
            Confirm your email address to carry on. We sent a link to{" "}
            <span className="font-medium text-ink">{actor.email}</span>.
          </p>
        </header>

        <Card>
          <Progress emailVerified={false} submitted={false} reviewed="todo" />
        </Card>

        {/*
         * This links to instructions, and says so.
         *
         * "Resend" was the obvious label and would have been a lie: email
         * delivery is out of MVP scope (PRD §53), and no resend endpoint exists.
         * A button that looks like it works and doesn't is the specific failure
         * §28 forbids, so the label describes where it actually goes.
         */}
        <ButtonLink href={`/verify-email?email=${encodeURIComponent(actor.email)}`} variant="secondary" block>
          What to do next
        </ButtonLink>
      </div>
    );
  }

  if (state.status === "PENDING_VERIFICATION") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold text-ink">You&rsquo;re almost there</h1>
          <p className="text-muted">
            Everything we need has been submitted to your campus administration for verification.
            You&rsquo;ll be able to shop as soon as it&rsquo;s approved.
          </p>
        </header>

        <Card>
          <Progress emailVerified submitted reviewed="current" />
        </Card>

        <Card className="space-y-3">
          <CardTitle>What you submitted</CardTitle>
          <dl className="divide-y divide-rule text-sm">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Matric number</dt>
              <dd className="font-mono text-ink">{state.matricNumber ?? "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Submitted</dt>
              <dd className="text-ink">
                {state.submittedAt ? formatDay(state.submittedAt) : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Documents</dt>
              <dd className="text-ink">
                {state.documents.length}{" "}
                {state.documents.length === 1 ? "file" : "files"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Registry match</dt>
              <dd>
                {/*
                 * "Not found" alarmed students who had done nothing wrong: many
                 * campuses upload their registry after students start signing up,
                 * and an admin can approve either way. It now says what it means
                 * for the student rather than reporting an internal flag.
                 */}
                {state.registryMatched ? (
                  <Badge tone="success">Found</Badge>
                ) : (
                  <Badge tone="neutral">Manual check</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        <p className="text-center text-sm text-muted">
          Verification is done by people, not instantly. You don&rsquo;t need to do anything else.
        </p>
      </div>
    );
  }

  if (state.status === "APPROVED") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold text-ink">You&rsquo;re verified</h1>
            <Badge tone="success">Approved</Badge>
          </div>
          <p className="text-muted">
            Your campus administration approved this account. You can buy, and you can apply to sell
            or to deliver.
          </p>
        </header>

        <Card className="space-y-3">
          <CardTitle>Your student record</CardTitle>
          <dl className="divide-y divide-rule text-sm">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Matric number</dt>
              <dd className="font-mono text-ink">{state.matricNumber ?? "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Department</dt>
              <dd className="text-ink">{state.department ?? "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted">Level</dt>
              <dd className="font-mono text-ink">{state.level ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <ButtonLink href="/marketplace" block>
          Go to the marketplace
        </ButtonLink>
      </div>
    );
  }

  if (state.status === "SUSPENDED") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold text-ink">Account suspended</h1>
            <Badge tone="danger">Suspended</Badge>
          </div>
          <p className="text-muted">
            Your campus administration has suspended this account, so you can&rsquo;t shop or sell
            right now.
          </p>
        </header>

        {state.reviewNote ? (
          <Notice tone="danger" title="Reason given">
            {state.reviewNote}
          </Notice>
        ) : null}

        <Card className="text-sm text-muted">
          Contact your campus administration to sort this out. They can lift a suspension; nobody
          else can.
        </Card>
      </div>
    );
  }

  const needsCorrection = state.status === "CORRECTION_REQUESTED" || state.status === "REJECTED";

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">
          {needsCorrection ? "Fix your student details" : "Verify your student details"}
        </h1>
        <CardDescription>
          Your campus administration checks these against the official student registry. Your
          documents are private — only you and your campus administration can open them.
        </CardDescription>
      </header>

      {needsCorrection ? (
        <Notice
          tone="warning"
          title={
            state.status === "REJECTED"
              ? "This submission was rejected"
              : "Your campus administration needs a correction"
          }
        >
          {state.reviewNote ??
            "No note was left. Check that your matric number and documents match your ID exactly."}
        </Notice>
      ) : null}

      {!needsCorrection ? (
        <Card>
          <Progress emailVerified submitted={false} reviewed="todo" />
        </Card>
      ) : null}

      <Card>
        <OnboardingForm
          initial={{
            matricNumber: state.matricNumber ?? "",
            studentIdNumber: state.studentIdNumber ?? "",
            department: state.department ?? "",
            level: state.level ?? "",
          }}
        />
      </Card>
    </div>
  );
}
