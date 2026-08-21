import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  privateFileHeaders,
  sanitiseFilename,
  securityHeaders,
} from "@/lib/security/headers";

/**
 * Security headers (Phase 13).
 *
 * Headers are the easiest security work to *appear* to have done: they are a list of
 * strings in a config file, nothing breaks when one is dropped, and nothing tells
 * you. That is the whole reason the policy is a function and this file exists.
 *
 * Two assertions here are about not breaking the product rather than about attacks —
 * Paystack must remain reachable, and the service worker must still be allowed —
 * because a CSP that breaks payments will be deleted by whoever is on call, and then
 * there is no CSP at all.
 */

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

  return found ?? "";
}

describe("content security policy", () => {
  const production = contentSecurityPolicy();
  const development = contentSecurityPolicy({ development: true });

  it("defaults to self and denies plugins and framing outright", () => {
    expect(directive(production, "default-src")).toBe("default-src 'self'");
    expect(directive(production, "object-src")).toBe("object-src 'none'");
    expect(directive(production, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(production, "base-uri")).toBe("base-uri 'self'");
  });

  it("never allows inline or eval script in production", () => {
    // This is the directive the whole header exists for. With `'unsafe-inline'`
    // here, an injected <script> runs and the rest of the policy is decoration.
    const scriptSrc = directive(production, "script-src");

    expect(scriptSrc).toBe("script-src 'self'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("allows eval only in development, for Turbopack's HMR client", () => {
    expect(directive(development, "script-src")).toContain("'unsafe-eval'");
  });

  it("allows inline styles, which Next.js and Tailwind require", () => {
    // Accepted deliberately: injected CSS cannot execute, and a nonce-per-request
    // scheme for styles would mean giving up static rendering.
    expect(directive(production, "style-src")).toContain("'unsafe-inline'");
  });

  it("keeps Paystack reachable for checkout and its callback", () => {
    // A CSP that breaks payments is worse than none, because it will be removed.
    expect(directive(production, "form-action")).toContain("https://checkout.paystack.com");
    expect(directive(production, "connect-src")).toContain("https://api.paystack.co");
    expect(directive(production, "frame-src")).toContain("https://checkout.paystack.com");
  });

  it("allows the same-origin service worker the PWA installs", () => {
    expect(directive(production, "worker-src")).toBe("worker-src 'self'");
    expect(directive(production, "manifest-src")).toBe("manifest-src 'self'");
  });

  it("allows data: and blob: images for inline icons and pre-upload previews", () => {
    const imgSrc = directive(production, "img-src");

    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
  });

  it("allows websockets in development only, so HMR works without shipping it", () => {
    expect(directive(development, "connect-src")).toContain("ws:");
    expect(directive(production, "connect-src")).not.toContain("ws:");
  });

  it("upgrades insecure requests in production but not on localhost", () => {
    // On http://localhost this directive breaks the dev server outright.
    expect(production).toContain("upgrade-insecure-requests");
    expect(development).not.toContain("upgrade-insecure-requests");
  });
});

describe("response headers", () => {
  const production = securityHeaders();
  const development = securityHeaders({ development: true });

  function valueOf(headers: { key: string; value: string }[], key: string): string | undefined {
    return headers.find((header) => header.key === key)?.value;
  }

  it("sends the whole set on every response", () => {
    for (const key of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
    ]) {
      expect(valueOf(production, key), key).toBeDefined();
    }
  });

  it("forbids MIME sniffing, which is what makes the upload policy hold at the browser", () => {
    expect(valueOf(production, "X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends HSTS in production only", () => {
    // Sent from localhost it would pin the developer's browser to HTTPS for
    // `localhost`, for two years, across every project on the machine.
    expect(valueOf(production, "Strict-Transport-Security")).toContain("max-age=63072000");
    expect(valueOf(development, "Strict-Transport-Security")).toBeUndefined();
  });

  it("denies powerful features by naming them, since an unnamed feature is allowed", () => {
    const permissions = valueOf(production, "Permissions-Policy") ?? "";

    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("geolocation=(self)");
    expect(permissions).toContain("microphone=()");
    expect(permissions).toContain("usb=()");
  });

  it("does not leak a full URL to another origin in the referrer", () => {
    expect(valueOf(production, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps X-Frame-Options alongside frame-ancestors for older browsers", () => {
    expect(valueOf(production, "X-Frame-Options")).toBe("DENY");
    expect(valueOf(production, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});

describe("private file headers", () => {
  it("refuses to let a private file be cached anywhere", () => {
    const headers = privateFileHeaders({
      contentType: "image/jpeg",
      contentLength: 1024,
      disposition: "inline",
    });

    // A shared cache holding a student's ID card is precisely what private storage
    // exists to prevent, so `no-store` rather than a short max-age.
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Cache-Control"]).toContain("private");
  });

  it("repeats nosniff on the file response itself", () => {
    const headers = privateFileHeaders({
      contentType: "application/pdf",
      contentLength: 2048,
      disposition: "attachment",
    });

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Disposition"]).toBe("attachment");
  });

  it("includes a sanitised filename when one is given", () => {
    const headers = privateFileHeaders({
      contentType: "image/png",
      contentLength: 10,
      disposition: "inline",
      filename: "my id card.png",
    });

    expect(headers["Content-Disposition"]).toBe('inline; filename="my_id_card.png"');
  });
});

describe("filename sanitising", () => {
  it("strips a newline, which in a header value is response splitting", () => {
    const sanitised = sanitiseFilename("photo.png\r\nSet-Cookie: admin=1");

    expect(sanitised).not.toContain("\r");
    expect(sanitised).not.toContain("\n");
  });

  it("strips the quote that would end the header's quoted string early", () => {
    expect(sanitiseFilename('a"b.png')).not.toContain('"');
  });

  it("neutralises path traversal", () => {
    expect(sanitiseFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("caps the length and always returns something usable", () => {
    expect(sanitiseFilename("a".repeat(500)).length).toBe(100);
    expect(sanitiseFilename("")).toBe("download");
    // Every character stripped still has to leave a valid header value.
    expect(sanitiseFilename("///")).toBe("___");
  });
});
