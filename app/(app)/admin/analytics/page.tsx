import Link from "next/link";
import { redirect } from "next/navigation";

import { AnalyticsDashboard } from "@/components/admin/analytics-dashboard";
import { MS_PER_DAY } from "@/lib/analytics/analytics-policy";
import { getCampusDashboard } from "@/lib/analytics/analytics-service";
import { getActor } from "@/lib/auth/session";
import { analyticsDashboardQuerySchema } from "@/validations/analytics";

/**
 * Campus Admin analytics (PRD §65–68).
 *
 * The preset windows are links rather than a form, so every view is a URL an admin can
 * bookmark or paste into a message — and the page stays a server component with no
 * client JavaScript at all.
 *
 * `searchParams` is parsed through the same schema the API route uses. A hand-edited
 * URL is untrusted input whether it arrives at an endpoint or a page, and validating in
 * one place means a bad date renders a note instead of quietly reporting on a window
 * nobody asked for.
 */

/**
 * `YYYY-MM-DD` for a day, in the *server's* zone.
 *
 * Deliberately not `toISOString().slice(0, 10)`. That formats in UTC, so at 00:30 in
 * Lagos it returns yesterday — every preset would silently ask for a window one day off
 * from the one the service buckets into, and the "7 days" button would quietly show six.
 */
function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");

  const params = await searchParams;

  const parsed = analyticsDashboardQuerySchema.safeParse({
    from: params.from ?? undefined,
    to: params.to ?? undefined,
    topLimit: 5,
  });

  // A malformed range falls back to the default window rather than throwing: the admin
  // came here to read numbers, and an error page for a mistyped URL is a worse answer
  // than the last 30 days plus an explanation.
  const query = parsed.success ? parsed.data : { topLimit: 5 };
  const dashboard = await getCampusDashboard(actor, query);

  const now = new Date();
  const dayKeyAgo = (days: number) => toDayKey(new Date(now.getTime() - days * MS_PER_DAY));
  const today = toDayKey(now);

  // Each preset is inclusive of today, so "7 days" means today plus the six before it.
  const presets = [
    { label: "7 days", from: dayKeyAgo(6) },
    { label: "30 days", from: dayKeyAgo(29) },
    { label: "90 days", from: dayKeyAgo(89) },
  ].map((preset) => ({
    label: preset.label,
    href: `/admin/analytics?from=${preset.from}&to=${today}`,
    // Compared against what the service actually resolved, not against the URL, so the
    // highlight reflects the window being displayed even on a default or fallback load.
    active: dashboard.range.from === preset.from && dashboard.range.to === today,
  }));

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm opacity-70">
          {dashboard.range.from} to {dashboard.range.to} ({dashboard.range.days} days).{" "}
          {actor.role === "SUPER_ADMIN"
            ? "Figures cover every campus."
            : "Figures cover your campus only."}
        </p>
        {!parsed.success && (
          <p className="text-sm text-red-700 dark:text-red-400">
            That date range could not be read, so the last 30 days are shown instead.
          </p>
        )}
      </header>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Reporting period">
        {presets.map((preset) => (
          <Link
            key={preset.label}
            href={preset.href}
            aria-current={preset.active ? "page" : undefined}
            className={
              preset.active
                ? "rounded-full bg-current/10 px-3 py-1 font-medium"
                : "rounded-full px-3 py-1 opacity-70 hover:opacity-100"
            }
          >
            {preset.label}
          </Link>
        ))}
      </nav>

      <AnalyticsDashboard dashboard={dashboard} />
    </section>
  );
}
