"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Never renders raw error text: server messages
 * may contain internal detail, so the user sees a generic message while the
 * digest is logged for correlation with server logs.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        time: new Date().toISOString(),
        message: "Client route error",
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm opacity-70">
        We could not complete that request. Please check your connection and try again.
      </p>
      {error.digest ? <p className="text-xs opacity-50">Reference: {error.digest}</p> : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
