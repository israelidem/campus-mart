import Link from "next/link";

import { PublicHeader } from "@/components/landing/public-header";
import { Wordmark } from "@/components/shell/wordmark";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { prisma } from "@/lib/db/prisma";

/**
 * The Campus Mart landing page.
 *
 * Design intent: this should read as a campus noticeboard, not a SaaS homepage.
 * The devices that produce that feeling, and the reasoning behind each:
 *
 *  • A cream page with near-black text and one green. No gradient meshes, no
 *    glassmorphism, no floating 3D mockups — those signal "software company",
 *    and Campus Mart is a market.
 *  • Type does the work. The headline is set large and tight in Bricolage
 *    Grotesque; there is no hero illustration to hide behind, so the words have
 *    to be good.
 *  • One accent green, used only for actions and confirmations. When everything
 *    is coloured, nothing is a call to action.
 *  • Real numbers where we have them, no numbers where we do not. See below.
 *
 * Data: this is a server component that reads live counts. A landing page
 * claiming "500+ vendors" on a database with four is the single fastest way to
 * lose a vendor's trust, so §27 is honoured literally — every figure here is
 * queried, and the proof strip is omitted entirely when the platform is too
 * young for the numbers to be worth showing.
 */

export const revalidate = 300;

type LandingData = {
  campuses: { id: string; name: string; code: string; city: string }[];
  categories: { name: string; slug: string }[];
  counts: { vendors: number; products: number; campuses: number };
};

async function getLandingData(): Promise<LandingData> {
  // Everything here is public, aggregate and campus-agnostic: names of active
  // campuses, distinct category names, and counts. No vendor, student or order
  // detail is exposed, so there is no isolation boundary to cross.
  const [campuses, categories, vendors, products] = await Promise.all([
    prisma.campus.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, code: true, city: true },
      orderBy: { name: "asc" },
      take: 12,
    }),
    prisma.category.findMany({
      where: { isActive: true, campus: { status: "ACTIVE" } },
      select: { name: true, slug: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 24,
    }),
    prisma.vendorProfile.count({
      where: { status: "APPROVED", campus: { status: "ACTIVE" } },
    }),
    prisma.product.count({
      where: {
        deletedAt: null,
        isAvailable: true,
        vendorProfile: { status: "APPROVED" },
        campus: { status: "ACTIVE" },
      },
    }),
  ]);

  // The same category name can exist on several campuses; the landing page shows
  // the concept, not each campus's copy of it.
  const seen = new Set<string>();
  const uniqueCategories = categories.filter((category) => {
    if (seen.has(category.slug)) return false;
    seen.add(category.slug);
    return true;
  });

  return {
    campuses,
    categories: uniqueCategories.slice(0, 8),
    counts: { vendors, products, campuses: campuses.length },
  };
}

export default async function LandingPage() {
  const { campuses, categories, counts } = await getLandingData();

  // Only claim scale once there is scale. Below this, the copy sells the idea
  // and the verification model instead — which is the honest pitch for a
  // marketplace that is opening on its first campus.
  const showProof = counts.vendors >= 5 && counts.products >= 20;

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <PublicHeader />

      <main id="main" className="flex-1">
        {/* ─── Hero ─────────────────────────────────────────────────────────
            Asymmetric two-column on desktop, stacked on mobile. The right
            column is a real ordering sequence rather than a product
            screenshot: it explains the delivery-code model in the same glance
            that it demonstrates the interface. */}
        <section className="relative overflow-hidden border-b border-rule">
          {/* A single soft brand wash, top-right, well below the text. Not a
              gradient background — a light source. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 -top-40 size-[34rem] rounded-full bg-brand-200/40 blur-3xl"
          />

          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:py-24">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-600" />
                {counts.campuses > 0
                  ? `Live on ${counts.campuses} ${counts.campuses === 1 ? "campus" : "campuses"}`
                  : "Opening on campuses across Nigeria"}
              </p>

              <h1 className="mt-4 font-display text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.02em] text-ink sm:text-6xl lg:text-[4rem]">
                Everything your
                <br />
                campus needs,
                <br />
                <span className="text-brand-700">delivered.</span>
              </h1>

              <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-relaxed text-ink-2">
                Order food, essentials and supplies from vendors your campus has
                verified. A fellow student brings it to your hostel, and you only
                release payment with a code that is yours alone.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/sign-up" size="lg" className="sm:w-auto">
                  Join your campus marketplace
                </ButtonLink>
                <ButtonLink href="#how-it-works" variant="outline" size="lg" className="sm:w-auto">
                  See how it works
                </ButtonLink>
              </div>

              {/* Campus indicator. Real campus names, from the database. A
                  selector would imply you can shop before signing in, which is
                  not true — campus is bound to your verified student record. */}
              {campuses.length > 0 ? (
                <div className="mt-8 border-t border-rule pt-6">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
                    Available at
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {campuses.slice(0, 4).map((campus) => (
                      <span
                        key={campus.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-rule-2 bg-surface px-3 py-1.5 text-sm text-ink-2"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          className="size-3.5 text-brand-600"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        >
                          <path d="M8 14s5-4.2 5-7.6A5 5 0 003 6.4C3 9.8 8 14 8 14z" strokeLinejoin="round" />
                          <circle cx="8" cy="6.3" r="1.7" />
                        </svg>
                        {campus.name}
                      </span>
                    ))}
                    {campuses.length > 4 ? (
                      <span className="inline-flex items-center rounded-full px-2 py-1.5 text-sm text-ink-3">
                        +{campuses.length - 4} more
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* The order sequence. Deliberately not a screenshot: a screenshot
                dates instantly and says nothing about how the handover works. */}
            <div className="relative lg:pl-4">
              <div className="mx-auto w-full max-w-sm space-y-3">
                <OrderStepCard
                  step="1"
                  title="Chicken & chips"
                  meta="Campus Bites · ₦3,500"
                  detail="Added to cart"
                  tone="neutral"
                />
                <OrderStepCard
                  step="2"
                  title="Delivering to Hostel B"
                  meta="Room 204 · ₦500 delivery"
                  detail="Agent assigned"
                  tone="neutral"
                />
                <OrderStepCard
                  step="3"
                  title="Your delivery code"
                  meta="Share only on handover"
                  detail="4 8 2 9"
                  tone="code"
                />
                <OrderStepCard
                  step="4"
                  title="Paid on delivery"
                  meta="Secured by Paystack"
                  detail="Complete"
                  tone="success"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── Proof strip ─────────────────────────────────────────────────
            Rendered only when the numbers are real and worth stating. */}
        {showProof ? (
          <section aria-label="Campus Mart at a glance" className="border-b border-rule bg-surface">
            <dl className="mx-auto grid w-full max-w-6xl grid-cols-3 divide-x divide-rule px-4 sm:px-6">
              <Stat value={counts.vendors} label="Verified vendors" />
              <Stat value={counts.products} label="Items listed" />
              <Stat value={counts.campuses} label={counts.campuses === 1 ? "Campus" : "Campuses"} />
            </dl>
          </section>
        ) : null}

        {/* ─── How it works ────────────────────────────────────────────────
            Five steps, numbered, because the delivery-code model is genuinely
            unfamiliar and is the single thing a new student must understand
            before they will trust the platform with money. */}
        <section id="how-it-works" className="scroll-mt-20 border-b border-rule">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading
              eyebrow="How it works"
              title="From your phone to your hostel door"
              description="Five steps. You stay in control of payment until the moment the goods are in your hands."
            />

            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-3">
              {[
                {
                  title: "Find what you need",
                  body: "Search across every approved vendor on your campus, or browse by category.",
                },
                {
                  title: "Order from campus vendors",
                  body: "One cart can hold items from several stores. Each store prepares its own part.",
                },
                {
                  title: "A student agent collects it",
                  body: "A verified delivery agent on your campus accepts the job and picks up your order.",
                },
                {
                  title: "Confirm with your code",
                  body: "The agent asks for the code only you have. No code, no handover.",
                },
                {
                  title: "Pay for your goods",
                  body: "Payment is released once you have confirmed the delivery.",
                },
              ].map((step, index) => (
                <li key={step.title} className="relative rounded-card border border-rule bg-surface p-5">
                  <span className="font-mono text-xs font-medium text-brand-600">
                    0{index + 1}
                  </span>
                  <h3 className="mt-2.5 text-[0.9375rem] font-semibold leading-snug text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ─── Categories ──────────────────────────────────────────────────
            Real categories from the database when they exist. The fallback set
            is labelled as "what campuses stock", not presented as live
            inventory, so an empty database never produces a false claim. */}
        <section id="categories" className="scroll-mt-20 border-b border-rule bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading
              eyebrow="What you can buy"
              title={categories.length > 0 ? "Shop by category" : "Built for how campuses shop"}
              description={
                categories.length > 0
                  ? "Straight from stores your campus administration has approved."
                  : "From a plate of jollof to a phone charger at midnight — vendors list what students actually need."
              }
            />

            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
              {(categories.length > 0 ? categories : FALLBACK_CATEGORIES).map((category) => (
                <div
                  key={category.slug}
                  className="group rounded-card border border-rule bg-paper p-4 transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  <span aria-hidden="true" className="text-2xl">
                    {CATEGORY_ART[category.slug] ?? "🛍️"}
                  </span>
                  <p className="mt-2.5 text-sm font-medium text-ink">{category.name}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Delivery model ──────────────────────────────────────────────
            The student-to-student concept, given a section of its own because
            it is what makes this different from ordering off a group chat. */}
        <section id="delivery" className="scroll-mt-20 border-b border-rule">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="Delivery"
                title="Delivered by students, for students"
                description="Campus Mart deliveries are made by verified students earning between lectures. They know the hostels, they know the shortcuts, and they are accountable to the same campus administration you are."
                align="left"
              />

              <ul className="mt-8 space-y-4">
                {[
                  {
                    title: "Verified before they deliver",
                    body: "Every agent is a registered student, approved by your campus administration.",
                  },
                  {
                    title: "Rated after every delivery",
                    body: "You rate the handover. Agents build a record that follows them.",
                  },
                  {
                    title: "Earn on your own schedule",
                    body: "Agents go on duty when they are free and accept only the jobs they want.",
                  },
                ].map((item) => (
                  <li key={item.title} className="flex gap-3.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[0.9375rem] font-semibold text-ink">{item.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <ButtonLink href="/sign-up" variant="outline">
                  Become a delivery agent
                </ButtonLink>
              </div>
            </div>

            {/* The handover, as the agent sees it. Ink-coloured panel: this is
                the operational side of the product, and the shift in surface
                signals that without needing a caption. */}
            <div className="rounded-sheet bg-ink p-6 text-white sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-brand-300">
                Agent view
              </p>
              <p className="mt-3 font-display text-2xl font-semibold leading-tight">
                Delivery accepted
              </p>

              <dl className="mt-6 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <dt className="text-white/60">Pickup</dt>
                  <dd className="text-right font-medium">Campus Bites</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <dt className="text-white/60">Drop-off</dt>
                  <dd className="text-right font-medium">Hostel B · Room 204</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <dt className="text-white/60">Delivery fee</dt>
                  <dd className="tabular text-right font-mono font-medium text-brand-300">₦500</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-white/60">Distance</dt>
                  <dd className="tabular text-right font-mono font-medium">1.8 km</dd>
                </div>
              </dl>

              <div className="mt-6 rounded-control bg-white/10 px-4 py-3.5 text-center text-sm font-medium">
                I&rsquo;ve picked it up
              </div>
            </div>
          </div>
        </section>

        {/* ─── Trust ───────────────────────────────────────────────────────
            The verification story. Placed after the delivery section because
            "a stranger brings me my food" is the objection this answers. */}
        <section id="trust" className="scroll-mt-20 border-b border-rule bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading
              eyebrow="Trust & safety"
              title="A closed marketplace, on purpose"
              description="Campus Mart is not open to the public. Everyone you transact with has been checked by your own campus administration."
            />

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: "Campus-verified vendors",
                  body: "Stores submit documents and are approved by your campus before they can list a single item.",
                },
                {
                  title: "Verified students only",
                  body: "Your matric number is checked against your institution's records. No outside accounts.",
                },
                {
                  title: "Verified delivery agents",
                  body: "Agents apply, are vetted, and can be suspended by campus administration at any time.",
                },
                {
                  title: "Secure payments",
                  body: "Card and transfer payments are handled by Paystack. Campus Mart never sees your card details.",
                },
                {
                  title: "Confirm before you pay",
                  body: "Goods payment is released after you confirm the handover with your delivery code.",
                },
                {
                  title: "Disputes go to your campus",
                  body: "If something is wrong, you raise it in-app and your campus administration reviews it.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-card border border-rule bg-paper p-5">
                  <h3 className="text-[0.9375rem] font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Roles ───────────────────────────────────────────────────────
            Three doors, one destination. All three genuinely route to the same
            registration flow, where the role is chosen — labelling them
            separately here without three real paths would be a dead end. */}
        <section className="border-b border-rule">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Get started" title="Which one are you?" />

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {[
                {
                  badge: "Students",
                  title: "Order what you need",
                  body: "Shop verified campus vendors and have it brought to your hostel.",
                  cta: "Create a student account",
                },
                {
                  badge: "Vendors",
                  title: "Sell to your campus",
                  body: "List your products, manage stock and receive orders from students who can actually reach you.",
                  cta: "Apply as a vendor",
                },
                {
                  badge: "Agents",
                  title: "Deliver and earn",
                  body: "Pick up jobs between lectures and get paid per delivery.",
                  cta: "Apply as an agent",
                },
              ].map((role) => (
                <div
                  key={role.badge}
                  className="flex flex-col rounded-card border border-rule bg-surface p-6"
                >
                  <Badge tone="brand" className="w-fit">
                    {role.badge}
                  </Badge>
                  <h3 className="mt-4 font-display text-xl font-semibold text-ink">{role.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-2">{role.body}</p>
                  <ButtonLink href="/sign-up" variant="outline" className="mt-5 w-full">
                    {role.cta}
                  </ButtonLink>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Closing CTA ─────────────────────────────────────────────── */}
        <section className="bg-ink">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-24">
            <h2 className="mx-auto max-w-[24ch] font-display text-3xl font-semibold leading-tight tracking-[-0.015em] text-white sm:text-5xl">
              Join your campus marketplace
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-[1.0625rem] leading-relaxed text-white/70">
              Sign up with your matric number, get verified by your campus, and
              start ordering.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink href="/sign-up" size="lg" variant="inverse">
                Create your account
              </ButtonLink>
              <ButtonLink href="/sign-in" size="lg" variant="ghostInverse">
                I already have an account
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-ink-2">
              A campus marketplace and student delivery network.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/sign-in" className="text-ink-2 transition-colors hover:text-ink">
              Sign in
            </Link>
            <Link href="/sign-up" className="text-ink-2 transition-colors hover:text-ink">
              Create account
            </Link>
            <a href="#how-it-works" className="text-ink-2 transition-colors hover:text-ink">
              How it works
            </a>
            <a href="#trust" className="text-ink-2 transition-colors hover:text-ink">
              Trust & safety
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Section heading. One component so every section's rhythm is identical. */
function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">{eyebrow}</p>
      <h2 className="mt-3 font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p
          className={`mt-3.5 text-[1.0625rem] leading-relaxed text-ink-2 ${
            align === "center" ? "mx-auto" : ""
          }`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-2 py-7 text-center sm:py-8">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tabular block font-display text-2xl font-semibold text-ink sm:text-3xl">
          {value.toLocaleString("en-NG")}
        </span>
        <span className="mt-1 block text-xs text-ink-2 sm:text-sm">{label}</span>
      </dd>
    </div>
  );
}

/** One row of the hero's order sequence. */
function OrderStepCard({
  step,
  title,
  meta,
  detail,
  tone,
}: {
  step: string;
  title: string;
  meta: string;
  detail: string;
  tone: "neutral" | "code" | "success";
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-card border border-rule bg-surface p-3.5 shadow-soft">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken font-mono text-xs font-medium text-ink-2">
        {step}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        <p className="truncate text-xs text-ink-3">{meta}</p>
      </div>

      {tone === "code" ? (
        <span className="tabular shrink-0 rounded-lg bg-brand-50 px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.2em] text-brand-800">
          {detail}
        </span>
      ) : tone === "success" ? (
        <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-success">
          {detail}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-ink-3">{detail}</span>
      )}
    </div>
  );
}

/**
 * Shown only when no campus has defined categories yet. Framed as "what
 * campuses stock" rather than as live listings, so it is illustrative rather
 * than a false claim about inventory.
 */
const FALLBACK_CATEGORIES = [
  { name: "Food & meals", slug: "food" },
  { name: "Drinks", slug: "drinks" },
  { name: "Fashion", slug: "fashion" },
  { name: "Electronics", slug: "electronics" },
  { name: "Books", slug: "books" },
  { name: "Beauty", slug: "beauty" },
  { name: "School supplies", slug: "school-supplies" },
  { name: "Services", slug: "services" },
];

const CATEGORY_ART: Record<string, string> = {
  food: "🍛",
  meals: "🍛",
  drinks: "🥤",
  snacks: "🍪",
  fashion: "👕",
  clothing: "👕",
  shoes: "👟",
  electronics: "🎧",
  phones: "📱",
  books: "📚",
  stationery: "✏️",
  "school-supplies": "✏️",
  beauty: "💄",
  hair: "💈",
  groceries: "🧺",
  services: "🛠️",
  laundry: "🧼",
  printing: "🖨️",
};
