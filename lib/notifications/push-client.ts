import { publicEnv } from "@/lib/env";

/**
 * Browser-side push plumbing (PRD §54).
 *
 * Separated from the components so the opt-in control stays about *asking* and
 * this file stays about the Push API's sharp edges. Nothing here decides wording
 * or policy; the server owns both.
 */

/** Whether this browser can do web push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Whether the platform is configured to send. No key, no opt-in offered. */
export function isPushAvailable(): boolean {
  return isPushSupported() && publicEnv.vapidPublicKey.length > 0;
}

/**
 * Converts the VAPID public key from base64url to the byte array
 * `pushManager.subscribe` demands.
 *
 * The Push API will not take the string form, and a key that is one character
 * out fails at subscribe time with an opaque error — hence the explicit padding
 * rather than trusting the environment to be padded correctly.
 */
function toApplicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);

  // Backed by an explicit ArrayBuffer rather than `new Uint8Array(length)`: the
  // Push API's `applicationServerKey` accepts a BufferSource over a plain
  // ArrayBuffer, and the looser default type includes SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}


/**
 * Registers the service worker, once.
 *
 * Returns the ready registration so callers do not have to think about the
 * install/activate race: `navigator.serviceWorker.ready` resolves only when a
 * worker is actually in control, which is what `pushManager` needs.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return await navigator.serviceWorker.ready;
  } catch {
    // A failed registration must never break the page. Everything the app does
    // works without a service worker; only offline and push degrade.
    return null;
  }
}

/** The existing subscription for this device, if any. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await ensureServiceWorker();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export type SubscribeResult =
  | { status: "subscribed"; subscription: PushSubscription }
  | { status: "denied" }
  | { status: "unsupported" };

/**
 * Asks permission and subscribes.
 *
 * Called only from a click handler: browsers reject a permission prompt that was
 * not triggered by a user gesture, and Chrome permanently blocks a site that
 * asks on page load. The opt-in control exists precisely so this can be a
 * deliberate action.
 *
 * `userVisibleOnly: true` is required by every browser that implements push, and
 * is also a promise Campus Mart keeps: every push shows a notification.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushAvailable()) return { status: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  const registration = await ensureServiceWorker();
  if (!registration) return { status: "unsupported" };

  // Reuse whatever this device already has: subscribing twice would mint a new
  // endpoint and leave a dead row behind.
  const existing = await registration.pushManager.getSubscription();
  if (existing) return { status: "subscribed", subscription: existing };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toApplicationServerKey(publicEnv.vapidPublicKey),
  });

  return { status: "subscribed", subscription };
}

/**
 * Serialises a subscription into the shape the API accepts.
 *
 * `toJSON()` gives exactly `{ endpoint, keys: { p256dh, auth } }`, which is what
 * the validation schema expects — so the schema is checking the browser's own
 * output rather than a shape invented here.
 */
export function serialiseSubscription(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  };
}
