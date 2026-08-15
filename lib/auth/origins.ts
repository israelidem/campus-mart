/**
 * Where this deployment believes it is running, and which origins may call the
 * auth endpoints.
 *
 * Better Auth refuses any request whose `Origin` does not match its own base URL
 * or an explicitly trusted origin, answering 403 `INVALID_ORIGIN`. A deployment
 * that inherits a localhost `BETTER_AUTH_URL` therefore rejects *every* sign-in,
 * which is indistinguishable from a wrong password unless you read the response
 * body. These helpers live apart from `auth.ts` so they can be unit tested
 * without constructing the whole auth instance.
 */

type Env = Record<string, string | undefined>;

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * An explicit `BETTER_AUTH_URL` always wins, so an operator can override this.
 * Otherwise the Vercel-provided host is used, because it is correct by
 * construction; localhost is only the last resort for local development.
 */
export function resolveBaseUrl(env: Env = process.env): string {
  const explicit = env["BETTER_AUTH_URL"] ?? env["NEXT_PUBLIC_APP_URL"];
  if (explicit) return withoutTrailingSlash(explicit);

  const vercelHost = env["VERCEL_PROJECT_PRODUCTION_URL"] ?? env["VERCEL_URL"];
  if (vercelHost) return `https://${vercelHost}`;

  return "http://localhost:3000";
}

/**
 * Preview deployments get a fresh hostname per build, so this lists the
 * deployment's own hostnames instead of a `*.vercel.app` wildcard, which would
 * trust every site on the platform.
 */
export function resolveTrustedOrigins(env: Env = process.env): string[] {
  const vercelOrigins = [
    env["VERCEL_URL"],
    env["VERCEL_BRANCH_URL"],
    env["VERCEL_PROJECT_PRODUCTION_URL"],
  ]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`);

  const origins = [resolveBaseUrl(env), env["NEXT_PUBLIC_APP_URL"], ...vercelOrigins]
    .filter((origin): origin is string => Boolean(origin))
    .map(withoutTrailingSlash);

  return [...new Set(origins)];
}
