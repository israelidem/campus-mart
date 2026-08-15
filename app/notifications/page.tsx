import Link from "next/link";
import { redirect } from "next/navigation";

import { NotificationMenu } from "@/components/notifications/notification-menu";
import { PushOptIn } from "@/components/notifications/push-opt-in";
import { getActor } from "@/lib/auth/session";
import { listMyNotifications } from "@/lib/notifications/notification-service";

export const metadata = { title: "Notifications · Campus Mart" };

/**
 * The full notification history and the device opt-in (PRD §53–54).
 *
 * The bell in the header is for glancing; this page is for reading back through
 * the week and for the one setting that has to live somewhere findable. Push is
 * per-device, so the copy says "this device" — the same account on a laptop and a
 * phone genuinely has two separate answers.
 *
 * Rendered on the server with a full read rather than reusing the bell's client
 * list: someone who opens this page wants history, not the last twenty.
 */
export default async function NotificationsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=/notifications");

  const { notifications, unreadCount } = await listMyNotifications(actor, { limit: 100 });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <Link href="/marketplace" className="text-lg font-semibold">
          Campus Mart
        </Link>
        <NotificationMenu />
      </header>

      <div>
        <h1 className="font-display text-2xl text-ink">Notifications</h1>
        <p className="mt-1 text-sm text-ink-2">
          {unreadCount > 0
            ? `${unreadCount} unread`
            : "You are up to date."}
        </p>
      </div>

      <section className="rounded-2xl border border-rule bg-paper-2 p-4">
        <h2 className="font-display text-base text-ink">This device</h2>
        <div className="mt-2">
          <PushOptIn />
        </div>
      </section>

      <section>
        {notifications.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-rule p-6 text-center text-sm text-ink-2">
            Nothing yet. When a vendor accepts an order or an agent picks it up, it lands here.
          </p>
        ) : (
          <ul className="divide-y divide-rule rounded-2xl border border-rule bg-paper-2">
            {notifications.map((item) => {
              const row = (
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={
                        item.readAt === null
                          ? "text-sm font-semibold text-ink"
                          : "text-sm text-ink"
                      }
                    >
                      {item.title}
                    </p>
                    {item.readAt === null ? (
                      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-stamp" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{item.body}</p>
                  {/* Absolute time here, unlike the bell: this is the archive, and
                      "3h ago" is useless when scanning back through a week. */}
                  <time
                    dateTime={item.createdAt.toISOString()}
                    className="mt-1 block font-mono text-[11px] text-ink-2"
                  >
                    {item.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </time>
                </div>
              );

              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link href={item.href} className="block hover:bg-brand-50">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
