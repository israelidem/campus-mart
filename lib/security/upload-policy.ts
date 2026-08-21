/**
 * What may be uploaded, decided from the bytes (Phase 13, PRD §56).
 *
 * Pure: bytes in, verdict out. It supersedes the sniffing that lived in
 * `lib/storage/storage.ts`, which asked "do the magic bytes match the type the
 * *client* declared?" — a question whose answer is "yes" for a browser that
 * guessed wrong on a perfectly good file, and also "yes" for an attacker who
 * declared honestly. Both were wrong outcomes.
 *
 * The rule here is the other way round: **the bytes decide the type, and the
 * declared type is only consulted to disagree.** What is stored, and what is
 * later served in `Content-Type`, is the sniffed type. A request header never
 * reaches a response header.
 */

import { ValidationError } from "@/lib/errors";

/** The four formats a campus needs: photographs of things, and PDFs of documents. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/**
 * 5 MB.
 *
 * A phone photograph is 2–4 MB, a scanned ID is under 1 MB, and this is the
 * audience most likely to be paying for its own data (PRD §12). Raising it makes
 * onboarding slower for everyone to accommodate nobody.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Smallest input worth sniffing.
 *
 * The longest signature checked below is twelve bytes (WebP's RIFF/WEBP pair), so
 * anything shorter cannot be any of the accepted formats and is rejected as
 * "unrecognised" rather than read past its end.
 */
const MIN_SNIFFABLE_BYTES = 12;

const EXTENSIONS: Record<AllowedUploadType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function isAllowedUploadType(value: string): value is AllowedUploadType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value);
}

/** The extension a stored object gets, chosen from the sniffed type only. */
export function extensionFor(type: AllowedUploadType): string {
  return EXTENSIONS[type];
}

/**
 * The type these bytes actually are, or null.
 *
 * Deliberately narrow. A general-purpose sniffer recognises a hundred formats and
 * every one of them is a decision to serve something; this recognises exactly the
 * four the platform accepts and calls everything else unknown. An SVG, for
 * instance, is a perfectly valid image that can also carry script, and it is not
 * on the list for that reason.
 */
export function sniffUploadType(bytes: Uint8Array): AllowedUploadType | null {
  if (bytes.byteLength < MIN_SNIFFABLE_BYTES) return null;

  const startsWith = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);

  // JPEG: SOI marker.
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";

  // PNG: the 8-byte signature, including the CR/LF pair that detects a
  // text-mode transfer having mangled the file.
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";

  // PDF: "%PDF".
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf";

  // WebP: "RIFF" then a 4-byte size then "WEBP". Both halves are required —
  // "RIFF" alone is also AVI and WAV.
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export type UploadVerdict = {
  /** The type to store and to serve. Always sniffed, never declared. */
  type: AllowedUploadType;
  sizeBytes: number;
  extension: string;
};

/**
 * Accept or refuse an upload.
 *
 * Order matters and is deliberate:
 *
 * 1. **Size first**, because it is the cheapest check and the one an attacker can
 *    make most expensive by omitting.
 * 2. **Sniff second**, and reject on the bytes alone. A file whose contents are
 *    not one of the four formats is refused whatever it claims to be.
 * 3. **Compare last, and only to catch a lie.** A mismatch between a *declared*
 *    allowed type and the sniffed type is refused, because it is either a
 *    disguised payload or a client that cannot be trusted about anything else it
 *    sent either. A declared type that is empty or nonsense (browsers send
 *    `application/octet-stream` for files they do not recognise) is ignored
 *    rather than fatal: the bytes have already answered the question.
 */
export function assertAcceptableUpload(input: {
  declaredType?: string | null;
  bytes: Uint8Array;
}): UploadVerdict {
  const size = input.bytes.byteLength;

  if (size === 0) throw new ValidationError("The uploaded file is empty");
  if (size > MAX_UPLOAD_BYTES) {
    throw new ValidationError("Files must be 5 MB or smaller");
  }

  const sniffed = sniffUploadType(input.bytes);
  if (!sniffed) {
    throw new ValidationError("Upload a JPEG, PNG, WebP or PDF file");
  }

  const declared = input.declaredType?.trim().toLowerCase().split(";")[0] ?? "";
  if (declared && isAllowedUploadType(declared) && declared !== sniffed) {
    throw new ValidationError("The file contents do not match its type");
  }

  return { type: sniffed, sizeBytes: size, extension: extensionFor(sniffed) };
}

/**
 * The `Content-Type` a stored object may be served with.
 *
 * Called on the way *out* as well as in, so a row written before this phase — or
 * by a future driver that trusted its input — cannot turn a stored string into a
 * served content type. Anything unrecognised becomes
 * `application/octet-stream`, which browsers download rather than render.
 */
export function safeContentType(storedType: string | null | undefined): string {
  const candidate = storedType?.trim().toLowerCase().split(";")[0] ?? "";
  return isAllowedUploadType(candidate) ? candidate : "application/octet-stream";
}

/**
 * The `Content-Disposition` for a stored object.
 *
 * Images are shown inline because an admin reviewing a passport photograph needs
 * to see it. A PDF is sent as an attachment: rendering it inline gives a
 * same-origin document its own script context, and no screen on the platform
 * needs a PDF displayed in place.
 */
export function contentDispositionFor(type: string): "inline" | "attachment" {
  return safeContentType(type).startsWith("image/") ? "inline" : "attachment";
}
