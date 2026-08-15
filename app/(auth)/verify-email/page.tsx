import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown after registration. Email delivery infrastructure is out of MVP scope
 * (PRD §53), so during development the verification link is written to the
 * server logs instead of being emailed.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your email address</CardTitle>
        <CardDescription>
          {email
            ? `We sent a confirmation link to ${email}.`
            : "We sent you a confirmation link."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm opacity-80">
          <li>Open the link to confirm your email address.</li>
          <li>Sign in and submit your matric number, passport photograph and student ID.</li>
          <li>Your campus admin reviews the submission and approves your account.</li>
        </ol>

        <p className="text-sm opacity-70">
          Already confirmed?{" "}
          <Link className="underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
