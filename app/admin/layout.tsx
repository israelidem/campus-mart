import Link from "next/link";

/** Shell for Campus Admin screens. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/" className="text-lg font-semibold">
          Campus Mart
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" href="/admin/students">
            Students
          </Link>
          <Link className="underline" href="/admin/vendors">
            Vendors
          </Link>
          <Link className="underline" href="/admin/delivery-locations">
            Delivery locations
          </Link>
          <Link className="underline" href="/admin/ratings">
            Reviews
          </Link>
          <Link className="underline" href="/admin/settings">


            Settings
          </Link>

        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
