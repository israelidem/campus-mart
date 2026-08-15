import { getActor } from "@/lib/auth/session";
import { listMyNotifications } from "@/lib/notifications/notification-service";

import { NotificationBell } from "./notification-bell";

/**
 * Server wrapper for the bell (PRD §53).
 *
 * Reads the inbox with the session already in hand, so the badge is correct in
 * the first byte of HTML instead of appearing a moment after hydration. It also
 * keeps the client component free of any auth knowledge: a signed-out visitor
 * gets nothing rendered at all, rather than a bell that 401s on its first fetch.
 *
 * Dates are serialised to ISO strings on the way across the boundary. The bell
 * formats them in the reader's own timezone, which the server does not know.
 */
export async function NotificationMenu() {
  const actor = await getActor();
  if (!actor) return null;

  const { notifications, unreadCount } = await listMyNotifications(actor, { limit: 20 });

  return (
    <NotificationBell
      initialInbox={{
        unreadCount,
        notifications: notifications.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          href: item.href,
          readAt: item.readAt ? item.readAt.toISOString() : null,
          createdAt: item.createdAt.toISOString(),
        })),
      }}
    />
  );
}
