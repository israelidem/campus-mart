import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { ProductManager } from "@/components/vendors/product-manager";
import { getActor } from "@/lib/auth/session";
import { listCategories } from "@/lib/products/category-service";
import { listVendorProducts } from "@/lib/products/product-service";
import { getVendorState } from "@/lib/vendors/vendor-service";

/**
 * Vendor catalogue management (PRD §21–22).
 *
 * A store that is not approved sees an explanation rather than a form: the
 * server would refuse every write anyway, since `requireApprovedVendor` is the
 * single approval gate.
 */
export default async function VendorProductsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const state = await getVendorState(actor);

  if (state.status !== "APPROVED") {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Your products</h1>
        <Card>
          <p className="text-sm">
            You can list products once your store is approved. Your store is currently{" "}
            <strong>{state.status.toLowerCase().replace(/_/g, " ")}</strong>.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/vendor/store" className="underline">
              Go to your store
            </Link>
          </p>
        </Card>
      </section>
    );
  }

  const [products, categories] = await Promise.all([
    listVendorProducts(actor),
    listCategories(actor),
  ]);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Your products</h1>
        <p className="text-sm opacity-70">
          Prices are shown to students in naira. Stock changes are recorded, so every movement can
          be explained later.
        </p>
      </header>

      <ProductManager
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          priceKobo: product.priceKobo,
          stockQuantity: product.stockQuantity,
          lowStockThreshold: product.lowStockThreshold,
          unitLabel: product.unitLabel,
          isAvailable: product.isAvailable,
          isLowStock: product.isLowStock,
          category: product.category,
          images: product.images,
        }))}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
      />
    </section>
  );
}
