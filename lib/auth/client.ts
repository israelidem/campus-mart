"use client";

import { createAuthClient } from "better-auth/react";

import { publicEnv } from "@/lib/env";

/**
 * Browser-side auth client. Exposes sign-in/sign-up/session helpers only —
 * authorization decisions are always made on the server.
 *
 * In the browser the current origin is used, so a deployment whose
 * `NEXT_PUBLIC_APP_URL` is stale still talks to itself instead of posting
 * credentials at another host. `publicEnv.appUrl` is only the server-render
 * fallback, where there is no `window`.
 */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? publicEnv.appUrl : window.location.origin,
});


export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient;


