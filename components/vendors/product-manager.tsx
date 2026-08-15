"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiDelete, apiPatch, apiPost, apiUpload, fieldErrors } from "@/lib/api/client";
import { formatKobo } from "@/lib/money";

/**
 * Vendor product management (PRD §21–22).
 *
 * Prices are typed in naira and converted to kobo before they are sent, and
 * stock is only ever changed through an adjustment — the same rules the server
 * enforces, so the screen cannot suggest something the API would reject.
 */

export type VendorProduct = {
  id: string;
  name: string;
  priceKobo: number;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string | null;
  isAvailable: boolean;
  isLowStock: boolean;
  category: { id: string; name: string } | null;
  images: { id: string; position: number }[];
};

export type CategoryOption = { id: string; name: string };

function nairaToKoboInput(value: string): number {
  const naira = Number.parseFloat(value);
  if (!Number.isFinite(naira)) return Number.NaN;
  return Math.round(naira * 100);
}

export function ProductManager({
  products: initialProducts,
  categories,
}: {
  products: VendorProduct[];
  categories: CategoryOption[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function report(error: unknown) {
    setErrors(fieldErrors(error));
    setMessage(
      error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.",
    );
  }

  async function createProduct(form: FormData) {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const { product } = await apiPost<{ product: VendorProduct }>("/api/vendors/me/products", {
        name: String(form.get("name") ?? ""),
        priceKobo: nairaToKoboInput(String(form.get("price") ?? "")),
        stockQuantity: Number(form.get("stock") ?? 0),
        lowStockThreshold: Number(form.get("lowStockThreshold") ?? 0),
        unitLabel: String(form.get("unitLabel") ?? "") || undefined,
        categoryId: String(form.get("categoryId") ?? "") || null,
        description: String(form.get("description") ?? "") || undefined,
      });

      setProducts((current) => [product, ...current]);
      setMessage(`“${product.name}” added.`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability(product: VendorProduct) {
    setBusy(true);
    setMessage(null);
    try {
      const { product: saved } = await apiPatch<{ product: VendorProduct }>(
        `/api/vendors/me/products/${product.id}`,
        { isAvailable: !product.isAvailable },
      );
      setProducts((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function adjustStock(product: VendorProduct, delta: number) {
    if (!Number.isInteger(delta) || delta === 0) {
      setMessage("Enter how many units to add or remove.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const { inventory } = await apiPost<{
        inventory: { stockQuantity: number; isLowStock: boolean };
      }>(`/api/vendors/me/products/${product.id}/inventory`, {
        reason: delta > 0 ? "RESTOCK" : "ADJUSTMENT",
        delta,
      });

      setProducts((current) =>
        current.map((item) =>
          item.id === product.id
            ? {
                ...item,
                stockQuantity: inventory.stockQuantity,
                isLowStock: inventory.isLowStock,
              }
            : item,
        ),
      );
      setMessage(`Stock for “${product.name}” is now ${inventory.stockQuantity}.`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(product: VendorProduct, file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { image } = await apiUpload<{ image: { id: string; position: number } }>(
        `/api/vendors/me/products/${product.id}/images`,
        form,
      );

      setProducts((current) =>
        current.map((item) =>
          item.id === product.id ? { ...item, images: [...item.images, image] } : item,
        ),
      );
      setMessage("Photo added.");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct(product: VendorProduct) {
    setBusy(true);
    setMessage(null);
    try {
      await apiDelete(`/api/vendors/me/products/${product.id}`);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      setMessage(`“${product.name}” removed from your store.`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="status" className="rounded-xl border border-current/10 p-3 text-sm">
          {message}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a product</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            action={(form) => {
              void createProduct(form);
            }}
          >
            <Field id="name" label="Product name" error={errors.name}>
              <Input name="name" required maxLength={100} placeholder="Jollof rice" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="price" label="Price (₦)" error={errors.priceKobo}>
                <Input name="price" required inputMode="decimal" step="0.01" min="1" type="number" />
              </Field>
              <Field id="stock" label="Opening stock" error={errors.stockQuantity}>
                <Input name="stock" type="number" min="0" defaultValue={0} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="unitLabel"
                label="Unit (optional)"
                hint="Shown next to the price, e.g. per plate."
                error={errors.unitLabel}
              >
                <Input name="unitLabel" maxLength={30} placeholder="per plate" />
              </Field>
              <Field
                id="lowStockThreshold"
                label="Low-stock warning at"
                error={errors.lowStockThreshold}
              >
                <Input name="lowStockThreshold" type="number" min="0" defaultValue={0} />
              </Field>
            </div>

            <Field id="categoryId" label="Category" error={errors.categoryId}>
              <select
                name="categoryId"
                className="h-11 w-full rounded-xl border border-current/15 bg-transparent px-3 text-base"
              >
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="description" label="Description (optional)" error={errors.description}>
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-base"
              />
            </Field>

            <Button type="submit" isLoading={busy}>
              Add product
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Your products ({products.length})</h2>

        {products.length === 0 ? (
          <p className="text-sm opacity-70">
            Nothing listed yet. Products appear in the marketplace as soon as they have stock.
          </p>
        ) : null}

        {products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            busy={busy}
            onToggle={() => void toggleAvailability(product)}
            onAdjust={(delta) => void adjustStock(product, delta)}
            onUpload={(file) => void uploadImage(product, file)}
            onRemove={() => void removeProduct(product)}
          />
        ))}
      </section>
    </div>
  );
}

function ProductRow({
  product,
  busy,
  onToggle,
  onAdjust,
  onUpload,
  onRemove,
}: {
  product: VendorProduct;
  busy: boolean;
  onToggle: () => void;
  onAdjust: (delta: number) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const [delta, setDelta] = useState("");

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">{product.name}</p>
          <p className="text-sm opacity-70">
            {formatKobo(product.priceKobo)}
            {product.unitLabel ? ` ${product.unitLabel}` : ""} ·{" "}
            {product.category?.name ?? "Uncategorised"}
          </p>
          <p className="text-sm">
            {product.stockQuantity} in stock
            {product.isLowStock ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                Low stock
              </span>
            ) : null}
            {!product.isAvailable ? (
              <span className="ml-2 rounded-full bg-current/10 px-2 py-0.5 text-xs">Paused</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onToggle} disabled={busy}>
            {product.isAvailable ? "Pause" : "Resume"}
          </Button>
          <Button variant="danger" size="sm" onClick={onRemove} disabled={busy}>
            Remove
          </Button>
        </div>
      </div>

      <CardContent className="mt-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Field id={`delta-${product.id}`} label="Adjust stock">
              <Input
                type="number"
                inputMode="numeric"
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
                placeholder="+10 / -2"
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              onAdjust(Number.parseInt(delta, 10));
              setDelta("");
            }}
          >
            Apply
          </Button>

          <label className="text-sm">
            <span className="block font-medium">Add a photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 text-sm"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label>

          <span className="text-xs opacity-60">
            {product.images.length} photo{product.images.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
