"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiDelete, apiPost } from "@/lib/api/client";
import {
  ensureServiceWorker,
  getExistingSubscription,
  isPushAvailable,
  serialiseSubscription,
  subscribeToPush,
} from "@/lib/notifications/push-client";

type State = "checking" | "unavailable" | "off" | "on" | "denied";

/**
 * The push opt-in (PRD §54).
 *
 * A button, not a prompt on page load. Browsers permanently block a site that
 * asks for notification permission before the visitor has done anything, so the
 * one chance to ask is spent on a deliberate tap — and the copy says what will
 * be sent before the browser's own dialog appears.
 *
 * Three states are worth distinguishing, and the difference matters:
 *
 *  - **unavailable**: this browser cannot do push, or the platform has no VAPID
 *    key. Nothing is offered, because an opt-in that cannot work is a lie.
 *  - **denied**: permission was refused. The button disappears — browsers will
 *    not re-prompt, so a button that does nothing would be worse than none.
 *  - **off / on**: a real choice, and it can be reversed from here.
 *
 * The service worker also registers as a side effect of this component mounting.
 * That is on purpose: registering it is what makes the offline page work, and it
 * happens whether or not anyone opts into push.
 */
export function PushOptIn() {
  const [state, setState] = useState<State>("checking");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Registering the worker and reading the current subscription is talking to
    // an external system, which is exactly what an effect is for.
    void (async () => {
      if (!isPushAvailable()) {
        // Still register: offline support does not depend on push being
        // configured, and this is the one component present on every screen.
        await ensureServiceWorker();
        if (!cancelled) setState("unavailable");
        return;
      }

      if (Notification.permission === "denied") {
        await ensureServiceWorker();
        if (!cancelled) setState("denied");
        return;
      }

      const existing = await getExistingSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setError(null);
    setIsBusy(true);
    try {
      const result = await subscribeToPush();

      if (result.status === "denied") {
        setState("denied");
        return;
      }
      if (result.status === "unsupported") {
        setState("unavailable");
        return;
      }

      // Tell the server only after the browser has actually minted the
      // subscription: a row for an endpoint that does not exist would collect
      // failures until the first 410 cleaned it up.
      await apiPost("/api/notifications/subscribe", serialiseSubscription(result.subscription));
      setState("on");
    } catch {
      setError("We could not turn on notifications. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setIsBusy(true);
    try {
      const existing = await getExistingSubscription();

      if (existing) {
        // Server first, and the failure is swallowed on purpose. If the browser
        // unsubscribed and this request then failed, the server would keep pushing
        // to a dead endpoint; this order leaves at worst a forgotten row, which the
        // first 410 from the push service cleans up anyway.
        await apiDelete("/api/notifications/subscribe", {
          endpoint: existing.endpoint,
        }).catch(() => undefined);

        await existing.unsubscribe();
      }


      setState("off");
    } catch {
      setError("We could not turn off notifications. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  if (state === "checking" || state === "unavailable") return null;

  if (state === "denied") {
    return (
      <p className="text-sm text-ink-2">
        Notifications are blocked in this browser&rsquo;s settings. Campus Mart cannot re-ask &mdash;
        you would need to allow them for this site yourself.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {state === "on" ? (
        <>
          <p className="text-sm text-ink-2">
            Notifications are on for this device. You will hear about order updates, deliveries and
            payments even when Campus Mart is closed.
          </p>
          <Button variant="outline" isLoading={isBusy} onClick={() => void disable()}>
            Turn off notifications
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            Get told when a vendor accepts your order, an agent picks it up, and it arrives &mdash;
            without keeping the app open.
          </p>
          <Button isLoading={isBusy} onClick={() => void enable()}>
            Turn on notifications
          </Button>
        </>
      )}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
