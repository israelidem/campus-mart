# Campus Mart — UI/UX Audit & Overhaul

**Date:** 2026-08-22
**Scope:** Frontend / product experience only. No database, auth, payment, delivery
or authorization logic was rewritten.

This document is deliberately blunt. §29 and §34 of the brief forbid declaring a
feature complete because a route exists, so where work is unfinished it is
recorded as unfinished rather than dressed up.

---

## 1. Current state — what actually exists

The audit was done by reading every file under `app/` and `components/`, not by
trusting the phase reports in `docs/`. The headline finding: **the backend is
substantially further along than the frontend.** Thirteen phases produced a real
service layer with genuine campus isolation, a delivery state machine, Paystack
settlement and an audit log — and almost no product.

### Public

| Screen | Status before | Note |
|---|---|---|
| Landing page | **BROKEN** as a landing page | `app/page.tsx` was a redirect/stub. There was no explanation of Campus Mart anywhere on the public web. |
| Sign in | PARTIALLY WORKS | Submitted correctly, but every failure rendered the same sentence: "Those credentials are not correct." |
| Sign up | PARTIALLY WORKS | One long single-page form. |
| Verify email | EXISTS | Unstyled. |
| Forgot password | **MISSING** | No route. The sign-in page linked to nothing. |
| Student / vendor / agent onboarding | PARTIALLY WORKS | Forms post correctly; no sense of progress or completion. |

### Student app

| Screen | Status before |
|---|---|
| Home | **MISSING** — signing in landed on a dashboard, not a marketplace |
| Marketplace / browse | PARTIALLY WORKS (`product-browser.tsx` worked but looked like an admin table) |
| Search | PARTIALLY WORKS (query param only, no UI) |
| Categories | EXISTS in data, **MISSING** in UI |
| Vendor page | **MISSING** |
| Product detail page | **MISSING** |
| Cart | PARTIALLY WORKS |
| Checkout / invoice | PARTIALLY WORKS |
| Orders, delivery tracking, notifications, profile, reviews, disputes | EXIST, unstyled |

### Vendor / agent / admin / super-admin

All exist as functional forms and lists. All were unstyled, desktop-shaped, and
built independently of each other. The delivery-agent screens were the worst fit
for their purpose: an operational, one-handed, outdoors interface rendered as a
generic dashboard.

---

## 2. Problems discovered

1. **No design system.** Every screen invented its own colours. `text-red-600`,
   `opacity-70`, `border-current/15` and `bg-paper-2` all appeared as one-off
   values. There were no tokens.
2. **Invisible form controls.** `components/ui/field.tsx` used
   `bg-transparent` + `border-current/15`. On the cream background this produced
   inputs that were nearly impossible to see, and inside a card they vanished.
3. **`Button` defaulted to full width.** This is why every small action — "Retry",
   "+", a filter chip — stretched edge to edge on a phone, and why screens kept
   overriding the primitive.
4. **The account menu was a desktop dropdown on phones.** `absolute right-0 w-72`
   containing *every* navigation group, with an inner scroll container fighting
   the page's. This is the §6 screenshot failure. Confirmed by reading the code,
   not guessed.
5. **No sign-out anywhere** until recently — on a shared campus phone that means
   the next person inherits the session.
6. **Auth errors were a single sentence.** `INVALID_ORIGIN` — a deployment
   misconfiguration where no password can ever work — was reported to students as
   "wrong credentials", sending them to reset a password that was never wrong.
7. **No loading, empty or error states as components.** Screens rendered the
   string `Loading…`.
8. **Money formatting was duplicated** per screen, with inconsistent results.
9. **No landing page.** The single largest gap: a visitor could not find out what
   the product was.

---

## 3. Broken flows

| Flow | Break |
|---|---|
| Sign in → wrong password | Correct behaviour, useless message |
| Sign in → unverified email | Reported as bad credentials; no path to resend |
| Sign in → misconfigured origin | Reported as bad credentials; unrecoverable and unexplained |
| Sign in → network failure | **Unhandled promise rejection.** The button spun forever. Now caught. |
| Landing → understand product | No content existed |
| Sign in → marketplace | Landed on a dashboard |
| Any screen → sign out | Did not exist |
| Account menu on mobile | Panel exceeded the viewport |

---

## 4. Missing screens

Still missing at the end of this pass, and **not** claimed as done:

- Forgot password / reset password
- Product detail page (`/marketplace/[productId]` — `ProductCard` already links
  here, so this is currently a dead link and the highest-priority gap)
- Public vendor storefront page (vendor links resolve to a filtered marketplace
  view, which works but is not the storefront described in §11)
- Category listing page (category tiles filter the marketplace instead)


---

## 5. Design-system decisions

Tokens live in `app/globals.css` as CSS custom properties, exposed to Tailwind v4
through `@theme inline`. Nothing else in the codebase should introduce a colour.

**Palette.** Cream paper (`--paper`), near-black ink (`--ink`), one green ramp
(`--brand-50…900`). The green is used **only** for actions, active states and
confirmations. Deliberately: when everything is coloured, nothing is a call to
action. Semantic `success` / `warning` / `danger` are separate from brand so a
green "in stock" badge is never confused with a green button.

**Typography.** Bricolage Grotesque for display, Inter for text, JetBrains Mono
for money, codes and counts. Money is monospaced and tabular so that a column of
prices aligns and does not shimmer while it updates — this matters on the cart
and earnings screens.

**Shape.** Three radii only: `--radius-control` (10px) for inputs and buttons,
`--radius-card` (14px), `--radius-sheet` (20px) for sheets and dialogs. Nothing
is a pill except genuine chips and the search field. The brief's warning about
childish over-rounding is taken literally.

**Elevation.** Two shadows. `shadow-soft` (barely there) and `shadow-lift` (for
things that actually float). Borders do most of the separation work — the design
is line-led, not shadow-led.

**Touch targets.** 44px floor. `Button` `md` is 44px, `lg` is 48px; `sm` (36px) is
restricted to dense admin tables where a mouse is a given.

**Motion.** All transitions are wrapped in a `prefers-reduced-motion` guard in
`globals.css`.

---

## 6. Screens and components redesigned

**Primitives (new or rebuilt):**
`components/ui/button.tsx` (variants incl. two "on-ink" variants, real
`isLoading` that preserves width and blocks double-submit), `field.tsx`
(`Input`, `Textarea`, `Select`, `Field` with accessible error wiring,
`PasswordInput` with an announced visibility toggle, `SearchInput`, `Switch`),
`card.tsx`, `badge.tsx`, `sheet.tsx` (bottom sheet with scroll lock, focus trap,
Escape, safe-area padding), `toast.tsx`, `state.tsx` (`EmptyState`, `ErrorState`,
`GateState`, `Notice`, content-shaped skeletons).

**Marketplace:** `components/marketplace/cards.tsx` — `ProductCard`,
`VendorCard`, `CategoryTile`, bound to the **real** service types from
`lib/products/marketplace-service.ts`, with fixed aspect ratios so a grid never
jumps as images load.

`components/marketplace/discovery-home.tsx` — the §9 discovery home. Built as
horizontally-scrolling rails rather than a grid: a rail says "there is more where
this came from" in one row of vertical space, where a 12-item grid on a 375px
screen says nothing and costs six. Every section is guarded on `length`, so a
quiet campus shows fewer sections rather than empty boxes (§28).

**Screens:**
- `app/page.tsx` — the landing page, built from scratch. Hero, an order-sequence
  visual that teaches the delivery-code model, five-step "how it works",
  categories, the student-delivery concept, trust, three role doors, closing CTA.
- `app/(auth)/layout.tsx` — split shell; brand panel from `lg` up only.
- `app/(auth)/sign-in/page.tsx` — full error taxonomy, network catch,
  show/hide password, loading state, no duplicate submits.
- `components/shell/account-menu.tsx` — **the §6 fix.** Bottom sheet on mobile,
  compact anchored dropdown on desktop, one data source, chosen by media query
  rather than CSS visibility so only one dialog and one focus trap ever exist.
- `components/landing/public-header.tsx`, `components/shell/wordmark.tsx`.

**Honest note on the landing page's numbers.** Every figure is queried live. The
proof strip renders *only* when there are ≥5 vendors and ≥20 products; below that
the copy sells the verification model instead. A landing page claiming "500+
vendors" over a database with four is the fastest way to lose a vendor's trust,
so §27 is applied to marketing copy as well as to product data.

---

## 7. Functionality preserved (deliberately untouched)

Per §2 and §32, none of the following was modified:

- `prisma/schema.prisma` and all migrations
- Better Auth configuration (`lib/auth/*`) — only the *client-side error copy* changed
- Every route under `app/api/**`
- `lib/authorization/campus.ts` and campus isolation
- `lib/payments/*`, Paystack integration, webhook, settlement
- `lib/delivery/*` state machine, handover OTP
- `lib/orders/*`, inventory logic
- `lib/disputes/*`, `lib/ratings/*`, `lib/analytics/*`, `lib/notifications/*`
- `lib/security/*` — rate limits, upload policy, headers, secrets
- All 23 test files under `tests/`

`components/ui/button.tsx` gained variants rather than being replaced, so no
existing caller broke. Business-logic components (`product-browser.tsx`,
`store-manager.tsx`, `dispute-panel.tsx`, …) were left in place to be re-skinned,
not rewritten.

---

## 8. Remaining issues — this work is NOT finished

Stating this plainly, because §34 and §35 forbid a false completion claim.

Priorities 1–3 are done. **Priorities 4–9 are outstanding.**

1. **`ProductCard` links to a page that does not exist.** `/marketplace/[productId]`
   is the destination of every product card and is currently a 404. This is the
   most urgent item in the whole document: the discovery home now works well
   enough to make the dead end obvious. §12 (large image, quantity selector,
   sticky mobile CTA) is unbuilt.
2. **Public vendor storefront does not exist** (§11). `VendorCard` and the
   category tiles resolve to `/marketplace?vendorProfileId=…` — a filtered
   catalogue. Functional, and not a dead link, but it is not a storefront: no
   store header, rating, opening status or delivery estimate.
3. **Sign-up is still a single-page form.** The four-step flow in §13 is not built.
4. **Forgot-password does not exist.** The sign-in page currently links to email
   verification instead, which is honest but incomplete.
5. **Onboarding completion screen** (§15, "You're almost there") is not built.
6. **Cart, checkout, invoice, orders and delivery tracking have not been
   re-skinned.** They inherit the tokens through the primitives, so they are no
   longer actively broken-looking, but the `Discover → Shop → Checkout → Receive`
   spine is only styled through its first two steps.
7. **Vendor, agent, admin and super-admin screens have not been re-skinned.** The
   delivery-agent workflow (§18) in particular still needs to become a guided
   sequence rather than a dashboard.
8. **Bottom navigation is text-only.** It works and fits 320px, but §16 implies
   icons, and it has no cart affordance.
9. **Responsive QA (§25) was reasoned about, not measured.** Layouts were built
   mobile-first with `min-w-0`/`truncate` guards and the routes were confirmed to
   render (`/` → 200, `/sign-in` → 200, `/marketplace` → 307 for anonymous
   visitors), but no screen has been *visually inspected* at 320/375/390/430px.
   This must happen before launch.
10. **Seed data (§27).** `prisma/seed.ts` exists but has not been verified to
    produce a marketplace rich enough to evaluate the UI against. Until it is, the
    discovery home will mostly render its empty state on a local database.

### Suggested next step

Build `app/(app)/marketplace/[productId]/page.tsx` (§12) and
`app/(app)/store/[slug]/page.tsx` (§11). That closes the only dead link the new
marketplace introduces and completes the `Discover → Shop` half of the spine that
§35 names as the primary experience. Then re-skin cart and checkout so the other
half matches.
