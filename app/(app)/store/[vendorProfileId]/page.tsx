import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ImageFallback, ProductCard } from "@/components/marketplace/cards";
import { Badge, OpenBadge, RatingPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { searchProducts } from "@/lib/products/marketplace-service";
import { getStorefront } from "@/lib/vendors/vendor-service";
import { marketplaceQuerySchema } from "@/validations/product";

/**
 * Vendor storefront (§11 of the redesign brief).
 *
 * Until now `vendorHref` pointed at `/marketplace?vendorProfileId=…`, which is a
 * filtered product list, not a shop: it showed the store's products but never
 * the store — no rating, no opening hours, no pickup point, no description. This
 * page is that missing storefront.
 *
 * Both reads are existing service functions and both apply campus isolation and
 * "APPROVED stores only" inside the query, so this page cannot render a store or
 * a product the rules forbid. `getStorefront` is new, but it is a sibling of
 * `listStorefronts` with the same `where` — not a new access path.
 *
 * Two decisions worth recording:
 *
 *  • The category row is a set of links that re-enter this same route with a
 *    `category` param, so filtering costs no client JavaScript and every shelf
 *    is a shareable URL. The tabs are built from categories that actually have
 *    a buyable product, so a tab can never lead to an empty shelf.
 *  • `ProductCard` is rendered without `onQuickAdd`. Quick-add needs a client
 *    component, and adding one here would ship a bundle to duplicate the
 *    stepper the product page already has. Tapping a card opens the product,
 *    which is where quantity actually gets chosen.
 */
export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorProfileId: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?reason=session-expired");
  if (!actor.campusId) redirect("/after-sign-in");

  const { vendorProfileId } = await params;
  const { category } = await searchParams;

  let store;
  try {
    store = await getStorefront(actor, vendorProfileId);
  } catch (error) {
    // Forbidden and not-found collapse into one response on purpose: an id must
    // not reveal that a store exists on another campus.
    if (error instanceof AppError) notFound();
    throw error;
  }

  // Only honour a category the store actually sells in, so a hand-edited URL
  // cannot produce a header that contradicts the shelf below it.
  const activeCategory = category
    ? (store.categories.find((entry) => entry.slug === category) ?? null)
    : null;

  const shelf = await searchProducts(
    actor,
    marketplaceQuerySchema.parse({
      vendorProfileId: store.id,
      ...(activeCategory ? { categorySlug: activeCategory.slug } : {}),
      pageSize: 24,
    }),
  );

  const rating = store.ratingAverage ? Number(store.ratingAverage) : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Marketplace
        </Link>
      </nav>

      {/* Storefront header. The banner is a deterministic tint derived from the
          store name rather than an uploaded cover: vendors have no cover-image
          field, and inventing one would mean shipping a placeholder graphic to
          every store on campus. */}
      <header className="overflow-hidden rounded-card border border-rule bg-surface">
        <div className="relative h-28 sm:h-36">
          <ImageFallback label={store.storeName} className="absolute inset-0 size-full" />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-ink/55 to-transparent"
          />
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                {store.storeName}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <OpenBadge isOpen={store.isOpenNow} />
                {rating !== null ? (
                  <RatingPill score={rating} count={store.ratingCount} />
                ) : (
                  <Badge tone="neutral">New store</Badge>
                )}
                <span className="text-sm text-ink-2">
                  {store.productCount === 1 ? "1 item" : `${store.productCount} items`}
                </span>
              </div>
            </div>
          </div>

          {store.description ? (
            <p className="max-w-prose text-sm leading-relaxed text-ink-2">{store.description}</p>
          ) : null}

          {/* Closed is stated once, here, in a student's words. Individual cards
              do not repeat it — twenty copies of the same sentence is noise. */}
          {!store.isOpenNow ? (
            <p className="rounded-xl border border-rule bg-warning-soft px-3 py-2.5 text-sm text-ink">
              {store.storeName} is closed right now. Browse the shelf and order when they reopen.
            </p>
          ) : null}

          <dl className="grid gap-3 border-t border-rule pt-4 text-sm sm:grid-cols-2">
            <div className="space-y-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-2">Pick-up</dt>
              <dd className="text-ink">{store.storefrontLocation}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-2">
                Opening hours
              </dt>
              <dd className="text-ink">
                <ul className="space-y-0.5">
                  {store.schedule.map((day) => (
                    <li key={day.dayOfWeek} className="flex justify-between gap-4">
                      <span className="text-ink-2">{day.label}</span>
                      <span className={day.hours ? "text-ink" : "text-ink-2"}>
                        {day.hours ?? "Closed"}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {/* In-store category filter. Rendered only when there is a real choice to
          make: a single tab is decoration, not navigation. */}
      {store.categories.length > 1 ? (
        <nav aria-label="Filter by category" className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            <li className="shrink-0">
              <Link
                href={`/store/${store.id}`}
                aria-current={activeCategory === null ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                  activeCategory === null
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-rule bg-surface text-ink-2 hover:text-ink"
                }`}
              >
                All
              </Link>
            </li>
            {store.categories.map((entry) => {
              const isActive = activeCategory?.slug === entry.slug;
              return (
                <li key={entry.id} className="shrink-0">
                  <Link
                    href={`/store/${store.id}?category=${encodeURIComponent(entry.slug)}`}
                    aria-current={isActive ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-rule bg-surface text-ink-2 hover:text-ink"
                    }`}
                  >
                    {entry.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <section aria-label="Products" className="space-y-4">
        <h2 className="text-base font-semibold text-ink">
          {activeCategory ? activeCategory.name : "Everything in store"}
        </h2>

        {shelf.products.length === 0 ? (
          <EmptyState
            title={activeCategory ? `Nothing in ${activeCategory.name} yet` : "This store is empty"}
            description={
              activeCategory
                ? "Try another category, or browse everything this store sells."
                : `${store.storeName} hasn't listed anything for sale yet. Check back soon.`
            }
            action={
              <ButtonLink
                href={activeCategory ? `/store/${store.id}` : "/marketplace"}
                variant="secondary"
              >
                {activeCategory ? "Show everything" : "Browse marketplace"}
              </ButtonLink>
            }
          />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {shelf.products.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>

            {/* The shelf is capped at one page. Rather than pretend the rest
                does not exist, hand the student to the marketplace, which
                already has working pagination for this same filter. */}
            {shelf.total > shelf.products.length ? (
              <p className="text-center text-sm text-ink-2">
                Showing {shelf.products.length} of {shelf.total}.{" "}
                <Link
                  href={`/marketplace?vendorProfileId=${encodeURIComponent(store.id)}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  See all
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
