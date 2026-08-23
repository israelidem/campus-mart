import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader, Stat } from "@/components/ui/card";
import { formatChange, formatDurationMs, formatRate } from "@/lib/analytics/analytics-policy";
import type { CampusDashboard } from "@/lib/analytics/analytics-service";
import { formatKobo } from "@/lib/money";
// Reused rather than reimplemented: an agent's 4.50 must read the same here as it
// does in the moderation queue, and two formatters would eventually disagree.
import { formatAverage } from "@/lib/ratings/rating-policy";
import { cn } from "@/lib/utils";

/**
 * The Campus Admin dashboard (PRD §65–68).
 *
 * A server component with no chart library. Recharts would add ~90KB to a page whose
 * entire job is to show thirty numbers, and this is the audience most likely to be on
 * a phone paying for its own data (PRD §12). The daily trend is a row of divs whose
 * heights are proportions — legible, printable, and free.
 *
 * The rule the whole file follows: **a missing metric renders as a dash and a
 * sentence, never as a zero.** A campus with no deliveries yet must not be told its
 * delivery success rate is 0%.
 */

/**
 * Period-over-period movement.
 *
 * Direction is carried by an arrow as well as by colour, so the signal survives
 * both colour blindness and a greyscale print of the page.
 */
function Delta({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="text-xs text-ink-3">No prior period</span>;
  }

  const tone =
    change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-ink-3";
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";

  return (
    <span className={cn("text-xs font-medium tabular-nums", tone)}>
      {arrow} {formatChange(change)} vs previous
    </span>
  );
}

/**
 * Money that may be negative.
 *
 * `formatKobo` asserts a non-negative amount, because everywhere else in the app a
 * negative sum means a bug. Net platform earnings are the one honest exception — a
 * period in which refunds exceeded commission is real — so the sign is carried
 * outside the formatter rather than by weakening it for every other caller.
 */
function formatSignedKobo(value: number): string {
  return value < 0 ? `−${formatKobo(-value)}` : formatKobo(value);
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeader title={title} description={note} />
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * The daily trend.
 *
 * Bars are scaled against the busiest day in the window, so the shape is a
 * comparison within the period rather than an absolute claim. Every bar keeps a
 * visible minimum height: a day with one order must not look identical to a day with
 * none, because those are different operational facts.
 *
 * The figures also exist as a real table, visually hidden. `title` tooltips were the
 * only way to read a bar before, which is no way at all on a touch screen or with a
 * screen reader — and this is a phone-first audience.
 */
function DailyTrend({ daily }: { daily: CampusDashboard["daily"] }) {
  const peak = daily.reduce((max, point) => Math.max(max, point.orders), 0);
  const total = daily.reduce((sum, point) => sum + point.orders, 0);

  if (peak === 0) {
    return (
      <Card className="text-sm text-muted">No orders were placed in this period.</Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Orders per day</p>
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{total}</p>
        </div>
        <p className="text-xs text-muted">
          Peak <span className="font-mono tabular-nums">{peak}</span>/day
        </p>
      </div>

      <div className="flex h-24 items-end gap-px" aria-hidden="true">
        {daily.map((point) => (
          <div
            key={point.day}
            className={cn(
              "flex-1 rounded-t transition-[height]",
              point.orders === 0 ? "bg-rule" : "bg-brand-600",
            )}
            style={{
              height: `${point.orders === 0 ? 2 : Math.max(6, (point.orders / peak) * 100)}%`,
            }}
            title={`${point.day}: ${point.orders} order${point.orders === 1 ? "" : "s"}, ${formatKobo(point.goodsKobo)}`}
          />
        ))}
      </div>

      <div className="flex justify-between text-xs text-ink-3">
        <span className="font-mono">{daily[0]?.day}</span>
        <span className="font-mono">{daily[daily.length - 1]?.day}</span>
      </div>

      <table className="sr-only">
        <caption>Orders and value per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Orders</th>
            <th scope="col">Goods sold</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((point) => (
            <tr key={point.day}>
              <th scope="row">{point.day}</th>
              <td>{point.orders}</td>
              <td>{formatKobo(point.goodsKobo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Leaderboards stay real tables — §19 asks for tables where tables are
 * appropriate, and this is ranked, columnar, comparable data.
 *
 * Wide tables scroll inside their own region rather than stretching the page: a
 * five-column agent table cannot fit 320px at a legible size, and a contained
 * scroller is the honest answer. The region is focusable with an accessible name
 * so it can also be scrolled by keyboard.
 */
function LeaderboardTable({
  caption,
  columns,
  rows,
  empty,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  empty: string;
}) {
  if (rows.length === 0) return <Card className="text-sm text-muted">{empty}</Card>;

  const wide = columns.length >= 4;

  return (
    <Card className="p-0">
      <div
        className="overflow-x-auto rounded-card"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className={cn("w-full text-sm", wide && "min-w-[34rem]")}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-ink-3">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={cn("px-4 py-2.5 font-medium", index > 0 && "text-right")}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-rule/60 last:border-0">
                {row.cells.map((cell, index) => (
                  <td
                    key={`${row.key}-${index}`}
                    className={cn(
                      "px-4 py-3",
                      index === 0
                        ? "font-medium text-ink"
                        : "whitespace-nowrap text-right font-mono tabular-nums text-ink-2",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function AnalyticsDashboard({ dashboard }: { dashboard: CampusDashboard }) {
  const { orders, revenue, deliveries, disputes, marketplace } = dashboard;

  return (
    <div className="space-y-8">
      <Section
        title="Trade"
        note="Orders are counted when placed. Value is counted only once an order completes, because a cancelled order earned nothing."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Orders placed"
            value={orders.placed.value.toLocaleString("en-NG")}
            hint={<Delta change={orders.placed.change} />}
          />
          <Stat
            label="Completed"
            value={orders.completed.toLocaleString("en-NG")}
            hint={
              orders.completionRate === null
                ? "No orders to measure yet"
                : `${formatRate(orders.completionRate)} of orders placed`
            }
          />
          <Stat
            label="Goods sold"
            value={formatKobo(revenue.goodsKobo)}
            hint={<Delta change={revenue.goods.change} />}
            tone="brand"
          />
          <Stat
            label="Average order"
            value={
              orders.averageOrderValueKobo === null
                ? "—"
                : formatKobo(orders.averageOrderValueKobo)
            }
            hint={
              orders.averageOrderValueKobo === null
                ? "No completed orders yet"
                : "Completed orders only"
            }
          />
        </div>
        <DailyTrend daily={dashboard.daily} />
      </Section>

      <Section
        title="Platform earnings"
        note="Commission plus delivery fees, less the platform's own share of refunds. A vendor's share of a refund is the vendor's loss, not the platform's."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Commission" value={formatKobo(revenue.commissionKobo)} />
          <Stat
            label="Delivery fees"
            value={formatKobo(revenue.deliveryFeesKobo)}
            hint="Captured payments"
          />
          <Stat
            label="Refunded (platform)"
            value={formatKobo(revenue.refundedFromPlatformKobo)}
          />
          <Stat
            label="Net to platform"
            value={formatSignedKobo(revenue.netPlatformKobo)}
            tone={revenue.netPlatformKobo < 0 ? "danger" : "success"}
            hint={
              revenue.netPlatformKobo < 0 ? "Refunds exceeded earnings this period" : undefined
            }
          />
        </div>
        <p className="text-xs text-muted">
          Owed to vendors for the same period:{" "}
          <span className="font-mono tabular-nums">{formatKobo(revenue.vendorPayoutKobo)}</span>.
        </p>
      </Section>

      <Section
        title="Delivery"
        note="Times are medians, not averages: one parcel left overnight should not describe everyone else's afternoon."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Deliveries created" value={deliveries.created.toLocaleString("en-NG")} />
          <Stat
            label="Success rate"
            value={formatRate(deliveries.successRate)}
            hint={
              deliveries.successRate === null
                ? "No deliveries have concluded yet"
                : `${deliveries.completed} completed, ${deliveries.returned} returned, ${deliveries.cancelled} cancelled`
            }
          />
          <Stat
            label="Typical wait for an agent"
            value={formatDurationMs(deliveries.medianPoolWaitMs)}
            hint={
              deliveries.medianPoolWaitMs === null
                ? "Nothing has been accepted yet"
                : "Pooled to accepted"
            }
          />
          <Stat
            label="Typical delivery time"
            value={formatDurationMs(deliveries.medianAcceptToCompleteMs)}
            hint={
              deliveries.medianAcceptToCompleteMs === null
                ? "Nothing has completed yet"
                : "Accepted to handed over"
            }
          />
        </div>
      </Section>

      <Section
        title="Trust"
        note="A rising dispute rate is the earliest warning that something on the campus is wrong."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Disputes filed" value={disputes.filed.toLocaleString("en-NG")} />
          <Stat
            label="Open now"
            value={disputes.live.toLocaleString("en-NG")}
            tone={disputes.live > 0 ? "warning" : "neutral"}
            hint="Awaiting your decision, regardless of date"
          />
          <Stat
            label="Dispute rate"
            value={formatRate(disputes.disputeRate, 2)}
            hint={
              disputes.disputeRate === null
                ? "No completed store orders yet"
                : "Of completed store orders"
            }
          />
          <Stat
            label="Refunded"
            value={formatKobo(disputes.refundedKobo)}
            hint="Total paid back to students"
          />
        </div>
      </Section>

      <Section
        title="Who is here"
        note="Counted as of now, not over the period — this is a picture of today."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat
            label="Active vendors"
            value={marketplace.activeVendors.toLocaleString("en-NG")}
            tone={marketplace.pendingVendors > 0 ? "warning" : "neutral"}
            hint={
              marketplace.pendingVendors > 0
                ? `${marketplace.pendingVendors} awaiting review`
                : "None awaiting review"
            }
          />
          <Stat
            label="Agents on duty"
            value={marketplace.onDutyAgents.toLocaleString("en-NG")}
            hint={`of ${marketplace.activeAgents} approved`}
          />
          <Stat
            label="Verified students"
            value={marketplace.approvedStudents.toLocaleString("en-NG")}
            tone={marketplace.pendingStudents > 0 ? "warning" : "neutral"}
            hint={
              marketplace.pendingStudents > 0
                ? `${marketplace.pendingStudents} awaiting review`
                : "None awaiting review"
            }
          />
        </div>
      </Section>

      <Section title="Top stores">
        <LeaderboardTable
          caption="Stores by goods sold"
          columns={["Store", "Orders", "Goods sold"]}
          rows={dashboard.topVendors.map((vendor) => ({
            key: vendor.vendorProfileId,
            cells: [
              vendor.storeName,
              vendor.completedOrders.toLocaleString("en-NG"),
              formatKobo(vendor.goodsKobo),
            ],
          }))}
          empty="No store completed an order in this period."
        />
      </Section>

      <Section title="Top products">
        <LeaderboardTable
          caption="Products by value sold"
          columns={["Product", "Units", "Value"]}
          rows={dashboard.topProducts.map((product) => ({
            key: product.productId,
            cells: [
              product.name,
              product.unitsSold.toLocaleString("en-NG"),
              formatKobo(product.goodsKobo),
            ],
          }))}
          empty="Nothing was sold in this period."
        />
      </Section>

      <Section
        title="Busiest destinations"
        note="Where deliveries actually go — the input to your pricing and pooling."
      >
        <LeaderboardTable
          caption="Delivery locations by volume"
          columns={["Location", "Deliveries"]}
          rows={dashboard.topLocations.map((location) => ({
            key: location.deliveryLocationId,
            cells: [location.name, location.deliveries.toLocaleString("en-NG")],
          }))}
          empty="No deliveries were created in this period."
        />
      </Section>

      <Section
        title="Agents"
        note="Ranked by deliveries completed, not by score: an agent with one five-star trip is not your best agent. Scores are lifetime; the counts are for this period."
      >
        <LeaderboardTable
          caption="Delivery agents by completed deliveries"
          columns={["Agent", "Completed", "Success", "Typical time", "Rating"]}
          rows={dashboard.agents.map((agent) => ({
            key: agent.agentProfileId,
            cells: [
              // The two flags an admin must not have to hunt for: someone already
              // escalated under Rule 27, and someone who is not currently reachable.
              // These were parenthetical text; as badges they survive a skim.
              <span key="name" className="flex flex-wrap items-center gap-1.5">
                <span>{agent.name}</span>
                {agent.underReview ? <Badge tone="danger">Under review</Badge> : null}
                {agent.onDuty ? null : <Badge tone="neutral">Off duty</Badge>}
              </span>,
              agent.completed.toLocaleString("en-NG"),
              agent.successRate === null
                ? "—"
                : `${formatRate(agent.successRate)}${agent.cancelled > 0 ? ` (${agent.cancelled} dropped)` : ""}`,
              formatDurationMs(agent.medianAcceptToCompleteMs),
              agent.ratingAverageHundredths === null
                ? "Not rated"
                : // `?? ""` is unreachable — a non-null average implies `ratingCount > 0`,
                  // which is exactly when `formatAverage` returns a string — but the
                  // types do not know the two are linked, so it stays explicit.
                  `${formatAverage(agent.ratingAverageHundredths, agent.ratingCount) ?? ""} (${agent.ratingCount})`,
            ],
          }))}
          empty="No agent completed a delivery in this period."
        />
      </Section>
    </div>
  );
}
