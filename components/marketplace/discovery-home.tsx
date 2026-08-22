import Link from "next/link";

import { CategoryTile, ProductCard, VendorCard, categoryEmoji } from "@/components/marketplace/cards";
import { Card } from "@/components/ui/card";
import type { CategorySummary } from "@/lib/products/category-service";
import type { MarketplaceProduct } from "@/lib/products/marketplace-service";
import type { StorefrontSummary } from "@/lib/vendors/vendor-service";

/**
 * The marketplace discovery home (§9).
 *
 * This is the screen that decides whether Campus Mart reads as a marketplace or
 * as a dashboard, so it is built as a sequence of horizontally-scrolling rails
 * rather than a grid of equal-weight cards. A rail communicates "there is more
 * where this came from" and costs one row of vertical space; a grid of twelve
 * products on a 375px screen communicates nothing and costs six.
 *
 * Every section is fed from the real services — there is no placeholder data
 * here (§27). Sections with nothing behind them are omitted entirely rather than
 * rendered as empty boxes (§28), which is why each block is guarded on `length`.
 */

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {action ? (
        <Link
          href={action.href}
          className="shrink-0 text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A horizontally scrolling rail.
 *
 * `-mx-4 px-4` lets the row bleed to the screen edge on a phone while keeping
 * the first and last card clear of it, which is what makes a rail read as
 * scrollable without a visible scrollbar. `snap-x` keeps the cards from being
 * left half-cut after a flick.
 */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
      <div className="flex snap-x snap-mandatory gap-3">{children}</div>
    </div>
  );
}

export function DiscoveryHome({
  greeting,
  firstName,
  campusName,
  categories,
  popular,
  newest,
  vendors,
}: {
  greeting: string;
  firstName: string;
  campusName: string | null;
  categories: CategorySummary[];
  popular: MarketplaceProduct[];
  newest: MarketplaceProduct[];
  vendors: StorefrontSummary[];
}) {
  const openVendors = vendors.filter((vendor) => vendor.isOpenNow);
  // Open stores lead, but closed ones still appear — a student browsing at 2am
  // should be able to see what campus has, and each card states its own status.
  const orderedVendors = [...openVendors, ...vendors.filter((vendor) => !vendor.isOpenNow)];

  const hasAnything = popular.length > 0 || newest.length > 0 || vendors.length > 0;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div>
          <p className="text-sm text-ink-2">
            {greeting}, <span className="font-medium text-ink">{firstName}</span> 👋
          </p>
          <h1 className="mt-1 font-display text-[1.625rem] font-semibold tracking-[-0.015em] text-ink">
            What do you need today?
          </h1>
        </div>

        {/* A GET form, so search works without JavaScript and the result is a
            shareable, back-button-friendly URL. */}
        <form action="/marketplace" method="get" role="search">
          <label htmlFor="marketplace-search" className="sr-only">
            Search the campus marketplace
          </label>
          <div className="flex items-center gap-2 rounded-full border border-rule bg-paper-2 pl-4 pr-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
            <span aria-hidden="true" className="text-base leading-none text-ink-3">
              ⌕
            </span>
            <input
              id="marketplace-search"
              name="q"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Food, books, clothes…"
              className="h-11 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-full bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              Search
            </button>
          </div>
        </form>

        {campusName ? (
          <p className="text-xs text-ink-3">
            Shopping <span className="text-ink-2">{campusName}</span>
            {openVendors.length > 0 ? (
              <>
                {" · "}
                <span className="text-success-600">{openVendors.length} open now</span>
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      {categories.length > 0 ? (
        <section>
          <SectionHeader title="Categories" />
          <Rail>
            {categories.map((category) => (
              <CategoryTile
                key={category.id}
                name={category.name}
                slug={category.slug}
                emoji={categoryEmoji(category.slug)}
                className="w-[7.5rem] shrink-0 snap-start"
              />
            ))}
          </Rail>
        </section>
      ) : null}

      {popular.length > 0 ? (
        <section>
          <SectionHeader
            title="Popular on campus"
            action={{ href: "/marketplace?sort=POPULAR", label: "See all" }}
          />
          <Rail>
            {popular.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                className="w-[10.5rem] shrink-0 snap-start sm:w-[12rem]"
              />
            ))}
          </Rail>
        </section>
      ) : null}

      {orderedVendors.length > 0 ? (
        <section>
          <SectionHeader title="Stores near you" />
          <div className="grid gap-3 sm:grid-cols-2">
            {orderedVendors.slice(0, 6).map((vendor) => (
              <VendorCard key={vendor.id} vendor={vendor} />
            ))}
          </div>
        </section>
      ) : null}

      {newest.length > 0 ? (
        <section>
          <SectionHeader
            title="Just added"
            action={{ href: "/marketplace?sort=NEWEST", label: "See all" }}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {newest.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {!hasAnything ? (
        /* The honest empty state (§22). Campus Mart is campus-scoped, so a new
           campus genuinely has nothing yet — saying so beats an endless spinner
           or a grid of fake products. */
        <Card className="p-8 text-center">
          <p className="text-3xl" aria-hidden="true">
            🌱
          </p>
          <h2 className="mt-3 font-display text-lg font-semibold text-ink">
            Your campus marketplace is just starting
          </h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-2">
            No stores have been approved here yet. If you sell something on campus, you could be the
            first.
          </p>
          <Link
            href="/vendor/store"
            className="mt-5 inline-flex h-11 items-center rounded-control bg-brand-600 px-5 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            Open a store
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
