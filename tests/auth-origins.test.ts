import { describe, expect, it } from "vitest";

import { resolveBaseUrl, resolveTrustedOrigins } from "@/lib/auth/origins";

/**
 * Regression cover for a real outage: the first Vercel deployment inherited
 * `BETTER_AUTH_URL=http://localhost:3000`, so Better Auth answered every
 * sign-in with 403 `INVALID_ORIGIN` while the UI blamed the user's email
 * verification. The base URL must follow the host the app is actually served
 * from unless an operator overrides it.
 */
describe("resolveBaseUrl", () => {
  it("prefers an explicit BETTER_AUTH_URL and drops a trailing slash", () => {
    expect(
      resolveBaseUrl({
        BETTER_AUTH_URL: "https://campusmart.ng/",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://campusmart.ng");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when BETTER_AUTH_URL is unset", () => {
    expect(resolveBaseUrl({ NEXT_PUBLIC_APP_URL: "https://campusmart.ng" })).toBe(
      "https://campusmart.ng",
    );
  });

  it("uses the Vercel production host rather than localhost", () => {
    expect(resolveBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "campus-mart.vercel.app" })).toBe(
      "https://campus-mart.vercel.app",
    );
  });

  it("uses the per-deployment host when only VERCEL_URL is present", () => {
    expect(resolveBaseUrl({ VERCEL_URL: "campus-mart-abc123.vercel.app" })).toBe(
      "https://campus-mart-abc123.vercel.app",
    );
  });

  it("only falls back to localhost when nothing else is known", () => {
    expect(resolveBaseUrl({})).toBe("http://localhost:3000");
  });
});

describe("resolveTrustedOrigins", () => {
  it("trusts the base URL and every hostname of this deployment", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://campusmart.ng",
      VERCEL_URL: "campus-mart-abc123.vercel.app",
      VERCEL_BRANCH_URL: "campus-mart-git-main.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "campus-mart.vercel.app",
    });

    expect(origins).toEqual([
      "https://campusmart.ng",
      "https://campus-mart-abc123.vercel.app",
      "https://campus-mart-git-main.vercel.app",
      "https://campus-mart.vercel.app",
    ]);
  });

  it("never trusts a wildcard host", () => {
    const origins = resolveTrustedOrigins({ VERCEL_URL: "campus-mart-abc123.vercel.app" });
    expect(origins.some((origin) => origin.includes("*"))).toBe(false);
  });

  it("de-duplicates when the base URL is also the Vercel host", () => {
    expect(
      resolveTrustedOrigins({
        NEXT_PUBLIC_APP_URL: "https://campus-mart.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "campus-mart.vercel.app",
      }),
    ).toEqual(["https://campus-mart.vercel.app"]);
  });
});
