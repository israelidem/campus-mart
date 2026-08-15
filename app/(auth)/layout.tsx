import Link from "next/link";

/** Centred, mobile-first shell for the authentication screens. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4">
      <Link href="/" className="text-lg font-semibold">
        Campus Mart
      </Link>
      {children}
    </main>
  );
}
