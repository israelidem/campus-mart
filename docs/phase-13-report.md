# Phase 13 — Security hardening

**PRD Part X · Rate limiting, upload safety, response headers, secret comparison, campus-isolation audit**

## What this phase was for

Phases 1–12 built the platform's rules: who may do what, in what order, with whose
money. Those rules are all *correct* and all *bypassable by volume*. A six-digit
hand-over code is 900,000 possibilities and a strong guard against a person; against
a script making 50 requests a second it is about five hours. Nothing in the codebase
before this phase stopped that script.

Phase 13 is the layer that assumes an attacker rather than a user: it bounds how often
anything can be attempted, stops an upload lying about what it is, tells the browser
what to refuse, and removes the last secret comparison that leaked its own contents
through timing. It ends with a written audit of Rule 2, because "campus isolation is
absolute" is a claim that has to be checked rather than asserted.

## Rate limiting

### Why Postgres and not an in-memory map

The obvious implementation is a `Map` keyed by user id. It is also useless here: the
platform runs on serverless functions, so each instance gets its own map, and an
attacker who opens ten connections gets ten separate allowances. Worse, the map looks
like it works in development, where there is one process.

The counter therefore lives in the database — the one thing every instance shares.
`lib/security/rate-limit.ts` does one atomic upsert per check:

```sql
INSERT INTO "RateLimitCounter" ("key", "hits", ...) VALUES ($1, 1, ...)
ON CONFLICT ("key") DO UPDATE SET "hits" = "RateLimitCounter"."hits" + 1
RETURNING "hits"
```

`RETURNING hits` is what makes this correct. The count comes back from the same
statement that incremented it, so there is no read-then-write window in which two
instances both see 9 and both allow the tenth. The policy then judges a number that
is already final — which is why `evaluate()` takes `hits` *after* the increment and
allows `hits <= limit` rather than `hits < limit`.

### Why a fixed window

`lib/security/rate-limit-policy.ts` uses a fixed window whose index is part of the
counter's key. That has one known weakness — an attacker can spend a full allowance at
the end of one window and again at the start of the next — and one decisive advantage:
a new window is a *new row*, so nothing ever has to decide whose job it is to reset a
counter to zero. A sliding window would need a sorted set of timestamps per key and a
read before every write.

The weakness was weighed rather than ignored. Twice the limit for one instant is 40
code submissions instead of 20; against 900,000 possibilities that is not a
meaningful change in the attacker's position.

### Why user *and* IP

Every limit that can be keyed by both is checked against both, because they describe
different attackers:

- **User only** misses credential stuffing and mass sign-up, where there is no account
  yet.
- **IP only** punishes a campus behind one NAT — 3,000 students sharing an address —
  and misses an attacker with one account and a mobile connection that rotates.

`lib/security/request-identity.ts` resolves the address, and returns `null` rather
than `"unknown"` when it cannot. That choice matters: a shared placeholder is a shared
bucket, so one attacker stripping headers would exhaust the allowance of every caller
whose address was also unknown. Null means that scope is skipped and the user-scoped
limit still applies.

Header precedence is deliberate. `x-vercel-forwarded-for` is set by the edge from the
connection it terminated; `x-forwarded-for` is last because any client can send it. If
the forgeable one won, an attacker would simply mint a fresh key per request.

Addresses are normalised before being used as keys — `::ffff:203.0.113.7` folds to its
IPv4 form, IPv6 is lower-cased, leading-zero octets are rejected — so one client is
one bucket. Anything unrecognisable is refused outright, because an attacker who
controls the header would otherwise control an unbounded key space, which is a way to
write unbounded rows.

### What is limited, and what is not

| Action | Limit | Why this number |
| --- | --- | --- |
| `HANDOVER_CODE_VERIFY` | 20 / 10 min | The sharpest one. Five wrong codes already kill a code; this stops the *conversation* — issue, fail five, reissue. A real hand-over takes one to three. |
| `HANDOVER_CODE_ISSUE` | 10 / 10 min | Reissuing resets the per-code attempt counter, so a generous budget here reopens what verify closes. Asserted in the tests to never exceed the verify limit. |
| `AUTH_CREDENTIALS` | 10 / 5 min | Credential stuffing. Better Auth has its own limiter; this one is ours and is IP-scoped, since there is no account yet. |
| `STUDENT_REGISTRATION` | 5 / hour | Registration writes a profile and consumes a registry entry. |
| `PAYMENT_INITIATION` | 12 / 10 min | Each call writes a `Payment` row and spends Paystack quota. Abandoning checkout twice is normal; 200 initialisations is probing. |
| `PAYMENT_VERIFICATION` | 60 / 10 min | A read the client polls after checkout, so deliberately looser than initiation. |
| `DOCUMENT_UPLOAD` | 30 / hour | Each upload is 5 MB of storage. |
| `DISPUTE_FILING` | 10 / hour | Each dispute is admin work. |
| `RATING_SUBMISSION` | 30 / hour | The uniqueness constraint caps how many can exist; this caps rewrites, since each one updates aggregate columns the marketplace sorts by. |

Two things are deliberately **not** limited:

- **The Paystack webhook.** The only key available would be the IP, and Paystack's
  addresses are shared and undocumented, so a limit tight enough to matter would drop
  real settlement events. A forged event cannot pass the HMAC, so an unsigned flood
  costs one hash — and the new 64 KB body cap bounds what that hash runs over.
- **The cron sweep.** Guarded by a shared secret, and a scheduler calling twice is not
  abuse.

Limits are keyed by user and IP, never by campus. A campus-keyed limit would let one
abusive account consume its whole campus's allowance — a security control turned into
a denial of service against 3,000 students.

## Upload hardening

The sniffing that existed before this phase asked the wrong question: *do the magic
bytes match the type the client declared?* That answers "yes" for a browser that
guessed wrong about a perfectly good file, and "yes" for an attacker who declared
honestly. Both outcomes were wrong.

`lib/security/upload-policy.ts` inverts it. **The bytes decide the type; the declared
type is consulted only to catch a lie.** What gets stored, and what later appears in
`Content-Type`, is the sniffed value — a request header never becomes a response
header.

Order within `assertAcceptableUpload` is load-bearing: size first (cheapest, and the
thing an attacker makes expensive by omitting), then sniff, then compare. A declared
type that is empty or nonsense is *ignored* rather than fatal, because
`application/octet-stream` is what browsers send for files they do not recognise and
punishing that would break honest uploads.

The allow-list is four formats. SVG is absent on purpose: it is a valid image that can
carry script, and served same-origin that is stored XSS. WebP requires both halves of
its signature, since "RIFF" alone is also AVI and WAV.

`safeContentType` runs on the way *out* as well as in, so a row written before this
phase cannot turn a stored string into a served content type — anything unrecognised
becomes `application/octet-stream`, which browsers download rather than render. PDFs
are served as attachments rather than inline, because an inline PDF gets a same-origin
script context it does not need.

## Response headers

`lib/security/headers.ts` holds the policy as pure functions and `next.config.ts` is
now only wiring. The reason is testability: headers are the easiest security work to
*appear* to have done — a list of strings, nothing breaks when one is dropped, and
nothing tells you. `tests/security-headers.test.ts` is what notices.

The CSP's central decision is that `script-src` does **not** carry `'unsafe-inline'` in
production. That is the directive the whole header exists for; with inline script
allowed, an injected `<script>` runs and the rest is decoration. `'unsafe-inline'`
appears in `style-src` and nowhere else, accepted because injected CSS cannot execute
and a nonce scheme for styles would mean giving up static rendering.

Two directives exist to keep the product working, and are tested for that reason:
Paystack must stay reachable in `form-action`, `connect-src` and `frame-src`, and the
service worker needs `worker-src 'self'`. A CSP that breaks payments does not survive
first contact with an on-call engineer, and then there is no CSP at all.

Development differs in three controlled ways — `'unsafe-eval'` for Turbopack's HMR
client, `ws:` for its socket, and no `upgrade-insecure-requests` — each gated on the
flag so the convenience cannot ship. HSTS is production-only for a specific reason:
sent from localhost it would pin the developer's browser to HTTPS for `localhost`, for
two years, across every project on the machine.

## Secret comparison

`app/api/cron/sweep/route.ts` compared its secret with `!==`. String comparison stops
at the first differing byte, so its duration reveals how many leading characters
matched — enough to recover a secret one character at a time, a search that is linear
rather than exponential in its length.

The platform already did this correctly for the Paystack HMAC and the hand-over code.
`lib/security/secrets.ts` lifts that shape into one place and the cron route now uses
it. Two details carry weight: the length check runs *before* `timingSafeEqual` (which
throws rather than returning false on differing lengths — unguarded, a wrong-length
guess becomes a 500, which is itself an oracle), and empty values never match, so an
unset secret compared against an absent header cannot be "equal".

## Campus-isolation audit

`docs/campus-isolation-audit.md` walks every route and names what enforces Rule 2. It
found **no missing filters**, which is the expected outcome of twelve phases that all
took `actor` as the first argument rather than an id — but an audit that was never
written down is not an audit, and the standing risks section says plainly where the
guarantee rests on convention rather than on the type system.

## Files

**New**

- `lib/security/rate-limit-policy.ts` — windows, keys, verdicts. Pure, clock-free.
- `lib/security/rate-limit.ts` — the atomic Postgres counter and `enforceRateLimit`.
- `lib/security/request-identity.ts` — client IP resolution and normalisation.
- `lib/security/upload-policy.ts` — sniff-first upload verdicts, safe outbound types.
- `lib/security/headers.ts` — CSP and response headers as data.
- `lib/security/secrets.ts` — timing-safe comparison.
- `prisma/migrations/20260821223000_phase_13_rate_limits/migration.sql`
- `tests/rate-limit-policy.test.ts`, `tests/request-identity.test.ts`,
  `tests/upload-policy.test.ts`, `tests/security-headers.test.ts`,
  `tests/secrets.test.ts` — 86 tests.
- `docs/campus-isolation-audit.md`

**Changed**

- `prisma/schema.prisma` — `RateLimitCounter`.
- `next.config.ts` — headers now come from the policy module.
- `lib/storage/storage.ts` — upload path delegates to the new policy.
- Eleven routes wired to `enforceRateLimit`; two file-serving routes hardened;
  the webhook capped; the cron secret made timing-safe.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 379 tests across 23 files, all passing.
- `npx eslint .` — clean.
- `npx next build` — succeeds.

## What Phase 14 inherits

1. **The counter table needs sweeping.** Expired rows are dead but not deleted;
   `expiresAt` is indexed for exactly this. It belongs in the existing cron sweep.
2. **`no-store` on product images costs real bandwidth.** Correct for documents,
   expensive for a marketplace grid. Signed, time-limited URLs are the fix — and the
   fix belongs in Phase 14, not in a weakened header here.
3. **The limits are constants, not campus settings.** If one campus turns out to need
   different numbers, `RATE_LIMITS` is the single place to change, but nothing yet
   reads them per campus.
4. **Better Auth's own limiter and ours overlap** on credentials. Both are cheap and
   they fail in the same direction, so the redundancy was left rather than tuned.
