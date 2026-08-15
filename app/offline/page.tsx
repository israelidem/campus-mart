import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  description: "Campus Mart could not reach the network.",
};

/**
 * What the service worker serves when a navigation cannot reach the network.
 *
 * Static by necessity: it is cached at install time, before anyone has signed in,
 * so it cannot show an order, a cart or a name. It says what happened, what is
 * safe to assume, and what to do — and nothing that would be a lie offline.
 *
 * The reassurance about payments is the important line. A student who loses
 * signal mid-checkout needs to know the platform will not have taken money it
 * cannot account for, and Phase 8's verify-then-apply flow is what makes that
 * statement true.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-2">No connection</p>

      <h1 className="mt-3 font-display text-3xl leading-tight text-ink">
        You&rsquo;re offline
      </h1>

      <p className="mt-4 max-w-prose text-ink-2">
        Campus Mart could not reach the network. This page is stored on your device, which is why
        you are seeing it instead of a browser error.
      </p>

      <div className="mt-8 border-t border-rule pt-6">
        <h2 className="font-display text-lg text-ink">Nothing is lost</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          <li>
            Orders you already placed are safe on the server. They will be exactly where you left
            them when you reconnect.
          </li>
          <li>
            Payments are confirmed by the bank, not by this app. If a payment went through, it will
            show as paid once you are back online.
          </li>
          <li>
            Hand-over codes are issued live and cannot be read offline &mdash; deliberately, so a
            code can never be lifted from a phone&rsquo;s cache.
          </li>
        </ul>
      </div>

      <p className="mt-8 text-sm text-ink-2">
        Move somewhere with better signal and reload the page.
      </p>
    </main>
  );
}
