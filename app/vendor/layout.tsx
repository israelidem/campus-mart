import Link from "next/link";

import { NotificationMenu } from "@/components/notifications/notification-menu";

/** Mobile-first shell for vendor screens. */

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          Campus Mart
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/vendor/store" className="underline">
            Store
          </Link>
          <Link href="/vendor/products" className="underline">
            Products
          </Link>
          <Link href="/vendor/orders" className="underline">
            Orders
          </Link>

          <Link href="/marketplace" className="underline">
            Marketplace
          </Link>

          {/* Vendors get the same bell: a new order is their most urgent news. */}
          <NotificationMenu />
        </nav>


      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
