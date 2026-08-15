"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { signIn } from "@/lib/auth/client";

/**
 * Maps a Better Auth error code to something a student can act on.
 *
 * `INVALID_ORIGIN` means this deployment's `BETTER_AUTH_URL` does not match the
 * host it is served from — no password will ever work until that is fixed, so
 * say so rather than blaming the credentials.
 */
function describeSignInError(code: string | undefined): string {
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address before signing in.";
    case "INVALID_ORIGIN":
      return "This site is misconfigured and cannot sign you in. Please contact support.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return "Those credentials are not correct.";
  }
}

/** Email + password sign-in. Sessions are issued and validated by Better Auth. */

export default function SignInPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await signIn.email({ email: form.email, password: form.password });

    if (result.error) {
      // Branch on the error code, never the status: Better Auth also answers 403
      // for an untrusted origin, which is a deployment fault, not a user one.
      setMessage(describeSignInError(result.error.code));
      setSubmitting(false);
      return;
    }


    // The server decides where each role belongs; this route redirects onward.
    router.push("/after-sign-in");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to Campus Mart.</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field id="email" label="Email address">
            <Input
              type="email"
              value={form.email}
              onChange={update("email")}
              autoComplete="email"
              inputMode="email"
              required
            />
          </Field>

          <Field id="password" label="Password">
            <Input
              type="password"
              value={form.password}
              onChange={update("password")}
              autoComplete="current-password"
              required
            />
          </Field>

          {message ? (
            <p role="alert" className="text-sm text-red-600">
              {message}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <p className="text-sm opacity-70">
            New to Campus Mart?{" "}
            <Link className="underline" href="/sign-up">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
