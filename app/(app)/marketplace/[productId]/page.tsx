import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ImageFallback, productImageSrc, vendorHref } from "@/components/marketplace/cards";
import { AddToCartButton } from "@/components/orders/add-to-cart";
import { Badge, OpenBadge, RatingPill } from "@/components/ui/badge";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { getMarketplaceProduct } from "@/lib/products/marketplace-service";

/**
 * Product detail (PRD §24, §12 of the redesign brief).
 *
 * A product from another campus, from an unapproved store, or one that has been
 * retired resolves to a 404 here: the service applies those filters in the
 * query, so this page cannot show something the rules forbid. That logic is
 * unchanged — this pass rebuilt the presentation around it.
 *
 * Three decisions worth recording:
 *
 *  • The gallery is a CSS scroll-snap strip whose thumbnails are in-page anchors.
 *    No client JavaScript, no hydration cost, and swipe works natively — a
 *    carousel component here would ship a bundle to do what the browser already
 *    does. The old page stacked every image vertically, which pushed the price
 *    and the buy button off a phone screen entirely.
 *  • The purchase CTA is fixed to the bottom of the viewport on mobile, seated
 *    directly above the tab bar. A student deciding whether to buy should never
 *    have to scroll back up to act.
 *  • `maxQuantity` is deliberately not passed. The service returns `inStock` as
 *    a boolean but not the count, and inventing a ceiling from a value we do not
 *    have would produce a stepper that lies. The server enforces stock and its
 *    message ("Only 3 left in stock") is surfaced verbatim by the toast.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?reason=session-expired");
  if (!actor.campusId) redirect("/after-sign-in");

  const { productId } = await params;

  let product;
  try {
    product = await getMarketplaceProduct(actor, productId);
  } catch (error) {
    // Forbidden is folded into "not found" on purpose: an id must not reveal
    // that a record exists on another campus.
    if (error instanceof AppError) notFound();
    throw error;
  }

  const rating = product.vendor.ratingAverage ? Number(product.vendor.ratingAverage) : null;
  const orderable = product.inStock && product.vendorIsOpenNow;

  // The reason a closed store blocks the sale, phrased for a student rather than
  // restated as a status code. `null` when the only problem is stock, which
  // `AddToCartButton` already words for itself.
  const closedReason = !product.vendorIsOpenNow
    ? `${product.vendor.storeName} is closed right now. You can still browse — order when they reopen.`
    : null;

  return (
    <article className="pb-28 md:pb-0">
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Marketplace
        </Link>
      </nav>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_22rem] md:gap-8 lg:gap-10">
        {/* ── Gallery ─────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div
            className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-card border border-rule bg-sunken"
            // A labelled region so the strip is announced as one thing rather
            // than as a run of unrelated images.
            role="group"
            aria-label={`${product.name} images`}
          >
            {product.imageIds.length > 0 ? (
              product.imageIds.map((imageId, index) => (
                <div
                  key={imageId}
                  id={`product-image-${index}`}
                  className="aspect-[4/3] w-full shrink-0 snap-center scroll-mt-24"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- streamed from our own authenticated route, so dimensions are unknown at build time. */}
                  <img
                    src={productImageSrc(imageId) ?? ""}
                    alt={
                      product.imageIds.length > 1
                        ? `${product.name} — image ${index + 1} of ${product.imageIds.length}`
                        : product.name
                    }
                    // The first image is the largest thing on the screen, so it
                    // loads eagerly; the rest are off-screen until swiped.
                    loading={index === 0 ? "eager" : "lazy"}
                    className="size-full object-cover"
                  />
                </div>
              ))
            ) : (
              <div className="aspect-[4/3] w-full shrink-0">
                <ImageFallback label={product.name} className="size-full" />
              </div>
            )}
          </div>

          {/* Thumbnails double as jump links. Only shown when there is a choice. */}
          {product.imageIds.length > 1 ? (
            <ul className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
              {product.imageIds.map((imageId, index) => (
                <li key={imageId} className="shrink-0">
                  <a
                    href={`#product-image-${index}`}
                    className="block size-16 overflow-hidden rounded-xl border border-rule transition-colors hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
                    <img
                      src={productImageSrc(imageId) ?? ""}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    <span className="sr-only">{`Show image ${index + 1}`}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* ── Detail ──────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              {product.category ? (
                <Badge tone="neutral">{product.category.name}</Badge>
              ) : null}
              {!product.inStock ? <Badge tone="danger">Sold out</Badge> : null}
            </div>

            <h1 className="mt-2.5 font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-2xl">
              {product.name}
            </h1>

            <p className="tabular mt-2 font-mono text-2xl font-medium leading-none text-ink">
              {formatPrice(product.priceKobo)}
              {product.unitLabel ? (
                <span className="ml-1.5 font-sans text-sm font-normal text-ink-2">
                  per {product.unitLabel}
                </span>
              ) : null}
            </p>

            {/* Social proof only when it is real. "0 sold" is worse than silence. */}
            {product.soldCount > 0 ? (
              <p className="mt-2 text-xs text-ink-3">
                {product.soldCount} {product.soldCount === 1 ? "order" : "orders"} delivered
              </p>
            ) : null}
          </header>

          {product.description ? (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-2">
              {product.description}
            </p>
          ) : null}

          {/* The storefront, as a link — the vendor is how a student judges
              whether to trust the item, so it is a destination, not a caption. */}
          <Link
            href={vendorHref(product.vendor.id)}
            className="group mt-5 flex items-center gap-3 rounded-card border border-rule bg-surface p-3 transition-[border-color,box-shadow] hover:border-rule-2 hover:shadow-soft"
          >
            <div className="size-11 shrink-0 overflow-hidden rounded-xl">
              <ImageFallback label={product.vendor.storeName} className="size-full" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink">
                  {product.vendor.storeName}
                </p>
                <OpenBadge isOpen={product.vendorIsOpenNow} />
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <RatingPill score={rating} count={product.vendor.ratingCount} />
                <span className="truncate text-xs text-ink-3">
                  {product.vendorStorefrontLocation}
                </span>
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

          {/* Desktop purchase controls. On mobile the fixed bar below owns this,
              so this copy is hidden rather than duplicated into two live
              steppers that could disagree with each other. */}
          <div className="mt-5 hidden md:block">
            <AddToCartButton
              productId={productId}
              inStock={product.inStock}
              closedReason={closedReason}
            />
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-px size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 2.5l6 2.5v4.5c0 3.5-2.4 6.6-6 7.5-3.6-.9-6-4-6-7.5V5l6-2.5z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            You only pay for goods after a delivery agent hands them over and you
            confirm with your code.
          </p>
        </div>
      </div>

      {/*
        Mobile purchase bar. `bottom` clears the fixed tab bar (3.5rem) plus the
        iOS home indicator, so the two bars stack instead of overlapping — the
        article's `pb-28` reserves the room so the last paragraph is never
        trapped underneath.
      */}
      <div
        className="fixed inset-x-0 z-30 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur md:hidden"
        style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-screen-lg items-center gap-3">
          {/* Repeating the price here is not redundancy: by the time the student
              has scrolled to the description, the price has left the screen. */}
          <div className="min-w-0 shrink">
            <p className="tabular truncate font-mono text-sm font-medium leading-none text-ink">
              {formatPrice(product.priceKobo)}
            </p>
            <p className="mt-1 truncate text-[0.6875rem] text-ink-3">
              {orderable ? product.vendor.storeName : !product.inStock ? "Sold out" : "Store closed"}
            </p>
          </div>

          <AddToCartButton
            productId={productId}
            inStock={product.inStock}
            closedReason={closedReason}
            className="ml-auto"
          />
        </div>
      </div>
    </article>
  );
}
