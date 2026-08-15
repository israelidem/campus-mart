import type { NotificationType } from "@/lib/generated/prisma/enums";
import { formatKobo, type Kobo } from "@/lib/money";

/**
 * The notification catalogue (PRD §51–53).
 *
 * Every message the platform can send is written here, once, as a pure function
 * of its facts. Nothing in this file touches the database, the network or the
 * clock, which is why it is the part of Phase 9 that is worth unit testing: the
 * wording, the link and the audience are the product decisions, and they are all
 * visible in one place.
 *
 * Two rules hold throughout:
 *
 *  1. A message is *rendered at send time* and then stored. A store that renames
 *     itself next week must not rewrite what a student was told today.
 *  2. `href` is always a relative path. The origin belongs to the deployment,
 *     and a stored absolute URL would break the moment the domain changes.
 */

/** The facts a message may be built from. Deliberately small and serialisable. */
export type NotificationFacts = {
  /** Human reference, e.g. "CM-7Q4F2K". Shown rather than an opaque id. */
  reference?: string;
  storeName?: string;
  /** Where the package is going, as it was snapshotted on the order. */
  destinationName?: string;
  /** Naira-formatted from kobo by the catalogue, never by the caller. */
  amountKobo?: Kobo;
  /** Minutes left on a deadline the server has already computed. */
  minutes?: number;
  /** Why something ended the way it did, in the words already shown in-app. */
  reason?: string;
  /** The decision an admin made, e.g. "approved". */
  outcome?: string;
};

export type NotificationMessage = {
  title: string;
  body: string;
  /** Relative path the notification opens. Null when there is nowhere to go. */
  href: string | null;
};

/** A trailing clause only when there is something to say. */
function withReason(sentence: string, reason?: string): string {
  const trimmed = reason?.trim();
  return trimmed ? `${sentence} ${trimmed}` : sentence;
}

function money(amountKobo?: Kobo): string {
  return typeof amountKobo === "number" ? formatKobo(amountKobo) : "the amount due";
}

function store(storeName?: string): string {
  return storeName?.trim() || "The store";
}

function ref(reference?: string): string {
  return reference?.trim() || "your order";
}

/**
 * Renders one notification.
 *
 * A `Record` keyed by the enum rather than a `switch`: adding a value to
 * `NotificationType` without writing its copy then fails to compile, which is
 * the only reliable way to stop a silent "" notification reaching a phone.
 */
const RENDERERS: Record<NotificationType, (facts: NotificationFacts) => NotificationMessage> = {
  ORDER_PLACED: (f) => ({
    title: "New order",
    body: `${ref(f.reference)} needs preparing${
      typeof f.amountKobo === "number" ? ` — ${formatKobo(f.amountKobo)}` : ""
    }.`,
    href: "/vendor/orders",
  }),

  VENDOR_ORDER_PREPARING: (f) => ({
    title: "Your order is being prepared",
    body: `${store(f.storeName)} started on ${ref(f.reference)}.`,
    href: "/orders",
  }),

  VENDOR_ORDER_READY: (f) => ({
    title: "Your order is packed",
    body: `${store(f.storeName)} has ${ref(f.reference)} ready for an agent to collect.`,
    href: "/orders",
  }),

  DELIVERY_POOLED: (f) => ({
    title: "Looking for an agent",
    body: `${ref(f.reference)} is with the delivery pool now.`,
    href: "/orders",
  }),

  // The only campus-wide fan-out. It carries no student, no address and no
  // reference: an agent who has not accepted the job is not entitled to know
  // whose it is (PRD §38).
  DELIVERY_AVAILABLE: (f) => ({
    title: "Delivery available",
    body: `A package is waiting${
      f.destinationName ? ` for ${f.destinationName}` : ""
    }${typeof f.amountKobo === "number" ? ` — ${formatKobo(f.amountKobo)} delivery fee` : ""}.`,
    href: "/agent",
  }),

  DELIVERY_ACCEPTED: (f) => ({
    title: "An agent is on it",
    body: `${ref(f.reference)} was accepted and will be collected shortly.`,
    href: "/orders",
  }),

  DELIVERY_PICKED_UP: (f) => ({
    title: "On the way",
    body: `Your agent has ${ref(f.reference)} and is heading to ${
      f.destinationName ?? "your delivery point"
    }.`,
    href: "/orders",
  }),

  // The one notification the whole design exists for: the student is elsewhere,
  // the agent is standing at the destination, and the wait is on a clock.
  DELIVERY_ARRIVED: (f) => ({
    title: "Your agent has arrived",
    body: withReason(
      `Your delivery is at ${f.destinationName ?? "your delivery point"}.`,
      typeof f.minutes === "number" ? `They can wait about ${f.minutes} minutes.` : undefined,
    ),
    href: "/orders",
  }),

  HANDOVER_VERIFIED: (f) => ({
    title: "Hand-over confirmed",
    body: withReason(
      `Pay ${money(f.amountKobo)} for ${ref(f.reference)} to finish.`,
      typeof f.minutes === "number" ? `You have ${f.minutes} minutes.` : undefined,
    ),
    href: "/orders",
  }),

  PAYMENT_SETTLED: (f) => ({
    title: "Payment received",
    body: `${money(f.amountKobo)} for ${ref(f.reference)} has been confirmed.`,
    href: "/orders",
  }),

  DELIVERY_RETURNED: (f) => ({
    title: "Delivery returned",
    body: withReason(`${ref(f.reference)} went back to the store.`, f.reason),
    href: "/orders",
  }),

  DELIVERY_CANCELLED: (f) => ({
    title: "Delivery cancelled",
    body: withReason(`The delivery for ${ref(f.reference)} was cancelled.`, f.reason),
    href: "/orders",
  }),

  APPLICATION_REVIEWED: (f) => ({
    title: "Application reviewed",
    body: withReason(`Your application was ${f.outcome ?? "reviewed"}.`, f.reason),
    href: "/student/onboarding",
  }),
};

export function renderNotification(
  type: NotificationType,
  facts: NotificationFacts = {},
): NotificationMessage {
  return RENDERERS[type](facts);
}

/**
 * Types that are worth waking a phone for (PRD §55).
 *
 * Everything is recorded in the inbox; only these also become a push. The test
 * is simply "would the person want to be interrupted by this while doing
 * something else" — an agent standing at a door, yes; a status change they will
 * see next time they open the app, no.
 */
const PUSH_WORTHY: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "ORDER_PLACED",
  "DELIVERY_AVAILABLE",
  "DELIVERY_ARRIVED",
  "HANDOVER_VERIFIED",
  "DELIVERY_RETURNED",
  "DELIVERY_CANCELLED",
  "APPLICATION_REVIEWED",
]);

export function shouldPush(type: NotificationType): boolean {
  return PUSH_WORTHY.has(type);
}
