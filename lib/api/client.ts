/**
 * Browser-side helper for calling Campus Mart's own API.
 *
 * It unwraps the `{ ok, data }` / `{ ok, error }` envelope and throws an error
 * carrying the server's stable code, so components branch on `code` rather than
 * on message text.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

async function unwrap<T>(response: Response): Promise<T> {
  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // Non-JSON response (proxy error, timeout, …).
  }

  if (!response.ok || !body || body.ok !== true) {
    const error = body && body.ok === false ? body.error : undefined;
    throw new ApiClientError(
      error?.message ?? "Something went wrong. Please try again.",
      error?.code ?? "INTERNAL_ERROR",
      response.status,
      error?.details,
    );
  }

  return body.data;
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "GET", credentials: "same-origin" }));
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(path, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export async function apiDelete<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { method: "DELETE", credentials: "same-origin" }));
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {



  return unwrap<T>(
    await fetch(path, { method: "POST", credentials: "same-origin", body: form }),
  );
}

/** Maps a validation failure's field issues to a `{ field: message }` record. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError)) return {};
  const details = error.details as { issues?: { path: string; message: string }[] } | undefined;
  if (!details?.issues) return {};

  const result: Record<string, string> = {};
  for (const issue of details.issues) {
    if (issue.path && !result[issue.path]) result[issue.path] = issue.message;
  }
  return result;
}
