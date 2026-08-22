import Link from "next/link";

import { Wordmark } from "@/components/shell/wordmark";

/**
 * Shell for the authentication screens.
 *
 * Split composition: a form column that is always the full width on mobile, and
 * a brand panel that appears only from `lg` up. The panel is not decoration — it
 * carries the three facts that decide whether someone finishes signing up
 * (verified vendors, student delivery, pay on confirmation), which on mobile
 * live on the landing page instead of stealing height above the form.
 *
 * The form column is vertically centred but scrolls when the viewport is short,
 * which is the case on a 320×568 phone with a keyboard open.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-paper">
      <main className="flex w-full flex-col items-center justify-center px-4 py-10 sm:px-6 lg:w-[54%] lg:px-12">
        <div className="w-full max-w-[26rem]">
          <Link href="/" className="mb-8 inline-flex" aria-label="Campus Mart home">
            <Wordmark />
          </Link>

          {children}
        </div>
      </main>

      {/* Brand panel. `aria-hidden` because everything in it is marketing copy
          that is already on the landing page — a screen reader user working
          through a sign-in form does not need it read out first. */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-ink lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12"
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full bg-brand-600/20 blur-3xl"
        />

        <div className="relative">
          <p className="font-display text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-white">
            Everything your
            <br />
            campus needs,
            <br />
            <span className="text-brand-300">delivered.</span>
          </p>
        </div>

        <ul className="relative space-y-5">
          {[
            {
              title: "Campus-verified vendors",
              body: "Every store is approved by your campus administration before it can sell.",
            },
            {
              title: "Delivered by students",
              body: "Verified student agents bring your order to your hostel.",
            },
            {
              title: "Confirm, then pay",
              body: "Goods payment is released only after you confirm with your delivery code.",
            },
          ].map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600/25 text-brand-300">
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-white/60">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
