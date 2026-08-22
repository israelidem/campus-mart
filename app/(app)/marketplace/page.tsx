import Link from "next/link";
import { redirect } from "next/navigation";

import { DiscoveryHome } from "@/components/marketplace/discovery-home";
import { ProductBrowser } from "@/components/marketplace/product-browser";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listCategories } from "@/lib/products/category-service";
import { searchProducts } from "@/lib/products/marketplace-service";
import { listStorefronts } from "@/lib/vendors/vendor-service";
import { marketplaceQuerySchema, parseMarketplaceQuery } from "@/validations/product";

/**
 * The campus marketplace (PRD §24) — and, for a student, the home screen.
 *
 * One route serves two jobs, decided by whether the URL carries a query:
 *
 *  • Bare `/marketplace` is the discovery home from §9 — greeting, search,
 *    categories, popular, stores, new arrivals.
 *  • Any search/filter parameter switches to the results browser.
 *
 * They are one route rather than two because "search" is not a different place
 * from "browse" in a student's mental model; it is the same shelf, narrowed. It
 * also means the search field, the category tiles and the "See all" links can
 * all point at plain URLs, which keeps the whole flow working without client
 * JavaScript and keeps the back button honest.
 *
 * The first render happens on the server in both modes so the catalogue is
 * visible on a slow campus connection before hydration; filtering afterwards
 * goes through the API.
 */

/** Time-of-day greeting in the campus timezone, not the server's (§9). */
function greetingFor(timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(new Date()),
  );

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The parameters that mean "the visitor is looking for something specific". */
const FILTER_KEYS = [
  "q",
  "categoryId",
  "categorySlug",
  "vendorProfileId",
  "minPriceKobo",
  "maxPriceKobo",
  "inStockOnly",
  "minRating",
  "sort",
  "page",
] as const;

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?reason=session-expired");
  if (!actor.campusId) redirect("/after-sign-in");

  const params = await searchParams;

  // Flatten to `URLSearchParams` so the same validated parser used by the API
  // route also parses the page's URL — one schema, no second interpretation.
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
    else if (Array.isArray(value) && value[0]) search.set(key, value[0]);
  }

  const isFiltered = FILTER_KEYS.some((key) => search.has(key));

  const campus = await prisma.campus.findUnique({
    where: { id: actor.campusId },
    select: { name: true, timezone: true },
  });
  const timezone = campus?.timezone ?? "Africa/Lagos";

  if (isFiltered) {
    // `parseMarketplaceQuery` throws on a malformed URL. A hand-edited or stale
    // link should degrade to the default catalogue rather than to an error
    // screen, so it falls back instead of propagating (§23).
    let query;
    try {
      query = parseMarketplaceQuery(search);
    } catch {
      query = marketplaceQuerySchema.parse({});
    }

    const [firstPage, categories] = await Promise.all([
      searchProducts(actor, query),
      listCategories(actor),
    ]);

    const term = query.q?.trim();

    return (
      <section className="space-y-5">
        <header className="space-y-2">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            <span aria-hidden="true">←</span> Marketplace
          </Link>
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em] text-ink">
            {term ? `Results for “${term}”` : "Browse"}
          </h1>
          <p className="text-sm text-ink-2">
            {firstPage.total === 0
              ? "Nothing matched."
              : `${firstPage.total} ${firstPage.total === 1 ? "item" : "items"} from approved stores on your campus.`}
          </p>
        </header>

        <ProductBrowser
          initialPage={firstPage}
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        />
      </section>
    );
  }

  // Discovery home. Four independent reads, so they run concurrently — on a
  // cold campus connection the difference is the whole point of the screen.
  const [popular, newest, categories, vendors] = await Promise.all([
    searchProducts(actor, marketplaceQuerySchema.parse({ sort: "POPULAR", pageSize: "8" })),
    searchProducts(actor, marketplaceQuerySchema.parse({ sort: "NEWEST", pageSize: "8" })),
    listCategories(actor),
    listStorefronts(actor),
  ]);

  return (
    <DiscoveryHome
      greeting={greetingFor(timezone)}
      // Just the first name: "Good evening, Israel" is a greeting, "Good
      // evening, Israel Idem" is a form letter.
      firstName={actor.name.trim().split(/\s+/)[0] || "there"}
      campusName={campus?.name ?? null}
      categories={categories}
      popular={popular.products}
      newest={newest.products}
      vendors={vendors}
    />
  );
}
