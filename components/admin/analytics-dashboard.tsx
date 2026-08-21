import {
  formatChange,
  formatDurationMs,
  formatRate,
} from "@/lib/analytics/analytics-policy";
import type { CampusDashboard } from "@/lib/analytics/analytics-service";
import { formatKobo } from "@/lib/money";
// Reused rather than reimplemented: an agent's 4.50 must read the same here as it
// does in the moderation queue, and two formatters would eventually disagree.
import { formatAverage } from "@/lib/ratings/rating-policy";

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

function MetricCard({
  label,
  value,
  hint,
  change,
}: {
  label: string;
  value: string;
  hint?: string;
  change?: number | null;
}) {
  return (
    <div className="rounded-lg border border-current/10 p-3">
      <p className="text-xs uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {change !== undefined && (
        <p
          className={
            change === null
              ? "text-xs opacity-50"
              : change > 0
                ? "text-xs text-green-700 dark:text-green-400"
                : change < 0
                  ? "text-xs text-red-700 dark:text-red-400"
                  : "text-xs opacity-60"
          }
        >
          {change === null ? "No prior period" : `${formatChange(change)} vs previous`}
        </p>
      )}
      {hint && <p className="mt-0.5 text-xs opacity-60">{hint}</p>}
    </div>
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

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">{title}</h2>
        {note && <p className="text-xs opacity-60">{note}</p>}
      </div>
      {children}
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
 */
function DailyTrend({ daily }: { daily: CampusDashboard["daily"] }) {
  const peak = daily.reduce((max, point) => Math.max(max, point.orders), 0);

  if (peak === 0) {
    return <p className="text-sm opacity-60">No orders were placed in this period.</p>;
  }

  return (
    <div>
      <div className="flex h-24 items-end gap-px" role="img" aria-label="Orders per day">
        {daily.map((point) => (
          <div
            key={point.day}
            className="flex-1 rounded-t bg-current/20"
            style={{ height: `${point.orders === 0 ? 2 : Math.max(6, (point.orders / peak) * 100)}%` }}
            // The chart is decorative; the numbers a screen reader needs are in the
            // cards above and the table below, so this only needs a hover label.
            title={`${point.day}: ${point.orders} order${point.orders === 1 ? "" : "s"}, ${formatKobo(point.goodsKobo)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs opacity-60">
        <span>{daily[0]?.day}</span>
        <span>Peak {peak}/day</span>
        <span>{daily[daily.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function LeaderboardTable({
  caption,
  columns,
  rows,
  empty,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: string[] }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm opacity-60">{empty}</p>;

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide opacity-60">
          {columns.map((column, index) => (
            <th key={column} scope="col" className={index === 0 ? "py-1" : "py-1 text-right"}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-current/10">
            {row.cells.map((cell, index) => (
              <td
                key={`${row.key}-${index}`}
                className={index === 0 ? "py-1.5" : "py-1.5 text-right tabular-nums"}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Orders placed"
            value={orders.placed.value.toLocaleString()}
            change={orders.placed.change}
          />
          <MetricCard
            label="Completed"
            value={orders.completed.toLocaleString()}
            hint={
              orders.completionRate === null
                ? "No orders to measure yet"
                : `${formatRate(orders.completionRate)} of orders placed`
            }
          />
          <MetricCard
            label="Goods sold"
            value={formatKobo(revenue.goodsKobo)}
            change={revenue.goods.change}
          />
          <MetricCard
            label="Average order"
            value={
              orders.averageOrderValueKobo === null
                ? "—"
                : formatKobo(orders.averageOrderValueKobo)
            }
            hint={orders.averageOrderValueKobo === null ? "No completed orders yet" : "Completed orders only"}
          />
        </div>
        <DailyTrend daily={dashboard.daily} />
      </Section>

      <Section
        title="Platform earnings"
        note="Commission plus delivery fees, less the platform's own share of refunds. A vendor's share of a refund is the vendor's loss, not the platform's."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Commission" value={formatKobo(revenue.commissionKobo)} />
          <MetricCard label="Delivery fees" value={formatKobo(revenue.deliveryFeesKobo)} hint="Captured payments" />
          <MetricCard
            label="Refunded (platform)"
            value={formatKobo(revenue.refundedFromPlatformKobo)}
          />
          <MetricCard
            label="Net to platform"
            value={formatSignedKobo(revenue.netPlatformKobo)}
            hint={revenue.netPlatformKobo < 0 ? "Refunds exceeded earnings this period" : undefined}
          />
        </div>
        <p className="text-xs opacity-60">
          Owed to vendors for the same period: {formatKobo(revenue.vendorPayoutKobo)}.
        </p>
      </Section>

      <Section
        title="Delivery"
        note="Times are medians, not averages: one parcel left overnight should not describe everyone else's afternoon."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Deliveries created" value={deliveries.created.toLocaleString()} />
          <MetricCard
            label="Success rate"
            value={formatRate(deliveries.successRate)}
            hint={
              deliveries.successRate === null
                ? "No deliveries have concluded yet"
                : `${deliveries.completed} completed, ${deliveries.returned} returned, ${deliveries.cancelled} cancelled`
            }
          />
          <MetricCard
            label="Typical wait for an agent"
            value={formatDurationMs(deliveries.medianPoolWaitMs)}
            hint={deliveries.medianPoolWaitMs === null ? "Nothing has been accepted yet" : "Pooled to accepted"}
          />
          <MetricCard
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

      <Section title="Trust" note="A rising dispute rate is the earliest warning that something on the campus is wrong.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Disputes filed" value={disputes.filed.toLocaleString()} />
          <MetricCard
            label="Open now"
            value={disputes.live.toLocaleString()}
            hint="Awaiting your decision, regardless of date"
          />
          <MetricCard
            label="Dispute rate"
            value={formatRate(disputes.disputeRate, 2)}
            hint={disputes.disputeRate === null ? "No completed store orders yet" : "Of completed store orders"}
          />
          <MetricCard label="Refunded" value={formatKobo(disputes.refundedKobo)} hint="Total paid back to students" />
        </div>
      </Section>

      <Section title="Who is here" note="Counted as of now, not over the period — this is a picture of today.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Active vendors"
            value={marketplace.activeVendors.toLocaleString()}
            hint={
              marketplace.pendingVendors > 0
                ? `${marketplace.pendingVendors} awaiting review`
                : "None awaiting review"
            }
          />
          <MetricCard
            label="Agents on duty"
            value={marketplace.onDutyAgents.toLocaleString()}
            hint={`of ${marketplace.activeAgents} approved`}
          />
          <MetricCard
            label="Verified students"
            value={marketplace.approvedStudents.toLocaleString()}
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
            cells: [vendor.storeName, vendor.completedOrders.toLocaleString(), formatKobo(vendor.goodsKobo)],
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
            cells: [product.name, product.unitsSold.toLocaleString(), formatKobo(product.goodsKobo)],
          }))}
          empty="Nothing was sold in this period."
        />
      </Section>

      <Section title="Busiest destinations" note="Where deliveries actually go — the input to your pricing and pooling.">
        <LeaderboardTable
          caption="Delivery locations by volume"
          columns={["Location", "Deliveries"]}
          rows={dashboard.topLocations.map((location) => ({
            key: location.deliveryLocationId,
            cells: [location.name, location.deliveries.toLocaleString()],
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
              [
                agent.name,
                agent.underReview ? "(under review)" : null,
                agent.onDuty ? null : "(off duty)",
              ]
                .filter(Boolean)
                .join(" "),
              agent.completed.toLocaleString(),
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
