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
 * ── Why `script-src` also allows inline ────────────────────────────────────
 *
 * This previously read `script-src 'self'` in production, on the reasoning that
 * Next.js's own bootstrap scripts are hashed or nonced by the framework. That
 * assumption was wrong, and it broke the application in production while every
 * local `next dev` session looked fine.
 *
 * The App Router emits inline `<script>` tags with **no nonce and no hash**: the
 * bootstrap tag, and the `self.__next_f.push(...)` tags carrying the React
 * Server Component flight payload. Under `script-src 'self'` the browser refuses
 * them, the payload never arrives, and React never hydrates. The page still
 * *looks* right, because `style-src` permits the CSS — so the failure is
 * invisible until you interact with it. Every `onSubmit` and `onClick` is dead,
 * and a submit button falls back to a native form submission that reloads the
 * page. That is exactly how sign-in "just refreshed" instead of signing in.
 *
 * Next.js supports two ways to keep this directive strict, and both cost more
 * than they return here:
 *
 *  1. **A per-request nonce from middleware.** Next stamps the nonce it finds in
 *     the request's CSP header onto its inline scripts. A nonce is unique per
 *     response by definition, so every page becomes dynamically rendered: the
 *     landing page's ISR and the prerendered auth screens are all forfeited, and
 *     any cached HTML would serve a stale nonce and fail exactly like this bug.
 *  2. **Hashing the inline scripts.** Their contents include per-build chunk ids
 *     and per-page flight data, so the hashes change on every build and every
 *     route. There is nothing stable to pin.
 *
 * So inline script is permitted, and the policy keeps its remaining teeth:
 * `default-src 'self'` still blocks foreign script *sources*, `object-src 'none'`
 * and `base-uri 'self'` close the classic injection vectors, `frame-ancestors
 * 'none'` blocks clickjacking, and `connect-src` still names every origin this
 * app may talk to. The honest summary is that this header now constrains where
 * script may come from, not whether inline script may run — and this project's
 * real XSS defence is React escaping output plus Zod validating input at every
 * route boundary.
 *
 * `'unsafe-eval'` stays development-only, because Turbopack's HMR client needs it
 * and that convenience must not ship.
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
    // See the note above before tightening this: `'unsafe-inline'` is what keeps
    // React hydrating in production. Removing it does not raise an error — it
    // silently kills every client-side interaction in the app.
    "script-src": development
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", "'unsafe-inline'"],
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
