"use client";

import Link from "next/link";
import { useCallback, useState } from "react";


import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiGet } from "@/lib/api/client";
import { formatKobo } from "@/lib/money";

/**
 * Student marketplace browse (PRD §24).
 *
 * The component only builds a query string; the campus filter and the
 * "approved vendors only" rule are applied by the server, never here (Rule 29).
 */

export type BrowseProduct = {
  id: string;
  name: string;
  priceKobo: number;
  unitLabel: string | null;
  inStock: boolean;
  imageId: string | null;
  category: { id: string; name: string; slug: string } | null;
  vendor: { id: string; storeName: string; slug: string; acceptingOrders: boolean };
};

export type BrowsePage = {
  products: BrowseProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const SORT_LABELS: Record<string, string> = {
  NEWEST: "Newest",
  POPULAR: "Most popular",
  PRICE_ASC: "Price: low to high",
  PRICE_DESC: "Price: high to low",
};

export function ProductBrowser({
  initialPage,
  categories,
}: {
  initialPage: BrowsePage;
  categories: { id: string; name: string }[];
}) {
  const [result, setResult] = useState(initialPage);
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("NEWEST");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Fetches a page. Changing a filter passes its new value explicitly, because
   * the corresponding state update has not been applied yet at that point.
   * Every request starts at page 1 unless a page is named.
   */
  const load = useCallback(
    async (overrides: { q?: string; categoryId?: string; sort?: string; page?: number } = {}) => {
      const next = { q, categoryId, sort, page: 1, ...overrides };

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ sort: next.sort, page: String(next.page) });
        if (next.q.trim()) params.set("q", next.q.trim());
        if (next.categoryId) params.set("categoryId", next.categoryId);

        setResult(await apiGet<BrowsePage>(`/api/marketplace/products?${params.toString()}`));
      } catch (caught) {
        setError(
          caught instanceof ApiClientError ? caught.message : "Could not load the marketplace.",
        );
      } finally {
        setLoading(false);
      }
    },
    [categoryId, q, sort],
  );


  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}

      >
        <Field id="q" label="Search">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Product, store or category"
          />
        </Field>

        <Field id="categoryId" label="Category">
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              void load({ categoryId: event.target.value });
            }}

            className="h-11 w-full rounded-xl border border-current/15 bg-transparent px-3 text-base"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="sort" label="Sort by">
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              void load({ sort: event.target.value });
            }}

            className="h-11 w-full rounded-xl border border-current/15 bg-transparent px-3 text-base"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Button type="submit" isLoading={loading} className="sm:col-span-3">
          Search
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <p className="text-sm opacity-70" role="status">
        {result.total} product{result.total === 1 ? "" : "s"} on your campus
      </p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.products.map((product) => (
          <li key={product.id}>
            <Card className="h-full">
              <Link href={`/marketplace/${product.id}`} className="block space-y-2">
                {product.imageId ? (
                  // Served privately through the API, so a plain <img> is used
                  // rather than next/image's optimiser.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/products/images/${product.imageId}`}
                    alt={product.name}
                    className="h-40 w-full rounded-xl object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-40 w-full rounded-xl bg-current/5"
                  />
                )}

                <p className="font-medium">{product.name}</p>
                <p className="text-sm">
                  {formatKobo(product.priceKobo)}
                  {product.unitLabel ? ` ${product.unitLabel}` : ""}
                </p>
                <p className="text-xs opacity-70">
                  {product.vendor.storeName}
                  {product.category ? ` · ${product.category.name}` : ""}
                </p>
                {!product.inStock ? <p className="text-xs opacity-70">Out of stock</p> : null}
              </Link>
            </Card>
          </li>
        ))}
      </ul>

      {result.products.length === 0 ? (
        <p className="text-sm opacity-70">Nothing matches that search yet.</p>
      ) : null}

      {result.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={result.page <= 1 || loading}
            onClick={() => void load({ page: Math.max(1, result.page - 1) })}

          >
            Previous
          </Button>
          <span className="text-sm opacity-70">
            Page {result.page} of {result.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={result.page >= result.totalPages || loading}
            onClick={() => void load({ page: result.page + 1 })}

          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
