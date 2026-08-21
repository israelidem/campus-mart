import Link from "next/link";
import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/session";
import { resolveShellContext } from "@/lib/navigation/capabilities";
import { homeHref } from "@/lib/navigation/navigation";

/**
 * Landing page, for people who are not signed in.
 *
 * The design is built around the one artifact this product actually produces: a
 * delivery docket. Everything the server decides — price, fee, deadline, OTP,
 * reference — is set in mono, so the page teaches the app's own convention while
 * it sells it.
 *
 * Anyone already signed in is sent to their own home instead. Before this, `/`
 * served the sales pitch to everybody, so a student who opened the app each
 * morning was greeted by an argument for a product they had already joined, with
 * a "Continue" link as the only way in. Signing in should end the pitch.
 *
 * It used to double as a directory of every page in the app. That went with the
 * shell: navigation now comes from one model that knows who is reading, and a
 * hand-maintained list of admin URLs on the public page was both a maintenance
 * burden and an invitation to a locked door.
 */


/**
 * The hand-over, in the order it happens. Numbering is used here because the
 * content genuinely is a sequence — each step is only reachable from the one
 * before it, which is exactly how the delivery state machine works.
 */
const HANDOVER: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "You order",
    body: "One cart, several vendors, one invoice. The delivery fee is settled up front so a parcel is never carried on a promise.",
  },
  {
    step: "02",
    title: "The vendor packs",
    body: "Your order is split per vendor. Each one accepts, packs, and marks their parcel ready. Stock leaves the shelf at checkout, not at pickup.",
  },
  {
    step: "03",
    title: "An agent claims it",
    body: "The parcel joins your campus pool. The first approved agent to accept owns it — the claim is one atomic write, so two agents can never both win.",
  },
  {
    step: "04",
    title: "Fifteen minutes to collect",
    body: "The clock is set by the server when the parcel is published. Miss it and the parcel returns to the pool for someone else.",
  },
  {
    step: "05",
    title: "Six digits at your door",
    body: "You read the code to the agent. The code is what releases payment for the goods, so you never pay for a parcel you have not been handed.",
  },
];

const DOCKET_ROWS: { label: string; value: string }[] = [
  { label: "Pickup", value: "Mama Ope Kitchen · Block C shops" },
  { label: "Drop", value: "Kings Hall · Block 4 entrance" },
  { label: "Items", value: "3 items · 2 vendors" },
  { label: "Goods", value: "₦4,850" },
  { label: "Delivery fee", value: "₦350" },
  { label: "Collect by", value: "15:42 · 15 min" },
];

const OTP = ["4", "8", "2", "9", "1", "7"];

export default async function HomePage() {
  const actor = await getActor();

  /*
   * Signed in? Then this page is not for you. The destination comes from the
   * navigation model, so "home" means the same thing here as it does in the
   * header wordmark and after sign-in.
   */
  if (actor) {
    if (actor.isSuspended) redirect("/suspended");
    const { capabilities } = await resolveShellContext(actor);
    redirect(homeHref(capabilities));
  }

  return (
    <div className="flex w-full flex-1 flex-col bg-paper text-ink">
      <header className="flex items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="font-display text-lg font-extrabold tracking-tight">Campus Mart</span>
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-ink-2">
            ABUAD
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/sign-in"
            className="px-3 py-2 font-medium underline decoration-rule underline-offset-4 hover:decoration-ink"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-ink px-4 py-2 font-medium text-paper transition-transform hover:-translate-y-0.5"
          >
            Create account
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero: the claim on the left, the artifact on the right. */}
        <section className="grid gap-8 px-4 pb-10 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10 lg:pb-16 lg:pt-10">
          <div>
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.22em] text-ink-2">
              Block to block · one campus at a time
            </p>
            <h1 className="mt-4 font-display text-[2.5rem] font-extrabold leading-[0.98] tracking-[-0.02em] sm:text-5xl lg:text-[3.5rem]">
              The shop is two blocks away.
              <span className="block text-brand-700">So is the person bringing it.</span>
            </h1>
            <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-2">
              Campus Mart only works inside your campus, on purpose. You buy from vendors your
              campus admin has approved, another student carries it to your block, and you pay for
              the goods once they are in your hand.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="rounded-full bg-brand-700 px-6 py-3 font-medium text-paper transition-transform hover:-translate-y-0.5"
              >
                Create your account
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-ink px-6 py-3 font-medium transition-transform hover:-translate-y-0.5"
              >
                I already have an account
              </Link>
            </div>

            <p className="mt-4 font-mono text-xs leading-relaxed text-ink-2">
              Registration is checked against your school&apos;s student registry.
            </p>
          </div>

          {/* The signature: a delivery docket, pinned to an ink board. */}
          <div className="rounded-2xl bg-ink p-5 sm:p-8">
            <div className="animate-docket relative mx-auto max-w-sm">
              <div className="notched relative rounded-[10px] bg-paper-2 px-5 py-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)]">
                <div className="animate-line flex items-baseline justify-between gap-3" style={{ "--line": 0 } as React.CSSProperties}>
                  <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-2">
                    Delivery docket
                  </p>
                  <p className="font-mono text-[0.625rem] tracking-wider text-ink-2">CM-8F2K-4Q</p>
                </div>

                <dl className="mt-4">
                  {DOCKET_ROWS.map((row, index) => (
                    <div
                      key={row.label}
                      className={`animate-line flex items-baseline justify-between gap-4 pb-2.5 ${
                        index === 0 ? "" : "perforated pt-2.5"
                      }`}

                      style={{ "--line": index + 1 } as React.CSSProperties}
                    >
                      <dt className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-2">
                        {row.label}
                      </dt>
                      <dd className="font-mono text-right text-[0.8125rem] leading-snug">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div
                  className="animate-line mt-5 border-t-2 border-dashed border-rule pt-4"
                  style={{ "--line": DOCKET_ROWS.length + 1 } as React.CSSProperties}
                >
                  <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-2">
                    Read at the door
                  </p>
                  <div className="mt-2 flex gap-1.5" aria-label="Example delivery code: 4 8 2 9 1 7">
                    {OTP.map((digit, index) => (
                      <span
                        key={`${digit}-${index}`}
                        aria-hidden="true"
                        className="flex h-11 flex-1 items-center justify-center rounded-md bg-ink font-mono text-xl font-medium text-paper"
                      >
                        {digit}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-2">
                    Payment for the goods is released by this code — not by the agent, and not by
                    the app.
                  </p>
                </div>

                <p className="stamped absolute -bottom-3 right-4 rounded-sm px-2 py-1 font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em]">
                  Goods unpaid
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The hand-over. A sequence, so it is numbered. */}
        <section className="border-t border-rule px-4 py-12">
          <div className="max-w-prose">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              How a hand-over runs
            </h2>
            <p className="mt-3 text-ink-2">
              Five steps, each one only reachable from the step before it. The rules below are
              enforced on the server, which is why they hold when two people tap at once.
            </p>
          </div>

          <ol className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {HANDOVER.map((item) => (
              <li key={item.step} className="border-t-2 border-ink pt-3">
                <p className="font-mono text-xs tracking-[0.18em] text-brand-700">{item.step}</p>
                <h3 className="mt-2 font-display text-lg font-bold tracking-tight">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{item.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Three ways in. */}
        <section className="border-t border-rule px-4 py-12">
          <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Three ways to use it
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Buy",
                body: "Order from approved vendors on your own campus and have it brought to your block.",
                cta: "Browse the marketplace",
              },
              {
                title: "Sell",
                body: "Run your shop from your phone: products, prices, stock, operating hours, orders.",
                cta: "Apply to sell",
              },
              {
                title: "Deliver",
                body: "Take parcels between lectures. Claim from the pool, collect, hand over, get paid.",
                cta: "Apply to deliver",
              },
            ].map((door) => (
              /*
               * All three doors lead to sign-up, because all three require a
               * verified student account. Pointing a visitor at /vendor/store
               * would bounce them to sign-in and lose which door they chose.
               */
              <Link
                key={door.title}
                href="/sign-up"
                className="group flex flex-col justify-between rounded-xl border border-rule bg-paper-2 p-5 transition-colors hover:border-ink"
              >
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight">{door.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{door.body}</p>
                </div>
                <p className="mt-5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-brand-700">
                  {door.cta} →
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* What the server decides. Product truth, not decoration. */}
        <section className="mx-4 mb-12 rounded-2xl bg-ink px-5 py-8 text-paper sm:px-8">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Decided by the server, every time
          </h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              {
                term: "Your campus",
                detail:
                  "Products, vendors, agents and orders are filtered by campus in the query. A student on another campus cannot see your marketplace, let alone order from it.",
              },
              {
                term: "Price and stock",
                detail:
                  "Prices are snapshotted onto the order in kobo when you check out, and stock is reserved in the same transaction. The browser never gets a say.",
              },
              {
                term: "Your money",
                detail:
                  "Campus Mart holds no wallet. Payments settle through Paystack, straight to the vendor and the agent, with the campus commission taken at source.",
              },
            ].map((fact) => (
              <div key={fact.term}>
                <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-brand-300">
                  {fact.term}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-paper/80">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-rule px-4 py-8 text-sm text-ink-2">
        <p className="max-w-prose leading-relaxed">
          Campus Mart is being built phase by phase for the ABUAD pilot. Ordering, delivery and the
          agent pool are working today; the hand-over code and Paystack payments are next, so the
          docket above shows where the product is going.
        </p>
        <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.18em]">
          Campus Mart · one campus at a time
        </p>
      </footer>
    </div>
  );
}
