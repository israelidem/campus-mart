import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import { InternalError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  ALLOWED_UPLOAD_TYPES,
  assertAcceptableUpload,
  extensionFor,
  MAX_UPLOAD_BYTES,
  safeContentType,
  sniffUploadType,
  type AllowedUploadType,
} from "@/lib/security/upload-policy";

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

/**
 * Re-exported so the many existing callers keep one import site, while the policy
 * itself lives in `lib/security/upload-policy.ts` where it can be unit tested
 * without the filesystem (Phase 13).
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = ALLOWED_UPLOAD_TYPES;
export const MAX_DOCUMENT_BYTES = MAX_UPLOAD_BYTES;

/**
 * Validates an uploaded file and returns the type it *actually* is.
 *
 * Phase 13 inverted this check. It used to take the client's declared type and
 * ask whether the bytes agreed; now the bytes decide and the declared type is
 * only consulted to catch a contradiction. The return value matters: callers must
 * store what came back here, not what the browser said, because the stored type is
 * what a later `Content-Type` header is built from.
 */
export function assertValidDocument(mimeType: string, bytes: Uint8Array): AllowedUploadType {
  return assertAcceptableUpload({ declaredType: mimeType, bytes }).type;
}

/**
 * Magic-byte sniffing, kept as a named export because callers read it as
 * documentation of what the platform accepts.
 */
export function detectMimeType(bytes: Uint8Array): string | null {
  return sniffUploadType(bytes);
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
    // Sniffed again here, at the last moment before bytes hit the disk. The
    // service layer has already validated, so this is a second opinion rather
    // than the first: it means a future caller that forgets to validate still
    // cannot write a file whose extension and recorded type are attacker-chosen.
    const verdict = assertAcceptableUpload({ declaredType: mimeType, bytes });

    const storageKey = `${sanitisePrefix(prefix)}/${randomUUID()}.${extensionFor(verdict.type)}`;
    const target = this.resolve(storageKey);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    return {
      storageKey,
      // The sniffed type, not the declared one.
      mimeType: verdict.type,
      sizeBytes: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const bytes = new Uint8Array(await readFile(this.resolve(storageKey)));
    // Sniffed on the way out too, and narrowed by `safeContentType`, so a file
    // that somehow got onto the disk by another route still cannot dictate the
    // content type it is served with.
    return { bytes, mimeType: safeContentType(sniffUploadType(bytes)) };
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
