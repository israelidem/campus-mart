import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AddToCartButton } from "@/components/orders/add-to-cart";
import { Card } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatKobo } from "@/lib/money";
import { getMarketplaceProduct } from "@/lib/products/marketplace-service";

/**
 * Product detail (PRD §24).
 *
 * A product from another campus, from an unapproved store, or one that has been
 * retired resolves to a 404 here: the service applies those filters in the
 * query, so this page cannot show something the rules forbid.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const { productId } = await params;

  let product;
  try {
    product = await getMarketplaceProduct(actor, productId);
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }

  return (
    <section className="space-y-4">
      <p className="text-sm">
        <Link href="/marketplace" className="underline">
          ← Back to marketplace
        </Link>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          {product.imageIds.length > 0 ? (
            product.imageIds.map((imageId) => (
              // Images are served privately by the API, not from a CDN URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={imageId}
                src={`/api/products/images/${imageId}`}
                alt={product.name}
                className="w-full rounded-2xl object-cover"
              />
            ))
          ) : (
            <div aria-hidden="true" className="h-56 w-full rounded-2xl bg-current/5" />
          )}
        </div>

        <div className="space-y-3">
          <header className="space-y-1">
            <h1 className="text-xl font-semibold">{product.name}</h1>
            <p className="text-lg">
              {formatKobo(product.priceKobo)}
              {product.unitLabel ? <span className="text-sm"> {product.unitLabel}</span> : null}
            </p>
            <p className="text-sm opacity-70">
              {product.category ? product.category.name : "Uncategorised"}
            </p>
          </header>

          {product.description ? <p className="text-sm">{product.description}</p> : null}

          <Card>
            <p className="font-medium">{product.vendor.storeName}</p>
            <p className="text-sm opacity-70">{product.vendorStorefrontLocation}</p>
            <p className="mt-2 text-sm">
              {product.vendorIsOpenNow ? "Open now" : "Closed right now"}
              {" · "}
              {product.inStock ? "In stock" : "Out of stock"}
            </p>
          </Card>

          <AddToCartButton productId={productId} inStock={product.inStock} />

        </div>
      </div>
    </section>
  );
}
