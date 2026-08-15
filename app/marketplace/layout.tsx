import Link from "next/link";

/** Mobile-first shell for marketplace screens. */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          Campus Mart
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/marketplace" className="underline">
            Marketplace
          </Link>
          <Link href="/cart" className="underline">
            Cart
          </Link>
          <Link href="/orders" className="underline">
            Orders
          </Link>
          <Link href="/vendor/store" className="underline">
            Sell
          </Link>

        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
