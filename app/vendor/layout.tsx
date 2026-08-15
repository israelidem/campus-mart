import Link from "next/link";

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
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
