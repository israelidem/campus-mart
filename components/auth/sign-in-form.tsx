"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/state";
import { signIn } from "@/lib/auth/client";

/**
 * Sign-in form, extracted from the page so that the page itself can stay a
 * server component and be prerendered.
 *
 * The split matters: `useSearchParams` opts a route out of static rendering
 * unless it is inside a Suspense boundary, and `next build` fails the export
 * rather than warning. Rather than suspend the whole form — which would flash a
 * fallback where the email field belongs on every visit — only the banner that
 * actually reads the query string is suspended. The form below renders in the
 * prerendered HTML and is interactive as soon as React hydrates.
 *
 * The error mapping is the substance of this component. Better Auth answers with
 * a code, and §14 requires that each one becomes a sentence a student can act
 * on. Two cases matter more than the rest:
 *
 *  • `EMAIL_NOT_VERIFIED` is recoverable, so it gets a link to the verification
 *    screen rather than a dead end.
 *  • `INVALID_ORIGIN` is a deployment fault — `BETTER_AUTH_URL` does not match
 *    the host — and no password will ever work until it is fixed. Reporting it
 *    as "wrong credentials" would send a student to reset a password that was
 *    never wrong, so it is named as a site problem.
 */

type SignInError = { message: string; recoverable?: "verify" | "reset" };

function describeSignInError(code: string | undefined): SignInError {
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return {
        message: "Your email address has not been confirmed yet.",
        recoverable: "verify",
      };
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "INVALID_EMAIL":
      return {
        message: "That email and password combination is not correct.",
        recoverable: "reset",
      };
    case "USER_NOT_FOUND":
      // Deliberately the same sentence as a wrong password: confirming that an
      // address does have an account is an account-enumeration leak.
      return {
        message: "That email and password combination is not correct.",
        recoverable: "reset",
      };
    case "TOO_MANY_REQUESTS":
      return { message: "Too many attempts. Wait a minute and try again." };
    case "INVALID_ORIGIN":
      return {
        message:
          "This site is not configured correctly and cannot sign you in. Please report this to support — it is not a problem with your password.",
      };
    default:
      return { message: "That email and password combination is not correct.", recoverable: "reset" };
  }
}

/**
 * Explains why the visitor is looking at a sign-in form when they asked for
 * something else. Isolated behind its own Suspense boundary because it is the
 * only part of this screen that depends on the URL.
 */
export function SignInReasonNotice() {
  const reason = useSearchParams().get("reason");

  if (reason !== "session-expired") return null;

  return (
    <Notice tone="info" className="mt-5" title="Your session ended">
      Sign in again to pick up where you left off.
    </Notice>
  );
}

export function SignInForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<SignInError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // Guards a double-tap on a slow connection.

    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn.email({
        email: form.email.trim(),
        password: form.password,
      });

      if (result.error) {
        // Branch on the code, never the status: Better Auth also answers 403 for
        // an untrusted origin, which is a deployment fault, not a user one.
        setError(describeSignInError(result.error.code));
        setSubmitting(false);
        return;
      }

      // The server decides where each role belongs; this route redirects onward.
      // `submitting` is intentionally left true so the button stays disabled
      // through the navigation instead of flicking back to "Sign in".
      router.push("/after-sign-in");
    } catch {
      // `signIn.email` rejects rather than returning an error object when the
      // request never arrives. An unhandled rejection here is exactly the "did
      // the button work?" silence §14 forbids.
      setError({
        message: "We could not reach Campus Mart. Check your connection and try again.",
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <form className="mt-7 space-y-4" onSubmit={onSubmit} noValidate>
        <Field id="email" label="Email address">
          <Input
            type="email"
            value={form.email}
            onChange={update("email")}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field id="password" label="Password">
          <PasswordInput
            value={form.password}
            onChange={update("password")}
            autoComplete="current-password"
            placeholder="Your password"
            required
          />
        </Field>

        <div className="flex justify-end">
          <Link
            href="/verify-email"
            className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Need to verify your email?
          </Link>
        </div>

        {error ? (
          <Notice tone="danger" title="Could not sign you in">
            {error.message}
            {error.recoverable === "verify" ? (
              <>
                {" "}
                <Link href="/verify-email" className="font-medium underline underline-offset-4">
                  Resend the verification email
                </Link>
                .
              </>
            ) : null}
          </Notice>
        ) : null}

        <Button type="submit" block size="lg" isLoading={submitting} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-2">
        New to Campus Mart?{" "}
        <Link href="/sign-up" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
