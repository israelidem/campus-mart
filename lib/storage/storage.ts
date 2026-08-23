import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import { del as blobDelete, get as blobGet, put as blobPut } from "@vercel/blob";

import { InternalError, NotFoundError } from "@/lib/errors";
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
 * authorises the request first.
 *
 * Two drivers implement this: the local filesystem for development, and Vercel
 * Blob for deployment. They are deliberately kept adjacent in this file because
 * their *security* behaviour must stay identical — in particular both sniff the
 * bytes on the way in and again on the way out, and neither ever lets a stored
 * value dictate the `Content-Type` a document is served with. A reviewer should
 * be able to diff them by eye.
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

/**
 * Vercel Blob driver for deployment.
 *
 * Every object is written with `access: "private"`, so possessing the URL is not
 * sufficient to read it — which is the whole point for matriculation cards and
 * government ID. Reads therefore go through `blobGet` with the store token,
 * server-side, after the route has authorised the viewer. Nothing here ever
 * hands a Blob URL to a browser.
 */
class BlobDocumentStorage implements DocumentStorage {
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
    // Second opinion before the bytes leave the process, exactly as the local
    // driver does. See the comment there for why this is not redundant.
    const verdict = assertAcceptableUpload({ declaredType: mimeType, bytes });

    const key = `${sanitisePrefix(prefix)}/${randomUUID()}.${extensionFor(verdict.type)}`;

    const result = await blobPut(key, Buffer.from(bytes), {
      access: "private",
      // The sniffed type. Passing the declared one would let a caller choose the
      // header their file is later served with.
      contentType: verdict.type,
      /*
       * `randomUUID` already makes the key unguessable, and a caller that reuses
       * a key is a bug rather than something to paper over — so no random suffix
       * and no overwrite. A collision throws instead of silently replacing
       * someone else's ID document.
       */
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    return {
      // The pathname Blob actually stored, not the one we asked for.
      storageKey: result.pathname,
      mimeType: verdict.type,
      sizeBytes: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const result = await blobGet(storageKey, { access: "private" });

    // A key in the database with no object behind it is a missing document, not
    // a server fault: 404 so the admin sees "document unavailable" rather than a
    // crash page.
    if (!result) throw new NotFoundError("Document not found");

    if (result.statusCode !== 200) {
      // Only reachable via `ifNoneMatch`, which this driver never sends.
      throw new InternalError(`Unexpected Blob status ${result.statusCode}`);
    }

    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());

    // Sniffed on the way out and narrowed by `safeContentType`, mirroring the
    // local driver: the stored `contentType` is metadata an attacker might have
    // influenced, so it is not what we serve with.
    return { bytes, mimeType: safeContentType(sniffUploadType(bytes)) };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await blobDelete(storageKey);
    } catch (error) {
      logger.warn("Failed to delete stored document", { storageKey, error });
    }
  }
}

let cached: DocumentStorage | undefined;

/**
 * Returns the configured storage driver.
 *
 * `STORAGE_PROVIDER` wins when set. Otherwise the driver is inferred from
 * whether a Blob store is connected, because Vercel injects
 * `BLOB_READ_WRITE_TOKEN` automatically: that gives a working deployment with no
 * configuration, and a working `npm run dev` with no account.
 */
export function getDocumentStorage(): DocumentStorage {
  if (cached) return cached;

  const configured = process.env.STORAGE_PROVIDER;
  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const provider = configured ?? (hasBlobToken ? "blob" : "local");

  if (provider === "blob") {
    if (!hasBlobToken) {
      throw new InternalError(
        "STORAGE_PROVIDER=blob requires BLOB_READ_WRITE_TOKEN. Connect a Blob store in the Vercel dashboard, or set STORAGE_PROVIDER=local.",
      );
    }
    cached = new BlobDocumentStorage();
    return cached;
  }

  if (provider !== "local") {
    throw new InternalError(
      `Unknown storage provider "${provider}". Set STORAGE_PROVIDER to "blob" or "local".`,
    );
  }

  /*
   * Refuse the local driver on Vercel rather than letting it fail per-request.
   *
   * This was the actual production bug: the serverless filesystem is read-only,
   * so `writeFile` threw EROFS *inside* the upload handler and every student and
   * vendor submitting documents got an opaque 500. Failing here instead turns a
   * mystery into a sentence that names the fix.
   */
  if (process.env.VERCEL) {
    throw new InternalError(
      "Local document storage cannot be used on Vercel: the filesystem is read-only. Connect a Blob store so BLOB_READ_WRITE_TOKEN is available.",
    );
  }

  const root = process.env.LOCAL_STORAGE_ROOT ?? path.join(process.cwd(), ".uploads");
  cached = new LocalDocumentStorage(root);
  return cached;
}
