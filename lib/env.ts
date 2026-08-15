import { z } from "zod";

/**
 * Environment configuration.
 *
 * Server-only variables are validated lazily on first access so that the
 * client bundle never needs them and `next build` does not fail on machines
 * that only build static assets. Access via `env()`.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_DATABASE_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  /**
   * Comma-separated emails that are promoted to Super Admin on sign-in.
   *
   * This is how the platform owner bootstraps: register normally, verify the
   * email, and the role is granted on the next request. Keeping it in the
   * environment rather than the database means the allowlist cannot be widened
   * by anyone with database write access alone.
   */
  SUPER_ADMIN_EMAILS: z.string().default("israelidem20@gmail.com"),

  PAYSTACK_SECRET_KEY: z.string().optional(),


  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  /**
   * Shared secret the scheduler presents to the sweep endpoint.
   *
   * The sweeps expire pickups and payment windows, so an anonymous caller must
   * not be able to run them. Optional here and required by the route: a machine
   * that never runs the cron should still boot.
   */
  CRON_SECRET: z.string().optional(),


  MAP_PROVIDER: z.enum(["haversine", "google", "mapbox"]).default("haversine"),
  MAP_PROVIDER_API_KEY: z.string().optional(),

  DEFAULT_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(250),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("env() is server-only. Use publicEnv on the client.");
  }
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Values that are safe to read in the browser. */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  paystackPublicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
} as const;

export const isProduction = process.env.NODE_ENV === "production";
export const isTest = process.env.NODE_ENV === "test";
