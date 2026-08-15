"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiGet, apiPost, fieldErrors } from "@/lib/api/client";

type Campus = { id: string; code: string; name: string; city: string };

/**
 * Student registration (PRD §13). Campus selection is validated server-side;
 * the role is assigned by the server and is not part of this form.
 */
export default function SignUpPage() {
  const router = useRouter();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", campusId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ campuses: Campus[] }>("/api/campuses")
      .then((data) => {
        if (active) setCampuses(data.campuses);
      })
      .catch(() => {
        if (active) setMessage("Campuses could not be loaded. Refresh to try again.");
      });
    return () => {
      active = false;
    };
  }, []);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setMessage(null);

    try {
      await apiPost("/api/students/register", form);
      router.push(`/verify-email?email=${encodeURIComponent(form.email)}`);
    } catch (error) {
      setErrors(fieldErrors(error));
      setMessage(
        error instanceof ApiClientError ? error.message : "Registration failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your Campus Mart account</CardTitle>
        <CardDescription>
          Register with any email address. Your campus admin verifies your student details after
          you confirm your email.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field id="name" label="Full name" error={errors.name}>
            <Input
              value={form.name}
              onChange={update("name")}
              autoComplete="name"
              required
            />
          </Field>

          <Field id="email" label="Email address" error={errors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={update("email")}
              autoComplete="email"
              inputMode="email"
              required
            />
          </Field>

          <Field
            id="password"
            label="Password"
            hint="At least 10 characters, with upper case, lower case and a number."
            error={errors.password}
          >
            <Input
              type="password"
              value={form.password}
              onChange={update("password")}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field id="campusId" label="Campus" error={errors.campusId}>
            <select
              value={form.campusId}
              onChange={update("campusId")}
              required
              className="h-11 w-full rounded-xl border border-current/15 bg-transparent px-3 text-base"
            >
              <option value="">Select your campus</option>
              {campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name} ({campus.code})
                </option>
              ))}
            </select>
          </Field>

          {message ? (
            <p role="alert" className="text-sm text-red-600">
              {message}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating account…" : "Create account"}
          </Button>

          <p className="text-sm opacity-70">
            Already registered?{" "}
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
