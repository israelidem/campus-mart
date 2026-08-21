import { redirect } from "next/navigation";

import { ProductBrowser } from "@/components/marketplace/product-browser";
import { getActor } from "@/lib/auth/session";
import { listCategories } from "@/lib/products/category-service";
import { searchProducts } from "@/lib/products/marketplace-service";
import { marketplaceQuerySchema } from "@/validations/product";

/**
 * Campus marketplace (PRD §24).
 *
 * The first page is rendered on the server so the catalogue is visible without
 * waiting for client JavaScript; filtering afterwards goes through the API.
 */
export default async function MarketplacePage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const [firstPage, categories] = await Promise.all([
    searchProducts(actor, marketplaceQuerySchema.parse({})),
    listCategories(actor),
  ]);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Marketplace</h1>
        <p className="text-sm opacity-70">
          Everything here is sold by approved stores on your campus.
        </p>
      </header>

      <ProductBrowser
        initialPage={firstPage}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
      />
    </section>
  );
}
