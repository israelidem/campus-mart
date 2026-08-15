# Phase 9 — Notifications & PWA

**Status:** complete. 178 tests pass; `tsc --noEmit` and ESLint are clean.

Phase 9 gives Campus Mart a voice. Until now every state change was silent: a
vendor learned about an order by refreshing, and a student learned their agent had
arrived by standing outside guessing. This phase adds a recorded inbox, web push
for the moments that cannot wait, and the PWA shell that makes push possible at
all.

---

## 1. What was built

### The notification catalogue — `lib/notifications/messages.ts`

Every message the platform can send lives in one file, as a pure function of its
facts. This is the phase's most important structural decision: copy, audience and
destination link are product decisions, and they are now all readable in one
place instead of scattered across a dozen service functions.

Two invariants hold throughout:

1. **Messages are rendered at send time and then stored.** A store that renames
   itself next week must not rewrite what a student was told today.
2. **`href` is always a relative path.** A stored absolute URL breaks the moment
   the domain changes.

The renderers are a `Record<NotificationType, …>` rather than a `switch`. Adding
an enum value without writing its copy now fails to compile — the only reliable
way to stop a blank notification reaching a phone.

### Push-worthiness

Everything is recorded; only a rationed subset also becomes a push. The test is
"would this person want to be interrupted while doing something else":

| Pushed | Recorded only |
| --- | --- |
| `ORDER_PLACED` — a vendor with an unaccepted order | `VENDOR_ORDER_PREPARING` |
| `DELIVERY_AVAILABLE` — agents deciding whether to work | `DELIVERY_POOLED` |
| `DELIVERY_ARRIVED` — someone is standing at a door | `VENDOR_ORDER_READY` |
| `HANDOVER_VERIFIED` — a payment window is running | `DELIVERY_ACCEPTED` |
| `DELIVERY_RETURNED` / `DELIVERY_CANCELLED` | `DELIVERY_PICKED_UP` |
| `APPLICATION_REVIEWED` | `PAYMENT_SETTLED` |

### Fan-out — `lib/notifications/notification-service.ts`

`notify()` takes a type, a list of recipients and a bag of facts, writes one row
per recipient, then pushes to the subscriptions of whoever is push-worthy. It is
called from the named operations in `lib/orders`, `lib/delivery` and
`lib/payments` — never from a route handler, so an operation triggered by cron
notifies exactly as one triggered by a request.

**A push may never fail an operation.** The notification's record is the database
row; the push is a copy. A copy that does not arrive must not roll back a delivery
someone has already handed over.

### Push transport — `lib/notifications/push.ts`

The only file that knows a push service exists. Its real content is what a failure
*means*:

- **404 / 410** — the browser discarded the subscription. It will never work
  again, so the row is deleted rather than retried forever.
- **413** — our payload is too large. Our bug; retrying is pointless.
- **429 / 5xx / no status** — the service is busy or unreachable. The device is
  probably fine, so the row is kept and the failure counted.

Getting this wrong is invisible either way: too eager and real users are silently
unsubscribed whenever a push service wobbles; too lax and dead endpoints are
pushed to until the end of time. `classifyPushFailure` is pure and directly
tested.

Push is *optional infrastructure*. With no VAPID keys, the deployment logs once
and runs with in-app notifications only — a deliberate degradation, not an error.

### The PWA shell

- `app/manifest.ts` — installable metadata, standalone display, campus colours.
- `public/sw.js` — network-first for navigations with an offline fallback,
  cache-first for static assets, plus the `push` and `notificationclick`
  handlers. Tapping a notification focuses an existing tab rather than opening a
  fifth copy of the app.
- `app/offline/page.tsx` — the fallback, which explains what still works.
- `lib/notifications/push-client.ts` — VAPID key conversion, registration and
  subscription, kept away from the components.

### UI

- `components/notifications/notification-bell.tsx` — the polled bell and panel.
- `components/notifications/notification-menu.tsx` — server wrapper that supplies
  the first inbox, so the badge is correct in the first byte of HTML and renders
  nothing at all for a signed-out visitor.
- `components/notifications/push-opt-in.tsx` — the opt-in, which also registers
  the service worker.
- `app/notifications/page.tsx` — full history plus the per-device setting.

**Polling, not sockets.** The platform's news arrives in minutes, not
milliseconds. One cheap request a minute serves a campus on patchy 3G better than
a connection that keeps dropping, and push already covers the urgent case when the
app is closed. Polling pauses while the tab is hidden and catches up the instant
it returns.

---

## 2. Files

**New**

```
prisma/migrations/20260815200500_phase_9_notifications_push/migration.sql
lib/notifications/messages.ts
lib/notifications/notification-service.ts
lib/notifications/push.ts
lib/notifications/push-client.ts
validations/notification.ts
app/api/notifications/route.ts
app/api/notifications/[notificationId]/read/route.ts
app/api/notifications/subscribe/route.ts
app/api/cron/sweep/route.ts
app/manifest.ts
app/offline/page.tsx
app/notifications/page.tsx
public/sw.js
public/icon.svg
public/icon-maskable.svg
components/notifications/notification-bell.tsx
components/notifications/notification-menu.tsx
components/notifications/push-opt-in.tsx
tests/notification-messages.test.ts
```

**Changed**

```
prisma/schema.prisma            Notification, PushSubscription, NotificationType
lib/env.ts                      VAPID keys, CRON_SECRET
lib/api/client.ts               apiDelete now accepts a body
lib/orders/order-service.ts     notify() on placement and vendor transitions
lib/delivery/delivery-service.ts notify() on pool, accept, pickup, arrival, handover
lib/payments/payment-service.ts notify() on settlement
app/layout.tsx                  manifest + theme colour
app/marketplace/layout.tsx      bell in header
app/vendor/layout.tsx           bell in header
.env.example                    VAPID_*, CRON_SECRET
```

---

## 3. Tests

`tests/notification-messages.test.ts` — 16 cases over the two pure decisions:

- Every enum value renders, with a non-empty title and body and no `undefined`
  or `NaN`, even with no facts at all.
- Every `href` is relative.
- Money is formatted from kobo *by the catalogue*, so no caller can pass naira
  and understate a bill by 100×.
- `DELIVERY_AVAILABLE` stays anonymous — it fans out to every available agent on
  campus, so a reference or store name there would be a privacy leak (PRD §38).
- Reasons append cleanly, with no orphaned punctuation when absent.
- 404/410 delete; 413, 429, 5xx and unknown keep the subscription.

---

## 4. Operational notes

- **VAPID keys.** `npx web-push generate-vapid-keys`. Set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
  Without them the app runs with in-app notifications only.
- **The cron sweep** at `/api/cron/sweep` expires stale handover windows and
  prunes read notifications. It authenticates with `CRON_SECRET` and is
  idempotent.
- **Icons are SVG.** They scale to every launcher size from one file. Replace
  them with raster PNGs before launch if the brand mark gains detail.
- **Push is per-device, not per-account.** The same person on a laptop and a
  phone has two genuinely separate answers, which is why the opt-in copy says
  "this device".

---

## 5. Known gaps

- **No delivery receipts.** We know a push was accepted by the service, not that
  it was shown. Web push offers no reliable read receipt.
- **No notification preferences beyond on/off.** PRD §55 fixes the push-worthy
  set; per-type opt-outs would need a preferences table.
- **iOS requires installation.** Safari only delivers push to a PWA added to the
  home screen. The opt-in handles the resulting `unsupported` state, but the
  onboarding copy does not yet explain the install step.
- **No digesting.** Ten orders in a minute means ten pushes to a vendor. The
  `tag` groups them on the lock screen but does not batch the sends.
