/**
 * Security response headers (Phase 13).
 *
 * Pure functions returning header pairs, so `next.config.ts` stays a list and the
 * policy itself can be asserted in a test. A header that is silently missing in
 * production is the most common way this kind of work is "done".
 *
 * Two of these carry real risk of breaking the product, and both are handled
 * explicitly rather than being weakened until nothing complains:
 *
 * - **Paystack.** Checkout is a full-page redirect (`window.location.assign`),
 *   not an inline modal, so no Paystack script runs on our origin. `connect-src`
 *   and `form-action` still name it, because the redirect and the callback are
 *   ours to allow. If the inline modal is ever adopted, `script-src` must gain
 *   `https://js.paystack.co` — a CSP that breaks payments is worse than none.
 * - **The service worker.** It is same-origin (`/sw.js`) and needs `worker-src
 *   'self'`; push notifications need nothing from CSP because they are not
 *   fetched.
 */

export type HeaderPair = { key: string; value: string };

const PAYSTACK_ORIGINS = ["https://api.paystack.co", "https://checkout.paystack.com"] as const;

/**
 * The Content-Security-Policy.
 *
 * `'unsafe-inline'` appears in `style-src` and nowhere else. Next.js injects
 * inline styles for its own font and layout handling, and Tailwind's utilities
 * are compiled into a stylesheet; a nonce-per-request scheme for styles would
 * mean giving up static rendering for a class of injection that cannot execute.
 *
 * `script-src` deliberately does **not** carry `'unsafe-inline'` in production.
 * Next.js's own bootstrap scripts are hashed or nonced by the framework, and
 * leaving inline script open would make the whole policy decorative — the header
 * exists to stop injected script, and that is the directive that stops it.
 *
 * In development, `'unsafe-eval'` is allowed because Turbopack's HMR client needs
 * it. It is gated on the flag rather than always-on for the usual reason: the
 * development convenience must not ship.
 */
export function contentSecurityPolicy(options?: { development?: boolean }): string {
  const development = options?.development ?? false;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    // No <object>/<embed>: they are a plugin surface with no use here.
    "object-src": ["'none'"],
    // Nothing on the platform should ever be framed by another site, and this is
    // the modern replacement for X-Frame-Options.
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'", ...PAYSTACK_ORIGINS],
    "frame-src": ["'self'", ...PAYSTACK_ORIGINS],
    "script-src": development ? ["'self'", "'unsafe-eval'", "'unsafe-inline'"] : ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    // `data:` covers the inline SVG icons; `blob:` covers a preview of a file the
    // user has just chosen, before it is uploaded.
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": development
      ? ["'self'", "ws:", "wss:", ...PAYSTACK_ORIGINS]
      : ["'self'", ...PAYSTACK_ORIGINS],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
  };

  const serialised = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  // Only in production: forcing HTTPS sub-resources on http://localhost breaks
  // the dev server outright.
  return development ? serialised : `${serialised}; upgrade-insecure-requests`;
}

/**
 * Headers applied to every response.
 *
 * `Strict-Transport-Security` is production-only. Sent on a localhost response it
 * would pin the developer's browser to HTTPS for `localhost` — for two years,
 * across every project on the machine.
 *
 * `X-Frame-Options` is kept alongside `frame-ancestors` for older browsers that
 * do not implement the CSP directive. It is redundant, not conflicting.
 */
export function securityHeaders(options?: { development?: boolean }): HeaderPair[] {
  const development = options?.development ?? false;

  const headers: HeaderPair[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ development }) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // Camera for document capture, geolocation for the delivery flow. Everything
      // else is denied by naming it: an unnamed feature is allowed by default.
      value: [
        "camera=(self)",
        "geolocation=(self)",
        "microphone=()",
        "payment=()",
        "usb=()",
        "bluetooth=()",
        "serial=()",
        "midi=()",
        "magnetometer=()",
        "gyroscope=()",
        "accelerometer=()",
        "interest-cohort=()",
      ].join(", "),
    },
    // Isolates this origin's browsing-context group from cross-origin openers.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];

  if (!development) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

/**
 * Headers for a response carrying a private file (documents, product images).
 *
 * `no-store` rather than a short `max-age`: a shared cache holding a student's ID
 * card is exactly the outcome private storage exists to prevent. Product images
 * pay a real performance cost for this, which is Phase 14's problem to solve with
 * signed URLs — not this phase's to solve by weakening the header.
 */
export function privateFileHeaders(input: {
  contentType: string;
  contentLength: number;
  disposition: "inline" | "attachment";
  filename?: string;
}): Record<string, string> {
  return {
    "Content-Type": input.contentType,
    "Content-Length": String(input.contentLength),
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": input.filename
      ? `${input.disposition}; filename="${sanitiseFilename(input.filename)}"`
      : input.disposition,
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * A filename safe to put in a header.
 *
 * Quotes and newlines are removed, not escaped: a newline in a header value is a
 * response-splitting attempt, and there is no legitimate filename that needs one.
 */
export function sanitiseFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "download";
}
