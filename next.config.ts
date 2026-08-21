import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

/**
 * Phase 13 moved the header list into `lib/security/headers.ts` and left this file
 * as the wiring. The policy is now a pure function, which means it can be asserted
 * in a test — a header that quietly stops being sent is the usual way this work
 * turns out to have been undone, and `tests/security-headers.test.ts` is what
 * notices.
 *
 * The development flag is read here rather than inside the policy so that the
 * function stays pure and testable in both shapes. `NODE_ENV` is Next's own signal
 * and is set by `next dev`/`next build`, so it does not go through `lib/env.ts`.
 */
const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions body limit kept small; document uploads go through
    // dedicated upload routes (Cloudflare R2) rather than server actions.
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ development: isDevelopment }),
      },
    ];
  },
};

export default nextConfig;
