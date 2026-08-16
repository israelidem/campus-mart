# Phase 10 — Ratings & Reviews

PRD references: §24 (marketplace sorting), §57–59 (rating a completed delivery,
the edit window, moderation).

## What this phase is for

Up to Phase 9 a student could find a store, buy from it, receive the goods and be
told about every step — but nothing they learned in the process was ever recorded
anywhere another student could see it. The marketplace could sort by price and by
distance, which are properties of a listing, and by nothing at all that reflects
whether the last twenty buyers were actually served well.

Phase 10 closes that loop. A completed delivery earns the student the right to say
two things: how the store did, and how the agent did. Those statements are
aggregated into numbers the marketplace can sort on, and are moderated by campus
admins because a reputation system with no remedy for abuse is a weapon.

## The shape of the feature

### One delivery, two subjects

A rating hangs off a **delivery**, not an order and not a product.

An order can span two stores, which is two hand-overs by (possibly) two different
agents. A student may have been served beautifully by one and badly by the other,
so a single order-level score would force them to average two unrelated
experiences into one meaningless number, and would rob the well-performing store
of the credit.

Each completed delivery therefore opens exactly two rating slots:

| Subject          | What it is about                                          |
| ---------------- | --------------------------------------------------------- |
| `VENDOR`         | the goods and the store: right items, condition, packing   |
| `DELIVERY_AGENT` | the courier: speed, care, conduct at the hand-over         |

The agent slot only exists when a delivery actually had an agent. A vendor
self-delivery has no courier to rate, and offering an empty slot would invite a
score for a person who does not exist.

### Only a completed delivery may be rated

`isRateableDeliveryStatus` allows exactly one status: `COMPLETED`.

`COMPLETED` is the state a delivery reaches after the OTP hand-over was verified
(Phase 7) *and* the goods were paid for (Phase 8). It is the only status that
proves the transaction happened end to end.

`RETURNED` and `CANCELLED` are deliberately excluded. Nothing was received, so a
score would be an opinion about an argument rather than a report of a
transaction — and an argument is what Phase 11's dispute flow is for. This also
removes the obvious griefing route: place an order, cancel it, leave a one-star
review.

### Whole stars only

Scores are integers 1–5. `isValidScore` rejects `4.5`, `NaN` and `Infinity`.

Half stars are refused at the boundary rather than rounded, because a value the
UI can produce but the aggregate cannot represent exactly is a bug waiting for a
report about "the average is wrong".

### The 24-hour edit window

A student may change a rating for 24 hours, measured from when it was **first
given** — not from the last edit.

Measuring from the original keeps the deadline real: if each edit reset the clock,
a rating could be edited forever and the window would be decorative. The window
itself exists because a rating is a report of *one delivery*: a store that
improves next month should not be able to lean on a buyer to rewrite last month's
account of it.

`EDIT_WINDOW_HOURS` is platform policy, not a campus setting. A campus that could
extend it indefinitely would effectively be able to reopen its own reviews.

A rating an admin has hidden is frozen even inside the window: a moderation
decision is not something the author may edit away.

### Aggregates are stored as sum + count

Every rated subject carries three numbers: `ratingCount`, `ratingSum` and
`ratingAverageHundredths`. The first two are the truth; the third is derived.

Storing the sum means the average can be recomputed *exactly* after any change —
a new rating, an edit, a hide, a restore. Storing only a rounded average would
accumulate error with every single rating, and the error would be permanent.

`averageHundredths` is an integer: 450 means 4.50 stars. Rounding is half-up on
the integer quotient, not `Math.round` on a float, so three ratings of 4, 4 and 5
land on exactly 433 rather than 432.9999….

The transition helpers are total and defensive:

- `applyNewRating` — sum **and** count go up.
- `applyEditedRating` — sum moves by the delta, **count does not change**. An edit
  is a correction, not a second opinion.
- `applyRemovedRating` — used when an admin hides a rating. Clamped at zero: if a
  stored counter has drifted, an empty aggregate that the next rating rebuilds is
  recoverable, whereas a negative count poisons every later average.
- `applyRestoredRating` — the exact inverse of removal, so a hide/restore cycle is
  a no-op. There is a test that runs five cycles and asserts the aggregate is
  byte-identical to the baseline.

`formatAverage` returns `null` — not `"0.0"` — for a subject with no ratings. A new
store has no reputation, which is not the same thing as a bad one, and forcing
callers to handle `null` stops that lie from reaching a screen.

## Files

### Policy (pure)

- **`lib/ratings/rating-policy.ts`** — scores, the rateable status, the edit
  window, and all aggregate arithmetic. No Prisma, no `new Date()` of its own, no
  request context: the clock is always a parameter. This is what makes the
  arithmetic the marketplace sorts on exhaustively testable, and stops it drifting
  between the write path, the moderation path and the display.

### Validation

- **`validations/rating.ts`** — Zod schemas for submitting, editing and moderating.
  Comments are optional, trimmed, length-capped, and normalised to `null` when
  blank so "  " and "" cannot become two different stored values.

### Service

- **`lib/ratings/rating-service.ts`**
  - `getDeliveryRatingState` — what the student may do right now: is this delivery
    rateable, which subjects exist, what have they already said, and how long they
    have left. Ownership of the delivery is re-verified here rather than trusted
    from the caller; a service that trusts its caller has stopped being a security
    boundary.
  - `submitRating` / `updateRating` — both run inside a transaction that writes the
    rating row and moves the subject's aggregate in the same commit, so a rating
    and the average it produced can never disagree.
  - `listRatingsForModeration` / `setRatingHidden` — the admin path, campus-scoped,
    audit-logged, and aggregate-adjusting.

### API

| Route                                     | Who        | Why                              |
| ----------------------------------------- | ---------- | -------------------------------- |
| `GET /api/deliveries/[deliveryId]/ratings`| student    | what may I rate, and what did I say |
| `POST /api/ratings`                       | student    | submit                           |
| `PATCH /api/ratings/[ratingId]`           | student    | edit inside the window           |
| `GET /api/admin/ratings`                  | admin      | moderation queue                 |
| `POST /api/admin/ratings/[ratingId]/hide` | admin      | hide / restore                   |

### UI

- **`components/ratings/star-rating.tsx`** — one control, two modes. Read-only it is
  plain text plus stars; interactive it is a radio group, so it is keyboard- and
  screen-reader-navigable rather than a row of clickable spans.
- **`components/ratings/delivery-rating-panel.tsx`** — renders **nothing** unless the
  server said the delivery is rateable. The server decides; the client only draws.
- **`components/admin/rating-moderation-list.tsx`** + **`app/admin/ratings/page.tsx`** —
  the campus queue, with the reason for hiding required.
- **`app/orders/[orderId]/page.tsx`** — the panel appears on the same row as the
  delivery it is about, for the reason given above: one delivery, one verdict.

### The marketplace, finally sortable by reputation

Phase 4 shipped the marketplace with a note in the code that "sorting by rating
is intentionally not offered: ratings do not exist until Phase 10". That note is
now paid off.

- **`TOP_RATED` sort** — orders by the selling store's `ratingAverageHundredths`,
  then by `ratingCount`, then by `id`. The count is the tie-breaker so a store
  with a single 5-star rating does not outrank one with forty; the `id` keeps
  pagination stable, which every other sort already did.
- **`minRating` filter** — a whole-star floor (1–5), compared in stored hundredths
  so "4 stars and up" is `>= 400` and a store averaging 3.99 is correctly out.
  It is opt-in and never a default, because *any* floor excludes stores nobody
  has rated yet, and a new vendor should not be invisible by default.
- **Both constraints go into one nested `vendorProfile` filter.** Adding a second
  `vendorProfile` key to the same object would leave Prisma with only the last
  one, silently dropping "approved stores only" — the more important of the two
  rules. There is a test asserting both survive together, precisely because that
  failure would be invisible.
- **Ratings are displayed by the shared `RatingBadge`**, on the browse card and the
  product detail page, both attached to the *store* rather than to the item — the
  score was earned by a delivered order, and pinning it to one product would claim
  a precision the data does not have.
- **The average is formatted once, in the service.** No component knows that the
  store is 433 hundredths, so no two screens can disagree about "4.3".

### Tests

**`tests/rating-policy.test.ts`** — 20 tests covering: whole stars only; every
non-`COMPLETED` status refused; the window open at the deadline and shut one
millisecond later; the window measured from creation not last edit; hidden
ratings frozen; half-up rounding at the values where floats misbehave; edits
moving the sum but not the count; the last rating hidden emptying the aggregate;
a drifted aggregate clamping instead of going negative; and a five-times
hide/restore cycle leaving the aggregate exactly where it started.

**`tests/marketplace-query.test.ts`** — 9 new tests on the rating sort and filter:
the approval rule surviving alongside a rating floor, the floor compared in
hundredths, unrated stores excluded by a floor but never by default, `TOP_RATED`
ordering on average then count, the `id` tie-break present on the new sort too,
and the query string rejecting 0, 6 and 4.5 stars.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint . --max-warnings=0` — clean.
- `npx vitest run` — 15 files, 207 tests, all passing.
- `npx next build` — succeeds (all 5 rating routes and `/admin/ratings` present in
  the route manifest).

### One thing fixed along the way

`web-push` and `@types/web-push` were listed in `package.json` by Phase 9 but had
never been installed, so `lib/notifications/push.ts` failed to typecheck. Running
`npm install` resolved it. Worth noting because it means Phase 9's typecheck could
not have been clean on a fresh clone.

## Deliberate deferrals

- **Rating reminders.** A student who forgets to rate is not nudged. The
  notification machinery from Phase 9 could do it, but a reminder for something
  optional is close to nagging, and it is better decided with real data on how
  many people rate unprompted.
- **Vendor/agent replies.** A store cannot respond to a review. A reply is a
  second voice in a record that is currently one person's report of one delivery,
  and it needs its own moderation story.
- **Score-based suspension.** A persistently badly-rated store is visible to an
  admin but nothing happens automatically. Automatic suspension on an average is
  exactly the kind of rule that punishes a store for one bad week, and the
  admin-facing numbers are enough to act deliberately.
- **Agent ratings are not surfaced anywhere yet.** They are collected, aggregated
  and moderated exactly like vendor ratings, and the `AgentProfile` carries the
  same three columns plus an index — but no screen reads them. Showing a courier's
  score to the student who is about to be met by them is a design question (it
  invites refusing an agent), and showing it in the admin agent list is Phase 12's
  analytics work. The data is correct and waiting.
- **Individual reviews are not listed publicly.** A store's page shows the average
  and the count, not the comments. Displaying free text to strangers needs the
  moderation queue to be habitually watched, which is a pilot-time operational
  question, not a code one.
