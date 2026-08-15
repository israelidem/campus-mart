import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

import { env, publicEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Web Push transport (PRD §54).
 *
 * This is the only file that knows a push service exists. Everything above it
 * deals in notifications; everything here deals in endpoints, VAPID keys and
 * HTTP status codes.
 *
 * The important decision is what a failure *means*:
 *
 *  - 404/410 — the browser threw the subscription away. It will never work
 *    again, so the row is deleted rather than retried forever.
 *  - 413 — the payload is too large. Retrying is pointless; that is our bug.
 *  - 429/5xx — the service is busy or broken. The device is probably fine, so
 *    the row is kept and the failure counted.
 *
 * A push is never allowed to fail an operation. A notification's record is the
 * database row; the push is a copy of it, and a copy that does not arrive must
 * not roll back a delivery someone already handed over.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Relative path the notification opens; the service worker resolves it. */
  href: string | null;
  /** Notification id, so the client can mark it read from the notification. */
  notificationId: string;
  /** Groups replacing notifications about the same thing on the lock screen. */
  tag?: string;
};

export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** What the caller must do about a failure. */
export type PushOutcome =
  | { status: "sent" }
  /** The subscription is dead: delete it. */
  | { status: "gone"; statusCode: number }
  /** Transient or our own fault: keep the row, count the failure. */
  | { status: "failed"; statusCode: number | null; message: string };

/**
 * Classifies a push service's response.
 *
 * Pure and exported because this, not the network call, is the part with a
 * decision in it: getting "410 means delete" wrong means either silently
 * dropping working devices or pushing to dead ones until the end of time.
 */
export function classifyPushFailure(statusCode: number | null, message: string): PushOutcome {
  if (statusCode === 404 || statusCode === 410) {
    return { status: "gone", statusCode };
  }
  return { status: "failed", statusCode, message };
}

let configured: boolean | null = null;

/**
 * True when this deployment can send push at all.
 *
 * Push is optional infrastructure: a campus can run without VAPID keys and
 * simply have in-app notifications. That is a deliberate degradation, not an
 * error, so the absence of keys is logged once and never thrown.
 */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = publicEnv.vapidPublicKey;
  const { VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env();

  if (!publicKey || !VAPID_PRIVATE_KEY) {
    logger.info("Web Push is not configured; notifications will be in-app only");
    configured = false;
    return configured;
  }

  webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:admin@campusmart.local", publicKey, VAPID_PRIVATE_KEY);
  configured = true;
  return configured;
}

/** For tests, which set different keys per case. */
export function resetPushConfiguration(): void {
  configured = null;
}

/**
 * Sends one push and reports what happened.
 *
 * Never throws. The caller decides what to do with the outcome; a thrown error
 * here would propagate into a database transaction that has nothing to do with
 * whether a phone buzzed.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
  if (!isPushConfigured()) {
    return { status: "failed", statusCode: null, message: "Push is not configured" };
  }

  const subscription: WebPushSubscription = {
    endpoint: target.endpoint,
    keys: { p256dh: target.p256dh, auth: target.auth },
  };

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      // Long enough to survive a phone being off for a while, short enough that
      // "your agent has arrived" cannot arrive tomorrow.
      TTL: 3600,
      urgency: "high",
    });
    return { status: "sent" };
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? ((error as { statusCode?: unknown }).statusCode as number | undefined) ?? null
        : null;
    const message = error instanceof Error ? error.message : "Push failed";
    return classifyPushFailure(statusCode, message);
  }
}
