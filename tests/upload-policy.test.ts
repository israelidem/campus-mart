import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  assertAcceptableUpload,
  contentDispositionFor,
  extensionFor,
  isAllowedUploadType,
  safeContentType,
  sniffUploadType,
} from "@/lib/security/upload-policy";

/**
 * Upload policy (Phase 13, PRD §56).
 *
 * The theme running through these tests is that **the bytes decide**. Almost every
 * upload vulnerability is a system that believed a `Content-Type` header, so the
 * cases that matter are the disagreements: honest bytes with a wrong label, hostile
 * bytes with an honest label, and hostile bytes with a flattering label.
 */

/** A file that really is what it says, padded past the 12-byte sniff minimum. */
function bytesOf(signature: number[], totalLength = 32): Uint8Array {
  const buffer = new Uint8Array(totalLength);
  buffer.set(signature, 0);
  return buffer;
}

const JPEG = bytesOf([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** "RIFF" + 4 size bytes + "WEBP". */
const WEBP = (() => {
  const buffer = new Uint8Array(32);
  buffer.set([0x52, 0x49, 0x46, 0x46], 0);
  buffer.set([0x1a, 0x00, 0x00, 0x00], 4);
  buffer.set([0x57, 0x45, 0x42, 0x50], 8);
  return buffer;
})();

describe("sniffing", () => {
  it("recognises each accepted format from its signature", () => {
    expect(sniffUploadType(JPEG)).toBe("image/jpeg");
    expect(sniffUploadType(PNG)).toBe("image/png");
    expect(sniffUploadType(WEBP)).toBe("image/webp");
    expect(sniffUploadType(PDF)).toBe("application/pdf");
  });

  it("does not accept RIFF containers that are not WebP", () => {
    // "RIFF....AVI " is a video. Checking only the first four bytes would accept it
    // as an image, and it would then be stored and served as one.
    const avi = new Uint8Array(32);
    avi.set([0x52, 0x49, 0x46, 0x46], 0);
    avi.set([0x41, 0x56, 0x49, 0x20], 8);

    expect(sniffUploadType(avi)).toBeNull();
  });

  it("rejects an SVG, which is a valid image and also a script carrier", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    // Deliberately absent from the allow-list: an inline SVG served same-origin can
    // execute script. This is the case a "just check it's an image" policy misses.
    expect(sniffUploadType(svg)).toBeNull();
  });

  it("rejects an HTML file dressed as an image", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>");

    expect(sniffUploadType(html)).toBeNull();
  });

  it("returns null for input too short to hold any signature", () => {
    // Reading past the end here is how a sniffer becomes a crash.
    expect(sniffUploadType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffUploadType(new Uint8Array())).toBeNull();
  });

  it("does not accept a PNG whose CR/LF guard bytes were mangled", () => {
    const mangled = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0a, 0x1a, 0x0a]);

    expect(sniffUploadType(mangled)).toBeNull();
  });
});

describe("accepting an upload", () => {
  it("returns the sniffed type, not the declared one", () => {
    // A browser that guesses `application/octet-stream` for a real JPEG is the
    // common case, and it must not be punished for it.
    const verdict = assertAcceptableUpload({
      declaredType: "application/octet-stream",
      bytes: JPEG,
    });

    expect(verdict.type).toBe("image/jpeg");
    expect(verdict.extension).toBe("jpg");
    expect(verdict.sizeBytes).toBe(JPEG.byteLength);
  });

  it("ignores a missing or nonsense declared type once the bytes have answered", () => {
    expect(assertAcceptableUpload({ bytes: PNG }).type).toBe("image/png");
    expect(assertAcceptableUpload({ declaredType: "", bytes: PNG }).type).toBe("image/png");
    expect(assertAcceptableUpload({ declaredType: "not/a-type", bytes: PNG }).type).toBe(
      "image/png",
    );
  });

  it("tolerates a declared type carrying parameters", () => {
    expect(assertAcceptableUpload({ declaredType: "image/jpeg; charset=binary", bytes: JPEG }).type)
      .toBe("image/jpeg");
  });

  it("refuses a file whose declared allowed type contradicts its bytes", () => {
    // A PDF announced as a JPEG is not a confused browser: browsers do not make
    // this mistake. It is a client saying something it cannot possibly believe.
    expect(() => assertAcceptableUpload({ declaredType: "image/jpeg", bytes: PDF })).toThrow(
      /do not match/i,
    );
  });

  it("refuses an executable no matter how it is announced", () => {
    const elf = bytesOf([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

    expect(() => assertAcceptableUpload({ declaredType: "image/png", bytes: elf })).toThrow(
      /JPEG, PNG, WebP or PDF/i,
    );
  });

  it("refuses an empty file", () => {
    expect(() => assertAcceptableUpload({ declaredType: "image/png", bytes: new Uint8Array() }))
      .toThrow(/empty/i);
  });

  it("accepts a file exactly at the limit and refuses one byte more", () => {
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const overLimit = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    overLimit.set([0xff, 0xd8, 0xff, 0xe0], 0);

    expect(assertAcceptableUpload({ bytes: atLimit }).sizeBytes).toBe(MAX_UPLOAD_BYTES);
    expect(() => assertAcceptableUpload({ bytes: overLimit })).toThrow(/5 MB/i);
  });

  it("checks size before sniffing", () => {
    // An oversized file that is also not an image should be refused for its size:
    // the cheap check must come first, or a huge unknown blob gets scanned anyway.
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);

    expect(() => assertAcceptableUpload({ bytes: huge })).toThrow(/5 MB/i);
  });
});

describe("serving what was stored", () => {
  it("passes through the four allowed types", () => {
    expect(safeContentType("image/jpeg")).toBe("image/jpeg");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
  });

  it("downgrades anything unrecognised to a type browsers download", () => {
    // This is the outbound half of the defence: a row written before Phase 13 could
    // hold `text/html`, and echoing it into a response header would make private
    // storage an XSS vector on our own origin.
    expect(safeContentType("text/html")).toBe("application/octet-stream");
    expect(safeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeContentType(null)).toBe("application/octet-stream");
    expect(safeContentType(undefined)).toBe("application/octet-stream");
    expect(safeContentType("")).toBe("application/octet-stream");
  });

  it("strips parameters before deciding, so a smuggled charset cannot pass", () => {
    expect(safeContentType("image/png; charset=utf-8")).toBe("image/png");
    expect(safeContentType("text/html; image/png")).toBe("application/octet-stream");
  });

  it("shows images inline and sends everything else as an attachment", () => {
    expect(contentDispositionFor("image/jpeg")).toBe("inline");
    expect(contentDispositionFor("image/webp")).toBe("inline");
    // A PDF rendered inline gets a same-origin script context it does not need.
    expect(contentDispositionFor("application/pdf")).toBe("attachment");
    expect(contentDispositionFor("text/html")).toBe("attachment");
  });
});

describe("type guards and extensions", () => {
  it("recognises only the allow-listed types", () => {
    expect(isAllowedUploadType("image/webp")).toBe(true);
    expect(isAllowedUploadType("image/gif")).toBe(false);
    expect(isAllowedUploadType("IMAGE/JPEG")).toBe(false);
  });

  it("maps each type to one extension", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("application/pdf")).toBe("pdf");
  });
});
