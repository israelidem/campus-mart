import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm opacity-70">
        The page you were looking for does not exist, or you do not have access to it.
      </p>
      <Link href="/">
        <Button variant="outline">Back to Campus Mart</Button>
      </Link>
    </main>
  );
}
