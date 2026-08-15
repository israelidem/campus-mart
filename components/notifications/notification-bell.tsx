"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, apiGet, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type Inbox = { notifications: NotificationItem[]; unreadCount: number };


/** Poll interval. Long enough to be cheap, short enough to feel live. */
const POLL_MS = 60_000;

/**
 * The notification centre (PRD §53).
 *
 * A polled bell rather than a socket: the platform's news arrives in minutes,
 * not milliseconds, and a campus on patchy 3G is better served by one cheap
 * request a minute than by a connection that keeps dropping and reconnecting.
 * Push already covers the urgent case when the app is closed.
 *
 * Polling pauses while the tab is hidden. A phone in a pocket should not be
 * spending data on an inbox nobody is reading, and the visibility listener means
 * reopening the app refreshes immediately rather than up to a minute later.
 *
 * The first inbox arrives as a prop from the server, so the badge is correct in
 * the first paint and there is no fetch-on-mount render cascade. The component
 * only ever talks to the network to *refresh*.
 *
 * Every string shown here was rendered by the server. The component knows how to
 * lay out a title, a body and a time; it does not know what a delivery is.
 */
export function NotificationBell({ initialInbox }: { initialInbox: Inbox }) {
  const [inbox, setInbox] = useState<Inbox>(initialInbox);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);


  const load = useCallback(async () => {
    try {
      setInbox(await apiGet<Inbox>("/api/notifications?limit=20"));
      setError(null);
    } catch (caught) {
      // A signed-out or offline visitor is not an error worth shouting about:
      // the bell simply shows nothing.
      if (caught instanceof ApiClientError && caught.status === 401) return;
      setError("We could not load your notifications.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);

    // Catch up the moment the tab comes back, rather than waiting for the next
    // tick — this is what makes the count look correct after a push is tapped.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);


  // Close on outside click and on Escape: this is a menu, and a menu that traps
  // you is worse than no menu.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  async function markAllRead() {
    // Optimistic: the request is idempotent and a stale count is corrected by the
    // next poll, so there is nothing to lose by clearing the badge immediately.
    setInbox((current) => ({
      notifications: current.notifications.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
      unreadCount: 0,
    }));

    try {
      await apiPost("/api/notifications");
    } catch {
      void load();
    }
  }

  async function markRead(id: string) {
    setInbox((current) => ({
      notifications: current.notifications.map((item) =>
        item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item,
      ),
      unreadCount: Math.max(0, current.unreadCount - 1),
    }));

    try {
      await apiPost(`/api/notifications/${id}/read`);
    } catch {
      void load();
    }
  }

  const { notifications, unreadCount } = inbox;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        className="relative inline-flex size-11 items-center justify-center rounded-xl hover:bg-brand-50"
      >
        {/* Inline SVG: one icon does not justify an icon library. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h4l-1.4-2.1a2 2 0 0 1-.35-1.13V10a5.25 5.25 0 1 0-10.5 0v3.77a2 2 0 0 1-.35 1.13L5 17h10Z"
          />
          <path strokeLinecap="round" d="M10 20a2 2 0 0 0 4 0" />
        </svg>

        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-stamp px-1 font-mono text-[10px] leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-rule bg-paper-2 shadow-lg">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <p className="font-display text-sm text-ink">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs text-brand-700 underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <p role="alert" className="px-4 py-6 text-sm text-red-700">
                {error}
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-2">
                Nothing yet. Order updates and delivery news will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {notifications.map((item) => {
                  const isUnread = item.readAt === null;

                  const content = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <p
                          className={cn(
                            "text-sm text-ink",
                            isUnread ? "font-semibold" : "font-normal",
                          )}
                        >
                          {item.title}
                        </p>
                        {isUnread ? (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-stamp"
                          />
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-ink-2">{item.body}</p>
                      <time
                        dateTime={item.createdAt}
                        className="mt-1 block font-mono text-[11px] text-ink-2"
                      >
                        {formatWhen(item.createdAt)}
                      </time>
                    </>
                  );

                  return (
                    <li key={item.id}>
                      {item.href ? (
                        <Link
                          href={item.href}
                          onClick={() => {
                            if (isUnread) void markRead(item.id);
                            setIsOpen(false);
                          }}
                          className="block px-4 py-3 hover:bg-brand-50"
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (isUnread) void markRead(item.id);
                          }}
                          className="block w-full px-4 py-3 text-left hover:bg-brand-50"
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Relative time for recent items, a date for older ones.
 *
 * Formatted in the browser deliberately: the server does not know the reader's
 * timezone, and "2 hours ago" computed server-side would be wrong for anyone
 * whose clock differs from the deployment's.
 */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;

  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
