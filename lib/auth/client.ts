"use client";

import { createAuthClient } from "better-auth/react";

import { publicEnv } from "@/lib/env";

/**
 * Browser-side auth client. Exposes sign-in/sign-up/session helpers only —
 * authorization decisions are always made on the server.
 */
export const authClient = createAuthClient({
  baseURL: publicEnv.appUrl,
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


