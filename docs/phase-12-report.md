# Phase 12 — Analytics & Reporting

PRD §65–68. A Campus Admin can see what their campus actually did, and a Super Admin
can see one campus or all of them.

## What was built

| Area | Files |
| --- | --- |
| Pure policy | `lib/analytics/analytics-policy.ts` |
| Validation | `validations/analytics.ts` |
| Service | `lib/analytics/analytics-service.ts` |
| API | `app/api/admin/analytics/route.ts` |
| UI | `components/admin/analytics-dashboard.tsx`, `app/admin/analytics/page.tsx` |
| Tests | `tests/analytics-policy.test.ts` — 35 cases |

No schema change. Phase 12 is the first phase that adds no columns: every figure is
derived from rows earlier phases were already writing. If a metric had needed a new
column, that would have been a sign the earlier phase recorded too little.

## The decisions worth defending

**Aggregation happens in Postgres, not in Node.** Every figure is a `count`,
`aggregate` or `groupBy`. Pulling rows into the app and reducing them would pass every
test on a seeded database and fall over on a real campus — and it would fail only once
the platform was busy enough for the failure to be expensive.

The two deliberate exceptions are the medians and the daily series. Prisma exposes no
portable median, and it cannot `GROUP BY date_trunc(...)` without raw SQL. Both
exceptions read a narrow projection — three date columns, or three scalars — and the
median reads are capped with `take`. A raw query would have had to splice the campus
filter in by hand, which is exactly the code path where campus isolation gets
forgotten (Rule 25).

**Every query is scoped through `campusScope`, and each `where` is typed against its
own model.** There are ten one-line `scopeX` helpers instead of one generic helper over
`Record<string, unknown>`. The generic version compiles happily with a misspelt field
or a status that is not in the enum, and **a reporting bug that returns plausible
numbers is the hardest kind to notice** — nobody files a ticket about a figure that
looks reasonable.

**A missing metric renders as a dash and a sentence, never as a zero.** A campus with
no concluded deliveries has no success rate; printing "0%" would be a lie about a
number that does not exist yet. Every rate and average in the policy layer returns
`null` for an empty denominator, and the component turns `null` into "—" plus an
explanation.

**Completed work is measured, not placed work — except for demand.** Revenue counts
vendor orders that reached `COMPLETED`, because a cancelled order earned nothing.
Order *volume* counts what students did, because demand is real whether or not it
converted. The daily series carries both on separate keys for the same reason: a
cancelled order is a bar on the orders axis and nothing on the value axis.

**Delivery fees are read from `Payment`, not from the order.** A fee is revenue once
it was captured. Reading it off the order would count fees for deliveries nobody paid
for. And it is filtered on `paidAt`, not `createdAt`: a fee initiated in July and paid
in August belongs to August, because August is when the money existed.

**Refunds are netted against the platform's own share only.** `platformEarnings`
subtracts `refundedFromPlatformKobo` — the figure Phase 11's `attributeRefund`
produced. A vendor's share of a refund is the vendor's loss; charging it against
platform earnings would understate the platform and flatter the vendor.

**Net platform earnings may be negative, and the type says so.** `netPlatformKobo` is
a plain `number`, not `Kobo`, because a period in which refunds exceeded commission is
a real period. `formatKobo` still rejects negatives for every other caller; the sign
is carried by a local `formatSignedKobo` rather than by weakening the shared formatter.

**Times are medians, not means.** One parcel left in a hostel overnight would drag an
average delivery time far enough to make it useless. `medianMs` also copies its input
before sorting, so a caller's array is not mutated as a side effect of being measured.

**Comparisons are to the immediately preceding window of equal length.** `previousRange`
derives it from the current range rather than from "last month", so a 9-day range is
compared with the 9 days before it. `changeRatio` returns `null` when the previous
period was zero: "up 100%" from nothing is not a growth rate, and the UI says "No
prior period" instead of inventing one.

**Ranges are half-open, and the display end is not the query end.** The internal bound
is the start of the day *after* the requested end, which is the only way to include
everything that happened on the last day. Showing that raw would label an August report
"1 Aug – 1 Sep", so a millisecond is subtracted for display only. The arithmetic never
sees that value.

**The range is capped at 366 days in validation.** The daily series allocates one
bucket per day and the order read is unbounded within the window, so the cap is what
keeps an admin from turning a URL into a table scan of all history. If a campus ever
outgrows a year of buckets, the answer is a nightly rollup table, not a wider cap.

**A rejected cross-campus request does no database work.** `campusScope` is called once
at the top of `getCampusDashboard`, before the concurrent reads start, so an admin
asking for someone else's campus is refused without a query.

**No chart library.** Recharts would add ~90KB to a page whose job is to show thirty
numbers, and this is the audience most likely to be on a phone paying for its own data
(PRD §12). The daily trend is a row of divs whose heights are proportions. Days with no
trading are rendered as a thin bar rather than omitted, so a quiet week reads as a quiet
week rather than silently compressing the timeline.

**Leaderboard ties are broken by name, not by insertion order.** `rankDescending`
sorts by value then label, so two stores on identical revenue do not swap places
between refreshes for no reason.

## Agent standings — Phase 10's deferred screen

Phase 10 collected agent ratings and deliberately built no screen for them: showing a
courier's score to the student about to meet them invites refusing an agent. An admin
needs it — it is the first thing to look at when a complaint arrives — so the agent
view landed here, with three decisions worth naming:

- **Ranked by deliveries completed, not by score.** Sorting on rating puts an agent
  with one five-star trip above one with two hundred at 4.8, which tells an admin
  nothing about who is carrying the campus.
- **The rating average is re-derived from the stored `count` and `sum`,** not read from
  `ratingAverageHundredths`. That column exists so "top rated" can be an indexed sort;
  re-deriving here means a drifted column shows up as a disagreement instead of being
  reported as fact.
- **`agentProfileId` is nullable, so the grouping filters it out.** A pooled delivery
  has no agent yet; grouping without the filter would produce a phantom "unassigned
  agent" row at the top of the table. The profile read is scoped again even though the
  ids came from an already-scoped query — an id list is not an authorization check.

The two flags an admin should not have to hunt for are inlined next to the name:
`(under review)` for a Rule 27 escalation, and `(off duty)` for someone not currently
reachable.

## Verification

- `tsc --noEmit` — clean
- `eslint .` — clean
- `vitest run` — 279 tests, 17 files, all passing (35 new)
- `next build` — passing, `/admin/analytics` and `/api/admin/analytics` both present
- `prisma generate` run before typecheck, per Phase 11's lesson
