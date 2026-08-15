/**
 * URL-safe identifiers.
 *
 * Slugs are always derived on the server from the human-readable name, never
 * accepted from the client: a client-supplied slug is a way to collide with, or
 * impersonate, another record.
 */
export function slugify(value: string, maxLength = 60): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}
