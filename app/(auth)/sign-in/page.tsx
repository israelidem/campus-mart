"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { signIn } from "@/lib/auth/client";

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
      setMessage(
        result.error.status === 403
          ? "Confirm your email address before signing in."
          : "Those credentials are not correct.",
      );
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
