import { Suspense } from "react";
import type { Metadata } from "next";

import { SignInForm, SignInReasonNotice } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to shop your campus marketplace.",
};

/**
 * Sign in.
 *
 * A server component so the shell prerenders. The interactive parts live in
 * `components/auth/sign-in-form.tsx`, and the one piece that reads the query
 * string (`?reason=session-expired`) is wrapped in Suspense on its own.
 *
 * Without that boundary `next build` fails with a prerender error on this route:
 * `useSearchParams` cannot be resolved at build time, and Next treats that as
 * fatal during export rather than degrading to a runtime render. The boundary is
 * scoped to the notice alone so the form itself is still server-rendered HTML —
 * suspending the whole page would mean shipping a blank panel to every visitor
 * for the sake of a banner that almost none of them will see.
 */
export default function SignInPage() {
  return (
    <div>
      <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.015em] text-ink">
        Welcome back
      </h1>
      <p className="mt-2 text-[0.9375rem] text-ink-2">
        Sign in to shop your campus marketplace.
      </p>

      {/* No fallback: this is a conditional banner, and a placeholder would push
          the form down and then snap it back on hydration. */}
      <Suspense fallback={null}>
        <SignInReasonNotice />
      </Suspense>

      <SignInForm />
    </div>
  );
}
