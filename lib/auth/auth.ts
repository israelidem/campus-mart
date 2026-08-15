import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { resolveBaseUrl, resolveTrustedOrigins } from "@/lib/auth/origins";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";


/**
 * Better Auth instance — the only source of authentication truth.
 *
 * Campus Mart deliberately keeps *identity* (accounts, sessions, email
 * verification, password reset) inside Better Auth, while campus membership,
 * roles and profile verification live in the application tables. The `role`
 * and `campusId` fields are mirrored into the session for cheap authorization
 * checks, but they are only ever written by server-side code.
 *
 * Email delivery is intentionally not wired up in the MVP (PRD §53); the
 * verification/reset URLs are logged so they can be used during development
 * and swapped for a provider later without touching call sites.
 */
export const auth = betterAuth({
  appName: "Campus Mart",
  secret: env().BETTER_AUTH_SECRET,
  baseURL: resolveBaseUrl(),
  trustedOrigins: resolveTrustedOrigins(),

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,

    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    autoSignIn: false,
    sendResetPassword: async ({ user, url }) => {
      logger.info("Password reset requested", { userId: user.id, url });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 hours
    sendVerificationEmail: async ({ user, url }) => {
      logger.info("Email verification requested", { userId: user.id, url });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "STUDENT",
        // Never writable from the client: roles change only through
        // audited server-side admin actions.
        input: false,
      },
      campusId: {
        type: "string",
        required: false,
        input: false,
      },
      phone: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },

  advanced: {
    database: {
      generateId: false,
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },

  plugins: [nextCookies()],
});

export type Auth = typeof auth;
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
