import type { Actor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import type { NotificationType } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import {
  renderNotification,
  shouldPush,
  type NotificationFacts,
} from "@/lib/notifications/messages";
import { isPushConfigured, sendPush, type PushTarget } from "@/lib/notifications/push";
import type { PushSubscriptionInput } from "@/validations/notification";

/**
 * Notifications (PRD §51–55).
 *
 * One entry point, `notify()`, called by the operations that already exist. It
 * writes rows first and pushes afterwards, and it never throws: a notification
 * is a *consequence* of something that already happened, so failing to announce
 * a delivery must not undo the delivery.
 *
 * That ordering is the whole design. Callers invoke `notify()` after their
 * transaction has committed, so the fan-out cannot hold a database transaction
 * open across a network call to a push service.
 */

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** One person to tell, and the campus the news belongs to. */
export type NotifyRecipient = {
  userId: string;
  campusId: string;
};

export type NotifyInput = {
  type: NotificationType;
  recipients: readonly NotifyRecipient[];
  facts?: NotificationFacts;
  /** What this is about, for support and for grouping pushes per subject. */
  entityType?: string;
  entityId?: string;
};

/**
 * Records a notification for each recipient and pushes the ones worth pushing.
 *
 * Deliberately fire-and-forget from the caller's point of view: it resolves to
 * the number of rows written, and every failure is logged rather than raised.
 * There is no retry queue in the MVP — an unsent push is recoverable by opening
 * the app, which is exactly what the in-app inbox is for.
 */
export async function notify(input: NotifyInput): Promise<number> {
  // De-duplicate: a student who is also the vendor of one of their own campus
  // stores must not be told the same thing twice.
  const unique = new Map<string, NotifyRecipient>();
  for (const recipient of input.recipients) {
    if (recipient.userId && recipient.campusId) unique.set(recipient.userId, recipient);
  }
  if (unique.size === 0) return 0;

  const message = renderNotification(input.type, input.facts);

  let created: { id: string; userId: string }[] = [];
  try {
    // createManyAndReturn keeps the fan-out to one round trip while still
    // yielding the ids the push payload needs.
    created = await prisma.notification.createManyAndReturn({
      data: [...unique.values()].map((recipient) => ({
        campusId: recipient.campusId,
        userId: recipient.userId,
        type: input.type,
        title: message.title,
        body: message.body,
        href: message.href,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
      select: { id: true, userId: true },
    });
  } catch (error) {
    logger.error("Failed to record notifications", { type: input.type, error });
    return 0;
  }

  if (shouldPush(input.type) && isPushConfigured()) {
    // Awaited, not detached: a serverless function that returns before its
    // pushes are sent kills them mid-flight. The cost is a few hundred
    // milliseconds on an operation that has already committed.
    await pushToRecipients(created, {
      title: message.title,
      body: message.body,
      href: message.href,
      tag: input.entityId ? `${input.entityType ?? "entity"}:${input.entityId}` : undefined,
    });
  }

  return created.length;
}

async function pushToRecipients(
  notifications: readonly { id: string; userId: string }[],
  payload: { title: string; body: string; href: string | null; tag?: string },
): Promise<void> {
  const userIds = [...new Set(notifications.map((n) => n.userId))];

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return;

  const byUser = new Map<string, PushTarget[]>();
  for (const subscription of subscriptions) {
    const list = byUser.get(subscription.userId) ?? [];
    list.push(subscription);
    byUser.set(subscription.userId, list);
  }

  const deadSubscriptionIds: string[] = [];
  const failedSubscriptionIds: string[] = [];
  const pushedNotificationIds: string[] = [];

  // One send per device, all in flight together: a campus-wide "delivery
  // available" must not take a second per agent.
  await Promise.all(
    notifications.flatMap((notification) => {
      const targets = byUser.get(notification.userId) ?? [];
      return targets.map(async (target) => {
        const outcome = await sendPush(target, { ...payload, notificationId: notification.id });

        if (outcome.status === "sent") {
          pushedNotificationIds.push(notification.id);
          return;
        }
        // One device failing is not the notification failing, and not the other
        // devices failing either.
        if (outcome.status === "gone") deadSubscriptionIds.push(target.id);
        else failedSubscriptionIds.push(target.id);
      });
    }),
  );

  try {
    if (deadSubscriptionIds.length > 0) {
      // The browser has already discarded these; keeping them would mean
      // pushing into the void on every future notification.
      await prisma.pushSubscription.deleteMany({ where: { id: { in: deadSubscriptionIds } } });
    }
    if (failedSubscriptionIds.length > 0) {
      await prisma.pushSubscription.updateMany({
        where: { id: { in: failedSubscriptionIds } },
        data: { failureCount: { increment: 1 } },
      });
    }
    if (pushedNotificationIds.length > 0) {
      const now = new Date();
      await prisma.notification.updateMany({
        where: { id: { in: pushedNotificationIds } },
        data: { pushedAt: now },
      });
      await prisma.pushSubscription.updateMany({
        where: { userId: { in: userIds } },
        data: { lastUsedAt: now, failureCount: 0 },
      });
    }
  } catch (error) {
    logger.warn("Failed to reconcile push subscriptions after sending", { error });
  }
}

/**
 * The caller's own inbox, newest first.
 *
 * Scoped by `userId` in the query, not filtered afterwards: an inbox is the most
 * tempting place to accidentally leak another campus's activity (Rule 25).
 */
export async function listMyNotifications(
  actor: Actor,
  options?: { limit?: number; unreadOnly?: boolean },
): Promise<{ notifications: NotificationView[]; unreadCount: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: actor.userId,
        ...(options?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);

  return { notifications: rows, unreadCount };
}

/** Marks one of the caller's notifications read. Idempotent. */
export async function markNotificationRead(
  actor: Actor,
  notificationId: string,
): Promise<{ id: string; readAt: Date }> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.userId },
    select: { id: true, readAt: true },
  });
  if (!existing) throw new NotFoundError("Notification not found");

  if (existing.readAt) return { id: existing.id, readAt: existing.readAt };

  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  });
  return { id: updated.id, readAt: updated.readAt as Date };
}

/** Marks everything in the caller's inbox read. Returns how many changed. */
export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * Registers or refreshes this device's push subscription (PRD §54).
 *
 * Keyed on the endpoint, which is the push service's own identifier for the
 * device: re-subscribing after a browser rotates its keys is an update, and the
 * upsert also re-homes a subscription if the user's campus changed. The campus
 * is read from the actor, never from the request body (Rule 1).
 */
export async function savePushSubscription(
  actor: Actor,
  input: PushSubscriptionInput,
  meta?: { userAgent?: string | null },
): Promise<{ id: string }> {
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId: actor.userId,
      campusId: actor.campusId ?? null,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: meta?.userAgent ?? null,
    },
    update: {
      // A shared device that a second student signs into must not keep pushing
      // the first student's orders to them.
      userId: actor.userId,
      campusId: actor.campusId ?? null,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: meta?.userAgent ?? null,
      failureCount: 0,
    },
    select: { id: true },
  });

  return saved;
}

/**
 * Removes this device's subscription.
 *
 * Scoped to the caller: knowing an endpoint must not be enough to silence
 * somebody else's phone.
 */
export async function deletePushSubscription(actor: Actor, endpoint: string): Promise<number> {
  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: actor.userId },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Audience helpers
// ---------------------------------------------------------------------------

/**
 * Every on-duty, approved agent on a campus (PRD §38).
 *
 * The only broadcast in the platform, and it is still narrow: an agent who is
 * off duty or unapproved is not an audience, because they cannot take the job.
 */
export async function onDutyAgentRecipients(campusId: string): Promise<NotifyRecipient[]> {
  const agents = await prisma.deliveryAgentProfile.findMany({
    where: { campusId, status: "APPROVED", isOnDuty: true },
    select: { userId: true },
  });
  return agents.map((agent) => ({ userId: agent.userId, campusId }));
}
