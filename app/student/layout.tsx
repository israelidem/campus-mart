import Link from "next/link";

/** Mobile-first shell for student screens. */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4">
      <Link href="/" className="text-lg font-semibold">
        Campus Mart
      </Link>
      <main className="flex-1">{children}</main>
    </div>
  );
}
