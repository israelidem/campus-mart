import Link from "next/link";
import * as React from "react";

import { OpenBadge, RatingPill } from "@/components/ui/badge";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MarketplaceProduct } from "@/lib/products/marketplace-service";

/**
 * Product and vendor cards.
 *
 * These take the service layer's own types (`MarketplaceProduct`,
 * `StorefrontSummary`) rather than a hand-written prop bag. That is deliberate:
 * it makes it impossible to build a beautiful card against invented data and
 * only discover at integration time that the field is called something else, or
 * that `ratingAverage` is a string, or that `imageId` can be null.
 */

/**
 * Placeholder for a product with no image.
 *
 * Vendors will not photograph everything, so "no image" is a normal state, not
 * an error — but a grey box with an icon looks broken in a grid. This derives a
 * stable tint from the product name, so the same product always gets the same
 * colour and a grid of image-less products still looks composed.
 */
export function ImageFallback({ label, className }: { label: string; className?: string }) {
  const hue = React.useMemo(() => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 360;
    return hash;
  }, [label]);

  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      aria-hidden="true"
      className={cn("flex items-center justify-center", className)}
      style={{
        // Low chroma: a wall of saturated tiles is worse than a wall of grey.
        backgroundColor: `oklch(0.93 0.045 ${hue})`,
        color: `oklch(0.42 0.09 ${hue})`,
      }}
    >
      <span className="font-display text-2xl font-semibold opacity-80">{initials}</span>
    </div>
  );
}

export function productImageSrc(imageId: string | null): string | null {
  // Images are served through the API so authorization and campus isolation
  // still apply to a direct image request.
  return imageId ? `/api/products/images/${imageId}` : null;
}

/**
 * Route helpers.
 *
 * These exist so a card can never invent a URL. The product detail route is
 * `/marketplace/[productId]` and takes an **id**, not a slug — a card built
 * against `/products/[slug]` would compile, look correct, and 404 on every tap.
 *
 * There is no `/vendors/[slug]` route in this application. Rather than link to
 * one and leave a dead end, a store links to the marketplace filtered by that
 * store, which is a real screen backed by the existing `vendorProfileId` filter
 * in `marketplaceQuerySchema`. When a dedicated storefront route exists, this is
 * the single place that changes.
 */
export function productHref(productId: string): string {
  return `/marketplace/${productId}`;
}

export function vendorHref(vendorProfileId: string): string {
  return `/marketplace?vendorProfileId=${encodeURIComponent(vendorProfileId)}`;
}

export function categoryHref(categorySlug: string): string {
  return `/marketplace?categorySlug=${encodeURIComponent(categorySlug)}`;
}

/**
 * The marketplace product card.
 *
 * Anatomy, in the order a student reads it: image, name, vendor, price. The
 * quick-add button sits over the image's bottom-right corner rather than in the
 * text block, because a thumb reaching for it should not risk hitting the card
 * link, and because it keeps every card's text block exactly the same height.
 *
 * The whole card is one link. The quick-add is a separate button *outside* that
 * link's element (not nested inside it) — nesting interactive elements is
 * invalid HTML and breaks keyboard users, so the link is absolutely positioned
 * to fill the card and the button is layered above it.
 */
export function ProductCard({
  product,
  onQuickAdd,
  isAdding = false,
  className,
}: {
  product: MarketplaceProduct;
  /** Omitted on the public landing page, where there is no cart to add to. */
  onQuickAdd?: (product: MarketplaceProduct) => void;
  isAdding?: boolean;
  className?: string;
}) {
  const image = productImageSrc(product.imageId);
  const rating = product.vendor.ratingAverage ? Number(product.vendor.ratingAverage) : null;

  // A product is only orderable if it is in stock *and* its store is accepting
  // orders. Both facts come from the server; showing an add button that the
  // server would reject is exactly the "button that does nothing" problem.
  const orderable = product.inStock && product.vendor.acceptingOrders;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border border-rule bg-surface",
        "transition-[border-color,box-shadow] duration-200 hover:border-rule-2 hover:shadow-soft",
        className,
      )}
    >
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-sunken">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- images are streamed from our own authenticated route, not a known-dimension static asset.
          <img
            src={image}
            alt={product.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <ImageFallback label={product.name} className="size-full" />
        )}

        {!orderable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/75">
            <span className="rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-white">
              {product.inStock ? "Store closed" : "Sold out"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <h3 className="clamp-2 text-sm font-semibold leading-snug text-ink">{product.name}</h3>

        <Link
          href={vendorHref(product.vendor.id)}
          className="relative z-20 mt-1 w-fit truncate text-xs text-ink-2 hover:text-brand-700 hover:underline"
        >
          {product.vendor.storeName}
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="tabular font-mono text-[0.9375rem] font-medium leading-none text-ink">
              {formatPrice(product.priceKobo)}
            </p>
            {product.unitLabel ? (
              <p className="mt-1 truncate text-[0.6875rem] text-ink-3">per {product.unitLabel}</p>
            ) : null}
            {rating !== null ? <RatingPill score={rating} className="mt-1" /> : null}
          </div>

          {onQuickAdd ? (
            <button
              type="button"
              // z-20 puts it above the full-card link overlay below.
              className={cn(
                "relative z-20 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                orderable
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "cursor-not-allowed bg-sunken text-ink-3",
              )}
              disabled={!orderable || isAdding}
              aria-label={
                orderable ? `Add ${product.name} to cart` : `${product.name} is unavailable`
              }
              onClick={() => onQuickAdd(product)}
            >
              {isAdding ? (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 5.5v9M5.5 10h9" strokeLinecap="round" />
                </svg>
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* The card-wide hit area. `z-10` sits under the vendor link and quick-add
          so those remain independently clickable. */}
      <Link
        href={productHref(product.id)}
        className="absolute inset-0 z-10 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <span className="sr-only">{product.name}</span>
      </Link>
    </div>
  );
}

/** What a vendor card needs. Structurally satisfied by `StorefrontSummary`. */
export type VendorCardVendor = {
  id: string;
  storeName: string;
  slug: string;
  description: string | null;
  storefrontLocation: string;
  isOpenNow: boolean;
  ratingAverage?: string | null;
  ratingCount?: number;
  productCount?: number;
};

/**
 * A storefront in a list. Horizontal rather than a tall image card: a student
 * choosing between stores is comparing name, rating and whether it is open —
 * not looking at photographs — and a horizontal row fits four stores on a phone
 * screen instead of two.
 */
export function VendorCard({
  vendor,
  className,
}: {
  vendor: VendorCardVendor;
  className?: string;
}) {
  const rating = vendor.ratingAverage ? Number(vendor.ratingAverage) : null;

  return (
    <Link
      href={vendorHref(vendor.id)}
      className={cn(
        "group flex items-center gap-3.5 rounded-card border border-rule bg-surface p-3",
        "transition-[border-color,box-shadow] hover:border-rule-2 hover:shadow-soft",
        className,
      )}
    >
      <div className="size-14 shrink-0 overflow-hidden rounded-xl">
        <ImageFallback label={vendor.storeName} className="size-full" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-ink">{vendor.storeName}</h3>
          <OpenBadge isOpen={vendor.isOpenNow} />
        </div>

        <p className="clamp-1 mt-0.5 text-xs text-ink-2">
          {vendor.description || vendor.storefrontLocation}
        </p>

        <div className="mt-1.5 flex items-center gap-2.5">
          <RatingPill score={rating} count={vendor.ratingCount} />
          {typeof vendor.productCount === "number" ? (
            <span className="text-xs text-ink-3">
              {vendor.productCount} {vendor.productCount === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>
      </div>

      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M7.5 4.5l6 5.5-6 5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

/**
 * A category tile. Renders as a link so categories are shareable URLs, and uses
 * an emoji rather than an icon set: campus categories are concrete things
 * (jollof, hair, phone chargers) and an emoji reads faster than a line icon at
 * this size — with the label always present, so nothing depends on the glyph.
 */
export function CategoryTile({
  name,
  slug,
  emoji,
  className,
}: {
  name: string;
  slug: string;
  emoji?: string;
  className?: string;
}) {
  return (
    <Link
      href={categoryHref(slug)}
      className={cn(
        "flex shrink-0 flex-col items-center gap-2 rounded-card border border-rule bg-surface px-3 py-3 text-center",
        "w-[5.5rem] transition-[border-color,background-color] hover:border-brand-300 hover:bg-brand-50",
        className,
      )}
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {emoji ?? "🛍️"}
      </span>
      <span className="clamp-2 text-[0.6875rem] font-medium leading-tight text-ink-2">{name}</span>
    </Link>
  );
}

/**
 * Emoji per category slug. Falls back to a shopping bag, so an admin adding
 * "Phone accessories" gets a sensible tile without a code change.
 */
export const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍛",
  meals: "🍛",
  drinks: "🥤",
  snacks: "🍪",
  fashion: "👕",
  clothing: "👕",
  shoes: "👟",
  electronics: "🎧",
  phones: "📱",
  books: "📚",
  stationery: "✏️",
  "school-supplies": "✏️",
  beauty: "💄",
  hair: "💈",
  groceries: "🧺",
  services: "🛠️",
  laundry: "🧼",
  printing: "🖨️",
};

export function categoryEmoji(slug: string): string {
  return CATEGORY_EMOJI[slug] ?? "🛍️";
}
