import { describe, expect, it } from "vitest";

import { NotificationType } from "@/lib/generated/prisma/enums";
import { classifyPushFailure } from "@/lib/notifications/push";
import { renderNotification, shouldPush } from "@/lib/notifications/messages";

/**
 * Phase 9 unit tests.
 *
 * The catalogue and the failure classifier are the two pure decisions in the
 * notification stack, and both are the kind of thing that breaks quietly. A
 * notification with an empty body still sends; a 410 mistaken for a transient
 * error still "works" while pushing to a dead device forever. Neither shows up
 * in a smoke test, so both are pinned here.
 */

const ALL_TYPES = Object.values(NotificationType);

describe("notification catalogue", () => {
  it("renders every type in the enum", () => {
    // The guarantee behind the `Record<NotificationType, …>` in messages.ts. If
    // someone adds an enum value and a migration but no copy, this fails rather
    // than a phone receiving "undefined".
    for (const type of ALL_TYPES) {
      expect(() => renderNotification(type), type).not.toThrow();
    }
  });

  it("always produces a non-empty title and body, even with no facts", () => {
    // Facts are optional at the type level because callers assemble them from
    // whatever the operation has to hand. A missing store name must degrade to
    // readable English, not to a blank push.
    for (const type of ALL_TYPES) {
      const message = renderNotification(type);

      expect(message.title.trim(), `${type} title`).not.toBe("");
      expect(message.body.trim(), `${type} body`).not.toBe("");
      expect(message.body, `${type} body`).not.toContain("undefined");
      expect(message.body, `${type} body`).not.toContain("NaN");
    }
  });

  it("links only to relative paths", () => {
    // Stored absolute URLs would outlive the domain that made them. A path
    // resolves against whatever origin the reader is on.
    for (const type of ALL_TYPES) {
      const { href } = renderNotification(type);
      if (href === null) continue;

      expect(href.startsWith("/"), `${type} href`).toBe(true);
      expect(href).not.toContain("://");
    }
  });

  it("formats money from kobo rather than trusting the caller", () => {
    const message = renderNotification("HANDOVER_VERIFIED", {
      reference: "CM-7Q4F2K",
      amountKobo: 250_000,
    });

    // 250,000 kobo is ₦2,500 — the catalogue owns this conversion so that no
    // caller can accidentally send naira and understate a bill by 100×.
    expect(message.body).toContain("₦2,500");
    expect(message.body).toContain("CM-7Q4F2K");
  });

  it("substitutes readable fallbacks for missing facts", () => {
    const withoutFacts = renderNotification("VENDOR_ORDER_READY");

    expect(withoutFacts.body).toContain("The store");
    expect(withoutFacts.body).toContain("your order");
  });

  it("appends a reason only when one is given", () => {
    const withReason = renderNotification("DELIVERY_CANCELLED", {
      reference: "CM-ABC123",
      reason: "The agent could not reach the destination.",
    });
    const withoutReason = renderNotification("DELIVERY_CANCELLED", { reference: "CM-ABC123" });

    expect(withReason.body).toContain("could not reach");
    // No trailing space or orphaned punctuation when the reason is absent.
    expect(withoutReason.body).toBe("The delivery for CM-ABC123 was cancelled.");
  });

  it("keeps the campus-wide delivery offer anonymous", () => {
    // PRD §38: an agent who has not accepted the job may not learn whose it is.
    // This fan-out reaches every available agent on campus, so a reference or a
    // name here would be a privacy leak, not a nicety.
    const message = renderNotification("DELIVERY_AVAILABLE", {
      reference: "CM-SECRET",
      storeName: "Mama Chi Kitchen",
      destinationName: "Faculty of Science",
      amountKobo: 50_000,
    });

    expect(message.body).not.toContain("CM-SECRET");
    expect(message.body).not.toContain("Mama Chi");
    expect(message.body).toContain("Faculty of Science");
    expect(message.body).toContain("₦500");
  });

  it("sends the vendor's new-order alert to the vendor queue", () => {
    // A vendor tapping "New order" must land where the order can be accepted,
    // not on the student-facing order list.
    expect(renderNotification("ORDER_PLACED").href).toBe("/vendor/orders");
    expect(renderNotification("DELIVERY_AVAILABLE").href).toBe("/agent");
  });
});

describe("push-worthiness", () => {
  it("interrupts only for the moments that cannot wait", () => {
    // The recorded inbox holds everything; a push is an interruption and is
    // rationed. Each of these has someone waiting on the other side of it.
    expect(shouldPush("DELIVERY_ARRIVED")).toBe(true);
    expect(shouldPush("HANDOVER_VERIFIED")).toBe(true);
    expect(shouldPush("ORDER_PLACED")).toBe(true);
    expect(shouldPush("DELIVERY_AVAILABLE")).toBe(true);
  });

  it("stays quiet for progress the reader will see anyway", () => {
    expect(shouldPush("VENDOR_ORDER_PREPARING")).toBe(false);
    expect(shouldPush("DELIVERY_POOLED")).toBe(false);
    expect(shouldPush("PAYMENT_SETTLED")).toBe(false);
  });

  it("answers for every type without throwing", () => {
    for (const type of ALL_TYPES) {
      expect(typeof shouldPush(type), type).toBe("boolean");
    }
  });
});

describe("push failure classification", () => {
  it("treats 404 and 410 as a dead subscription", () => {
    // The push service is telling us the browser discarded this endpoint. It
    // will never work again, so the row must go — otherwise every future
    // notification carries a permanent failure with it.
    expect(classifyPushFailure(404, "Not Found")).toEqual({ status: "gone", statusCode: 404 });
    expect(classifyPushFailure(410, "Gone")).toEqual({ status: "gone", statusCode: 410 });
  });

  it("keeps the subscription for transient failures", () => {
    // A rate limit or an outage says nothing about the device. Deleting here
    // would silently unsubscribe real users whenever a push service wobbled.
    for (const statusCode of [429, 500, 502, 503]) {
      expect(classifyPushFailure(statusCode, "later").status, String(statusCode)).toBe("failed");
    }
  });

  it("keeps the subscription when the payload is our own fault", () => {
    // 413 is a bug in what we sent, not a problem with the subscriber.
    expect(classifyPushFailure(413, "Payload too large").status).toBe("failed");
  });

  it("keeps the subscription when there is no status code at all", () => {
    // DNS failure, socket timeout, push not configured. Unknown is not dead.
    const outcome = classifyPushFailure(null, "socket hang up");

    expect(outcome.status).toBe("failed");
    expect(outcome).toMatchObject({ statusCode: null, message: "socket hang up" });
  });

  it("carries the message through for logging", () => {
    const outcome = classifyPushFailure(503, "Service Unavailable");

    // Operators need the service's own words; a normalised message would hide
    // which provider is failing and why.
    expect(outcome).toMatchObject({ status: "failed", message: "Service Unavailable" });
  });
});
