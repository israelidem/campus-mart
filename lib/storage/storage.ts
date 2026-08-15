import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import { InternalError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Private document storage (PRD §56).
 *
 * Onboarding documents are never publicly addressable. Callers store bytes and
 * receive an opaque object key; reading always goes through the server, which
 * authorises the request first. The provider is abstracted so Cloudflare R2 can
 * replace the local driver without touching business logic.
 */
export type StoredObject = {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
};

export interface DocumentStorage {
  put(input: {
    /** Logical folder, e.g. `campus/<campusId>/students/<userId>`. */
    prefix: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<StoredObject>;
  get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  delete(storageKey: string): Promise<void>;
}

export const ALLOWED_DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Validates an uploaded file before it is stored. Content type is checked
 * against the magic bytes rather than trusting the declared type or extension.
 */
export function assertValidDocument(mimeType: string, bytes: Uint8Array): void {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    throw new ValidationError("Upload a JPEG, PNG, WebP or PDF file");
  }
  if (bytes.byteLength === 0) throw new ValidationError("The uploaded file is empty");
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("Files must be 5 MB or smaller");
  }
  if (detectMimeType(bytes) !== mimeType) {
    throw new ValidationError("The file contents do not match its type");
  }
}

/** Minimal magic-byte sniffing for the formats we accept. */
export function detectMimeType(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  // WebP: "RIFF" .... "WEBP"
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

function sanitisePrefix(prefix: string): string {
  const cleaned = prefix
    .split("/")
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ""))
    .filter(Boolean)
    .join("/");
  if (!cleaned) throw new InternalError("Invalid storage prefix");
  return cleaned;
}

/**
 * Local filesystem driver for development. Files are written outside `public/`
 * so the web server cannot serve them directly.
 */
class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  private resolve(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    // Defence against traversal in a key that did not come from `put`.
    if (!target.startsWith(path.resolve(this.root) + path.sep)) {
      throw new InternalError("Refusing to access a path outside the storage root");
    }
    return target;
  }

  async put({
    prefix,
    mimeType,
    bytes,
  }: {
    prefix: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<StoredObject> {
    const extension = MIME_EXTENSIONS[mimeType] ?? "bin";
    const storageKey = `${sanitisePrefix(prefix)}/${randomUUID()}.${extension}`;
    const target = this.resolve(storageKey);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    return {
      storageKey,
      mimeType,
      sizeBytes: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const bytes = new Uint8Array(await readFile(this.resolve(storageKey)));
    return { bytes, mimeType: detectMimeType(bytes) ?? "application/octet-stream" };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolve(storageKey));
    } catch (error) {
      logger.warn("Failed to delete stored document", { storageKey, error });
    }
  }
}

let cached: DocumentStorage | undefined;

/**
 * Returns the configured storage driver.
 *
 * Only the local driver exists today; the Cloudflare R2 driver lands with the
 * production storage work and will implement the same interface.
 */
export function getDocumentStorage(): DocumentStorage {
  if (cached) return cached;

  const provider = process.env.STORAGE_PROVIDER ?? "local";
  if (provider !== "local") {
    throw new InternalError(
      `Storage provider "${provider}" is not implemented yet. Set STORAGE_PROVIDER=local.`,
    );
  }

  const root = process.env.LOCAL_STORAGE_ROOT ?? path.join(process.cwd(), ".uploads");
  cached = new LocalDocumentStorage(root);
  return cached;
}
