import {
  averageOrderValue,
  changeRatio,
  countOrZero,
  elapsedMs,
  medianMs,
  platformEarnings,
  previousRange,
  rangeDays,
  rankDescending,
  rate,
  // Aliased: the schema has a column of the same name, and deriving the average
  // from `count` + `sum` here is what catches a drifted stored column instead of
  // reporting it.
  ratingAverageHundredths as deriveRatingAverage,
  resolveDateRange,
  sumOrZero,
  type DateRange,
} from "@/lib/analytics/analytics-policy";

import type { Actor } from "@/lib/auth/session";
import { campusScope } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Kobo } from "@/lib/money";
import { toRangeDates, type AnalyticsDashboardQuery } from "@/validations/analytics";

/**
 * Analytics service (PRD §65–68, Phase 12).
 *
 * Every query here goes through `campusScope`, which is the only reason a Campus
 * Admin's dashboard cannot be turned into another campus's dashboard by editing a
 * URL (Rule 25). A Super Admin gets one campus or all of them, depending on whether
 * they named one.
 *
 * Three structural decisions run through the whole file:
 *
 * **Aggregation happens in Postgres.** Every figure below is a `count`, `aggregate`
 * or `groupBy`. The alternative — pulling rows into Node and reducing them — works
 * on a seeded database and falls over on a real one, and it would be the kind of
 * failure that only appears once a campus is busy enough for it to matter.
 *
 * **Completed work is measured, not placed work.** Revenue counts vendor orders
 * that reached COMPLETED, because a cancelled order earned nothing. The exception is
 * order *volume*, which counts what students did — that is demand, and demand is
 * real whether or not it converted.
 *
 * **Each `where` is typed against its model.** The scoping helpers below are per
 * model rather than one generic helper over `Record<string, unknown>`: the generic
 * version compiles happily with a misspelt field or a status that does not exist in
 * the enum, and a reporting bug that returns *plausible* numbers is the hardest kind
 * to notice.
 */

// ---------------------------------------------------------------------------
// Typed campus scoping
// ---------------------------------------------------------------------------

type Scope = { actor: Actor; campusId: string | null };

function scopeOrder(scope: Scope, where: Prisma.OrderWhereInput): Prisma.OrderWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeVendorOrder(scope: Scope, where: Prisma.VendorOrderWhereInput): Prisma.VendorOrderWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeOrderItem(scope: Scope, where: Prisma.OrderItemWhereInput): Prisma.OrderItemWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeDelivery(scope: Scope, where: Prisma.DeliveryWhereInput): Prisma.DeliveryWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopePayment(scope: Scope, where: Prisma.PaymentWhereInput): Prisma.PaymentWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeRefund(scope: Scope, where: Prisma.RefundWhereInput): Prisma.RefundWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeDispute(scope: Scope, where: Prisma.DisputeWhereInput): Prisma.DisputeWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeVendorProfile(scope: Scope, where: Prisma.VendorProfileWhereInput): Prisma.VendorProfileWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeAgentProfile(
  scope: Scope,
  where: Prisma.DeliveryAgentProfileWhereInput,
): Prisma.DeliveryAgentProfileWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}
function scopeStudentProfile(scope: Scope, where: Prisma.StudentProfileWhereInput): Prisma.StudentProfileWhereInput {
  return campusScope(scope.actor, where, scope.campusId);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type AnalyticsRangeView = {
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day — the *displayable* end, not the exclusive bound. */
  to: string;
  days: number;
};

export type MetricWithChange = {
  value: number;
  previous: number;
  /** Ratio change, or `null` when the previous period had nothing to compare to. */
  change: number | null;
};

export type OrderMetrics = {
  placed: MetricWithChange;
  completed: number;
  cancelled: number;
  /** Completed ÷ placed, or `null` when nothing was placed. */
  completionRate: number | null;
  averageOrderValueKobo: Kobo | null;
};

export type RevenueMetrics = {
  /** Goods value of completed vendor orders. */
  goodsKobo: Kobo;
  /** Platform commission on those goods. */
  commissionKobo: Kobo;
  /** Delivery fees successfully captured in the period. */
  deliveryFeesKobo: Kobo;
  /** What vendors are owed for those goods. */
  vendorPayoutKobo: Kobo;
  /** Commission + delivery fees. */
  grossPlatformKobo: Kobo;
  /** Refunds attributed to the platform's own share. */
  refundedFromPlatformKobo: Kobo;
  /** Gross minus the platform's refund share. May be negative. */
  netPlatformKobo: number;
  goods: MetricWithChange;
};

export type DeliveryMetrics = {
  created: number;
  completed: number;
  returned: number;
  cancelled: number;
  /** Completed ÷ concluded (completed + returned + cancelled). */
  successRate: number | null;
  /** Typical time from acceptance to hand-over. Median, not mean. */
  medianAcceptToCompleteMs: number | null;
  /** Typical time a delivery waited in the pool before an agent took it. */
  medianPoolWaitMs: number | null;
};

export type DisputeMetrics = {
  filed: number;
  resolved: number;
  live: number;
  /** Disputes filed ÷ vendor orders completed — the quality signal. */
  disputeRate: number | null;
  refundedKobo: Kobo;
};

export type MarketplaceMetrics = {
  activeVendors: number;
  pendingVendors: number;
  activeAgents: number;
  onDutyAgents: number;
  pendingStudents: number;
  approvedStudents: number;
};

export type TopVendor = {
  vendorProfileId: string;
  storeName: string;
  completedOrders: number;
  goodsKobo: Kobo;
};

export type TopProduct = {
  productId: string;
  name: string;
  unitsSold: number;
  goodsKobo: Kobo;
};

export type TopLocation = {
  deliveryLocationId: string;
  name: string;
  deliveries: number;
};

/**
 * An agent's standing.
 *
 * Throughput and reputation together, because either alone misleads: the busiest
 * agent on campus may be the one students complain about, and a flawless 5.00 over
 * two deliveries is not yet evidence of anything.
 */
export type AgentStanding = {
  agentProfileId: string;
  name: string;
  /** Deliveries completed inside the range. */
  completed: number;
  /** Deliveries they accepted and then abandoned, inside the range. */
  cancelled: number;
  /** Completed ÷ (completed + cancelled) for work they took on. */
  successRate: number | null;
  medianAcceptToCompleteMs: number | null;
  /** Lifetime average × 100, or `null` when nobody has rated them. */
  ratingAverageHundredths: number | null;
  ratingCount: number;
  /** Lifetime cancellations — the Rule 27 escalation counter. */
  lifetimeCancellations: number;
  /** True once Rule 27 has put them in front of an admin. */
  underReview: boolean;
  onDuty: boolean;
};


export type DailyPoint = {
  /** `YYYY-MM-DD`. */
  day: string;
  orders: number;
  goodsKobo: Kobo;
};

export type CampusDashboard = {
  range: AnalyticsRangeView;
  campusId: string | null;
  orders: OrderMetrics;
  revenue: RevenueMetrics;
  deliveries: DeliveryMetrics;
  disputes: DisputeMetrics;
  marketplace: MarketplaceMetrics;
  topVendors: TopVendor[];
  topProducts: TopProduct[];
  topLocations: TopLocation[];
  agents: AgentStanding[];
  daily: DailyPoint[];
};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `Date` -> `YYYY-MM-DD` in the server's zone, matching how days are bucketed. */
function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The range as the admin asked for it, with an *inclusive* end.
 *
 * The internal bound is exclusive (start of the next day); showing that raw would
 * label a report "1 Aug – 1 Sep" when it covers August, so a millisecond is
 * subtracted for display only. The arithmetic never sees this value.
 */
function toRangeView(range: DateRange): AnalyticsRangeView {
  const inclusiveEnd = new Date(range.to.getTime() - 1);
  return { from: toDayKey(range.from), to: toDayKey(inclusiveEnd), days: rangeDays(range) };
}

function withChange(value: number, previous: number): MetricWithChange {
  return { value, previous, change: changeRatio(value, previous) };
}

/** The half-open date filter every query below reuses. */
function within(range: DateRange): Prisma.DateTimeFilter {
  return { gte: range.from, lt: range.to };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Order volume and value.
 *
 * Counted by `placedAt`, not `createdAt`: they are the same instant today, but
 * `placedAt` is the field that *means* "a student ordered", and a future draft-order
 * feature would quietly break a report keyed on row creation.
 */
async function loadOrderMetrics(scope: Scope, range: DateRange): Promise<OrderMetrics> {
  const previous = previousRange(range);

  const [placed, previousPlaced, completed, cancelled, completedValue] = await Promise.all([
    prisma.order.count({ where: scopeOrder(scope, { placedAt: within(range) }) }),
    prisma.order.count({ where: scopeOrder(scope, { placedAt: within(previous) }) }),
    prisma.order.count({ where: scopeOrder(scope, { placedAt: within(range), status: "COMPLETED" }) }),
    prisma.order.count({ where: scopeOrder(scope, { placedAt: within(range), status: "CANCELLED" }) }),
    prisma.order.aggregate({
      where: scopeOrder(scope, { placedAt: within(range), status: "COMPLETED" }),
      _sum: { goodsSubtotalKobo: true },
    }),
  ]);

  const completedGoods = sumOrZero(completedValue._sum.goodsSubtotalKobo);

  return {
    placed: withChange(placed, previousPlaced),
    completed,
    cancelled,
    completionRate: rate(completed, placed),
    averageOrderValueKobo: averageOrderValue(completedGoods, completed),
  };
}

/**
 * Money.
 *
 * Goods and commission come from `VendorOrder`, because the split is per store and
 * an order spanning two shops has two commissions. Delivery fees come from
 * `Payment`, because a fee is only revenue once it was actually captured — reading it
 * off the order would count fees for deliveries nobody paid for.
 */
async function loadRevenueMetrics(scope: Scope, range: DateRange): Promise<RevenueMetrics> {
  const previous = previousRange(range);

  const [completedVendorOrders, previousVendorOrders, deliveryFees, refunds] = await Promise.all([
    prisma.vendorOrder.aggregate({
      where: scopeVendorOrder(scope, { createdAt: within(range), status: "COMPLETED" }),
      _sum: { goodsSubtotalKobo: true, commissionKobo: true, vendorPayoutKobo: true },
    }),
    prisma.vendorOrder.aggregate({
      where: scopeVendorOrder(scope, { createdAt: within(previous), status: "COMPLETED" }),
      _sum: { goodsSubtotalKobo: true },
    }),
    prisma.payment.aggregate({
      // `paidAt`, not `createdAt`: a fee initiated in July and paid in August is
      // August's revenue, because August is when the money existed.
      where: scopePayment(scope, { paidAt: within(range), purpose: "DELIVERY_FEE", status: "SUCCESS" }),
      _sum: { amountKobo: true },
    }),
    prisma.refund.aggregate({
      where: scopeRefund(scope, { succeededAt: within(range) }),
      _sum: { fromPlatformKobo: true },
    }),
  ]);

  const goodsKobo = sumOrZero(completedVendorOrders._sum.goodsSubtotalKobo);
  const commissionKobo = sumOrZero(completedVendorOrders._sum.commissionKobo);
  const vendorPayoutKobo = sumOrZero(completedVendorOrders._sum.vendorPayoutKobo);
  const deliveryFeesKobo = sumOrZero(deliveryFees._sum.amountKobo);
  const refundedFromPlatformKobo = sumOrZero(refunds._sum.fromPlatformKobo);

  const earnings = platformEarnings({
    commissionKobo,
    deliveryFeeKobo: deliveryFeesKobo,
    refundedFromPlatformKobo,
  });

  return {
    goodsKobo,
    commissionKobo,
    deliveryFeesKobo,
    vendorPayoutKobo,
    grossPlatformKobo: earnings.grossKobo,
    refundedFromPlatformKobo: earnings.refundedKobo,
    netPlatformKobo: earnings.netKobo,
    goods: withChange(goodsKobo, sumOrZero(previousVendorOrders._sum.goodsSubtotalKobo)),
  };
}

/**
 * Delivery operations.
 *
 * The two medians need per-row timestamps, so this is the one place rows are read
 * rather than aggregated — three date columns, bounded by `take`. Prisma exposes no
 * portable median, and a raw `percentile_cont` would buy exactness at the price of a
 * query the next developer cannot check for campus isolation at a glance.
 */
async function loadDeliveryMetrics(scope: Scope, range: DateRange): Promise<DeliveryMetrics> {
  const [created, completed, returned, cancelled, timings] = await Promise.all([
    prisma.delivery.count({ where: scopeDelivery(scope, { createdAt: within(range) }) }),
    prisma.delivery.count({
      where: scopeDelivery(scope, { createdAt: within(range), status: "COMPLETED" }),
    }),
    prisma.delivery.count({
      where: scopeDelivery(scope, { createdAt: within(range), status: "RETURNED" }),
    }),
    prisma.delivery.count({
      where: scopeDelivery(scope, { createdAt: within(range), status: "CANCELLED" }),
    }),
    prisma.delivery.findMany({
      where: scopeDelivery(scope, { createdAt: within(range), status: "COMPLETED" }),
      select: { pooledAt: true, acceptedAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
      // A sample, capped so one busy campus cannot make the dashboard the slowest
      // page in the app. A median over 500 recent deliveries is not meaningfully
      // less true than one over 5,000.
      take: 500,
    }),
  ]);

  const acceptToComplete: number[] = [];
  const poolWait: number[] = [];

  for (const delivery of timings) {
    const journey = elapsedMs(delivery.acceptedAt, delivery.completedAt);
    if (journey !== null) acceptToComplete.push(journey);

    const wait = elapsedMs(delivery.pooledAt, delivery.acceptedAt);
    if (wait !== null) poolWait.push(wait);
  }

  const concluded = completed + returned + cancelled;

  return {
    created,
    completed,
    returned,
    cancelled,
    successRate: rate(completed, concluded),
    medianAcceptToCompleteMs: medianMs(acceptToComplete),
    medianPoolWaitMs: medianMs(poolWait),
  };
}

/** Dispute pressure, and what it cost. */
async function loadDisputeMetrics(
  scope: Scope,
  range: DateRange,
  completedVendorOrders: number,
): Promise<DisputeMetrics> {
  const [filed, resolved, live, refunded] = await Promise.all([
    prisma.dispute.count({ where: scopeDispute(scope, { createdAt: within(range) }) }),
    prisma.dispute.count({ where: scopeDispute(scope, { resolvedAt: within(range) }) }),
    // Live cases are counted *now*, not within the range: "what is outstanding" is a
    // question about the present, and a historical window cannot answer it.
    prisma.dispute.count({ where: scopeDispute(scope, { status: { in: ["OPEN", "UNDER_REVIEW"] } }) }),
    prisma.refund.aggregate({
      where: scopeRefund(scope, { succeededAt: within(range) }),
      _sum: { amountKobo: true },
    }),
  ]);

  return {
    filed,
    resolved,
    live,
    disputeRate: rate(filed, completedVendorOrders),
    refundedKobo: sumOrZero(refunded._sum.amountKobo),
  };
}

/**
 * Who is on the platform right now.
 *
 * All present-tense: a date range would turn "vendors awaiting review" into "vendors
 * who applied last month and may since have been approved", which is not the number
 * an admin opening the page is looking for.
 */
async function loadMarketplaceMetrics(scope: Scope): Promise<MarketplaceMetrics> {
  const [activeVendors, pendingVendors, activeAgents, onDutyAgents, pendingStudents, approvedStudents] =
    await Promise.all([
      prisma.vendorProfile.count({ where: scopeVendorProfile(scope, { status: "APPROVED" }) }),
      prisma.vendorProfile.count({
        where: scopeVendorProfile(scope, { status: "PENDING_VERIFICATION" }),
      }),
      prisma.deliveryAgentProfile.count({ where: scopeAgentProfile(scope, { status: "APPROVED" }) }),
      prisma.deliveryAgentProfile.count({
        where: scopeAgentProfile(scope, { status: "APPROVED", isOnDuty: true }),
      }),
      prisma.studentProfile.count({
        where: scopeStudentProfile(scope, { status: "PENDING_VERIFICATION" }),
      }),
      prisma.studentProfile.count({ where: scopeStudentProfile(scope, { status: "APPROVED" }) }),
    ]);

  return {
    activeVendors,
    pendingVendors,
    activeAgents,
    onDutyAgents,
    pendingStudents,
    approvedStudents,
  };
}

/**
 * Vendor leaderboard.
 *
 * `groupBy` gives the totals; a second query resolves the names. Two queries rather
 * than a join because Prisma's `groupBy` cannot include relations — and fetching the
 * handful of names that made the cut is cheaper than joining across the period.
 */
async function loadTopVendors(scope: Scope, range: DateRange, limit: number): Promise<TopVendor[]> {
  const grouped = await prisma.vendorOrder.groupBy({
    by: ["vendorProfileId"],
    where: scopeVendorOrder(scope, { createdAt: within(range), status: "COMPLETED" }),
    _count: { _all: true },
    _sum: { goodsSubtotalKobo: true },
    orderBy: { _sum: { goodsSubtotalKobo: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const profiles = await prisma.vendorProfile.findMany({
    where: { id: { in: grouped.map((row) => row.vendorProfileId) } },
    select: { id: true, storeName: true },
  });
  const names = new Map(profiles.map((profile) => [profile.id, profile.storeName]));

  const rows = grouped.map((row) => {
    const storeName = names.get(row.vendorProfileId) ?? "Unknown store";
    const goodsKobo = sumOrZero(row._sum.goodsSubtotalKobo);

    return {
      vendorProfileId: row.vendorProfileId,
      storeName,
      completedOrders: countOrZero(row._count._all),
      goodsKobo,
      // `rankDescending` needs these two to break ties deterministically.
      value: goodsKobo,
      label: storeName,
    };
  });

  return rankDescending(rows, limit).map(({ value: _value, label: _label, ...vendor }) => vendor);
}

/**
 * Product leaderboard.
 *
 * Scoped on `OrderItem`'s own `campusId` and filtered by the parent vendor order's
 * status, so a cancelled order's items never appear as sales. The line total is used
 * rather than `unitPrice × quantity` because the line total is what the student was
 * actually charged — the snapshot, not a recomputation that could drift.
 */
async function loadTopProducts(scope: Scope, range: DateRange, limit: number): Promise<TopProduct[]> {
  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: scopeOrderItem(scope, {
      vendorOrder: { createdAt: within(range), status: "COMPLETED" },
    }),
    _sum: { quantity: true, lineTotalKobo: true },
    orderBy: { _sum: { lineTotalKobo: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((row) => row.productId) } },
    select: { id: true, name: true },
  });
  const names = new Map(products.map((product) => [product.id, product.name]));

  const rows = grouped.map((row) => {
    // `productName` is snapshotted on the line, but the *current* name is what an
    // admin will recognise in a list; the fallback covers a product row that a
    // vendor has since removed.
    const name = names.get(row.productId) ?? "Removed product";
    const goodsKobo = sumOrZero(row._sum.lineTotalKobo);

    return {
      productId: row.productId,
      name,
      unitsSold: countOrZero(row._sum.quantity),
      goodsKobo,
      value: goodsKobo,
      label: name,
    };
  });

  return rankDescending(rows, limit).map(({ value: _value, label: _label, ...product }) => product);
}

/** Where deliveries actually go — the input to pricing and pooling decisions. */
async function loadTopLocations(scope: Scope, range: DateRange, limit: number): Promise<TopLocation[]> {
  const grouped = await prisma.delivery.groupBy({
    by: ["destinationLocationId"],
    where: scopeDelivery(scope, { createdAt: within(range) }),
    _count: { _all: true },
    orderBy: { _count: { destinationLocationId: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const locations = await prisma.deliveryLocation.findMany({
    where: { id: { in: grouped.map((row) => row.destinationLocationId) } },
    select: { id: true, name: true },
  });
  const names = new Map(locations.map((location) => [location.id, location.name]));

  const rows = grouped.map((row) => {
    const name = names.get(row.destinationLocationId) ?? "Unknown location";
    const deliveries = countOrZero(row._count._all);

    return {
      deliveryLocationId: row.destinationLocationId,
      name,
      deliveries,
      value: deliveries,
      label: name,
    };
  });

  return rankDescending(rows, limit).map(({ value: _value, label: _label, ...location }) => location);
}

/**
 * Agent standings.
 *
 * Phase 10 collected agent ratings and deliberately built no screen for them: showing
 * a courier's score to the student about to meet them invites refusing an agent. An
 * admin needs it, though — it is the first thing to look at when a complaint arrives —
 * so this is where those three columns finally get read.
 *
 * Ranked by *completed deliveries*, not by rating. A leaderboard sorted on score puts
 * an agent with one five-star trip above one with two hundred at 4.8, which tells an
 * admin nothing about who is actually carrying the campus.
 *
 * The rating average is derived from the stored `count` and `sum` rather than read
 * from `ratingAverageHundredths`. The column exists so "top rated" can be an indexed
 * sort; re-deriving here means a drifted column shows up as a disagreement instead of
 * being reported as fact.
 */
async function loadAgentStandings(scope: Scope, range: DateRange, limit: number): Promise<AgentStanding[]> {
  // `agentProfileId` is nullable — a pooled delivery has no agent yet — and grouping
  // a nullable column would produce a phantom "unassigned agent" row.
  const assigned: Prisma.DeliveryWhereInput = { agentProfileId: { not: null } };

  const completedGroups = await prisma.delivery.groupBy({
    by: ["agentProfileId"],
    where: scopeDelivery(scope, { ...assigned, createdAt: within(range), status: "COMPLETED" }),
    _count: { _all: true },
    orderBy: { _count: { agentProfileId: "desc" } },
    take: limit,
  });

  if (completedGroups.length === 0) return [];

  // Non-null by the `assigned` filter above, but `groupBy` cannot express that in the
  // type, so it is narrowed once here rather than asserted at each use.
  const agentIds = completedGroups
    .map((row) => row.agentProfileId)
    .filter((id): id is string => id !== null);

  if (agentIds.length === 0) return [];

  const [cancelledGroups, timings, profiles] = await Promise.all([
    prisma.delivery.groupBy({
      by: ["agentProfileId"],
      where: scopeDelivery(scope, {
        agentProfileId: { in: agentIds },
        createdAt: within(range),
        status: "CANCELLED",
      }),
      _count: { _all: true },
    }),
    prisma.delivery.findMany({
      where: scopeDelivery(scope, {
        agentProfileId: { in: agentIds },
        createdAt: within(range),
        status: "COMPLETED",
      }),
      select: { agentProfileId: true, acceptedAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
      // Capped for the same reason the campus-wide median is: a recent sample is
      // honest, an unbounded read is a slow page waiting to happen.
      take: 1_000,
    }),
    // Scoped again even though the ids came from an already-scoped query: an id list
    // is not an authorization check, and the next person to edit this should not have
    // to reason about where these ids came from (Rule 25).
    prisma.deliveryAgentProfile.findMany({
      where: scopeAgentProfile(scope, { id: { in: agentIds } }),
      select: {
        id: true,
        isOnDuty: true,
        cancellationCount: true,
        underReviewAt: true,
        ratingCount: true,
        ratingSum: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const cancelledByAgent = new Map(
    cancelledGroups
      .filter((row): row is typeof row & { agentProfileId: string } => row.agentProfileId !== null)
      .map((row) => [row.agentProfileId, countOrZero(row._count._all)]),
  );

  const durationsByAgent = new Map<string, number[]>();
  for (const delivery of timings) {
    if (!delivery.agentProfileId) continue;

    const journey = elapsedMs(delivery.acceptedAt, delivery.completedAt);
    if (journey === null) continue;

    const bucket = durationsByAgent.get(delivery.agentProfileId);
    if (bucket) bucket.push(journey);
    else durationsByAgent.set(delivery.agentProfileId, [journey]);
  }

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  const rows = completedGroups.flatMap((group) => {
    const agentProfileId = group.agentProfileId;
    if (agentProfileId === null) return [];

    const profile = profilesById.get(agentProfileId);
    // A profile missing here means it belongs to another campus, so the delivery row
    // is not this admin's to read either. Dropping it is the safe direction.
    if (!profile) return [];

    const completed = countOrZero(group._count._all);
    const cancelled = cancelledByAgent.get(agentProfileId) ?? 0;
    const name = profile.user.name.trim() || "Unnamed agent";

    return [
      {
        agentProfileId,
        name,
        completed,
        cancelled,
        successRate: rate(completed, completed + cancelled),
        medianAcceptToCompleteMs: medianMs(durationsByAgent.get(agentProfileId) ?? []),
        ratingAverageHundredths: deriveRatingAverage(profile.ratingCount, profile.ratingSum),
        ratingCount: profile.ratingCount,
        lifetimeCancellations: profile.cancellationCount,
        underReview: profile.underReviewAt !== null,
        onDuty: profile.isOnDuty,
        value: completed,
        label: name,
      },
    ];
  });

  return rankDescending(rows, limit).map(({ value: _value, label: _label, ...agent }) => agent);
}

/**
 * The daily series.
 *
 * Bucketed in Node from a three-column projection, because Prisma cannot
 * `GROUP BY date_trunc(...)` without raw SQL — and a raw query here would have to
 * splice the campus filter in by hand, which is exactly the code path where campus

 * isolation gets forgotten. The read is covered by the `[campusId, placedAt]` index
 * and capped at a year by the validation layer; if a campus ever outgrows that, the
 * fix is a nightly rollup table, not an unscoped query.
 *
 * Days with no trading are emitted as zeroes rather than omitted, so a chart shows a
 * quiet week as a quiet week instead of silently compressing the timeline.
 */
async function loadDailySeries(scope: Scope, range: DateRange): Promise<DailyPoint[]> {
  const orders = await prisma.order.findMany({
    where: scopeOrder(scope, { placedAt: within(range) }),
    select: { placedAt: true, goodsSubtotalKobo: true, status: true },
    orderBy: { placedAt: "asc" },
  });

  const buckets = new Map<string, { orders: number; goodsKobo: number }>();

  const cursor = new Date(range.from);
  while (cursor < range.to) {
    buckets.set(toDayKey(cursor), { orders: 0, goodsKobo: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const order of orders) {
    const bucket = buckets.get(toDayKey(order.placedAt));
    if (!bucket) continue;

    bucket.orders += 1;
    // Value is only counted for orders that completed: a cancelled order is demand,
    // not revenue, and the two must not be summed on one axis.
    if (order.status === "COMPLETED") bucket.goodsKobo += order.goodsSubtotalKobo;
  }

  return [...buckets.entries()].map(([day, totals]) => ({
    day,
    orders: totals.orders,
    goodsKobo: totals.goodsKobo,
  }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The Campus Admin dashboard.
 *
 * The sections are independent reads, so they run concurrently. The dispute *rate*
 * is the one figure that depends on another section's denominator, so the completed
 * vendor-order count is taken once and shared rather than computed twice.
 */
export async function getCampusDashboard(
  actor: Actor,
  query: AnalyticsDashboardQuery,
  now: Date = new Date(),
): Promise<CampusDashboard> {
  const range = resolveDateRange(toRangeDates(query), now);
  const scope: Scope = { actor, campusId: query.campusId ?? null };
  const topLimit = query.topLimit ?? 5;

  // Resolves the scope — and throws on a cross-campus request — before any of the
  // concurrent reads start, so a rejected request does no database work at all.
  const resolved = campusScope(actor, {}, scope.campusId);
  const effectiveCampusId = typeof resolved.campusId === "string" ? resolved.campusId : null;

  const [
    orders,
    revenue,
    deliveries,
    marketplace,
    topVendors,
    topProducts,
    topLocations,
    agents,
    daily,
    completedVendorOrders,
  ] = await Promise.all([
    loadOrderMetrics(scope, range),
    loadRevenueMetrics(scope, range),
    loadDeliveryMetrics(scope, range),
    loadMarketplaceMetrics(scope),
    loadTopVendors(scope, range, topLimit),
    loadTopProducts(scope, range, topLimit),
    loadTopLocations(scope, range, topLimit),
    loadAgentStandings(scope, range, topLimit),
    loadDailySeries(scope, range),
    prisma.vendorOrder.count({
      where: scopeVendorOrder(scope, { createdAt: within(range), status: "COMPLETED" }),
    }),
  ]);

  const disputes = await loadDisputeMetrics(scope, range, completedVendorOrders);

  return {
    range: toRangeView(range),
    campusId: effectiveCampusId,
    orders,
    revenue,
    deliveries,
    disputes,
    marketplace,
    topVendors,
    topProducts,
    topLocations,
    agents,
    daily,
  };
}
