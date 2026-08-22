"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useIsHydrated } from "@/lib/hooks/browser";
import { cn } from "@/lib/utils";

/**
 * Toasts.
 *
 * The bug this replaces: notifications were rendered inside whichever component
 * raised them, absolutely positioned. Because an absolutely positioned element
 * resolves against its nearest positioned ancestor, a toast raised from inside a
 * card appeared relative to that card — which is why they drifted toward the
 * left edge and, when the card sat near the right of the viewport, pushed the
 * document wide enough to scroll sideways.
 *
 * Three decisions prevent that from recurring:
 *
 *  1. Toasts render through a portal into `document.body`, so no ancestor can
 *     reposition them.
 *  2. The stack is `position: fixed` with `left-0 right-0` and an explicit
 *     `max-width`, so its geometry comes from the viewport and nothing else.
 *  3. The stack is `pointer-events-none` and only each toast re-enables
 *     pointer events, so a toast can never block a tap on the page beneath it.
 *
 * Position: bottom-centre on mobile, above the bottom navigation and clear of
 * the home indicator. Bottom-right on desktop. Bottom on mobile because that is
 * where the thumb is, and because a top toast collides with the sticky header.
 */

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  /** A short label for an action, e.g. "View order". */
  action?: { label: string; onClick: () => void };
};

type ToastContextValue = {
  toast: (message: string, options?: { tone?: ToastTone; action?: Toast["action"] }) => void;
  success: (message: string, action?: Toast["action"]) => void;
  error: (message: string, action?: Toast["action"]) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

/** Errors linger; confirmations do not. */
const DURATION: Record<ToastTone, number> = {
  success: 3600,
  info: 4200,
  error: 6500,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  // `createPortal` needs a real `document.body`, which does not exist during
  // SSR. Gating on a hydration flag rather than `typeof document` keeps the
  // server render and the first client render identical.
  const isHydrated = useIsHydrated();

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>(
    (message, options) => {
      const tone = options?.tone ?? "info";
      const id = nextId.current++;

      setToasts((current) => {
        const next = [...current, { id, tone, message, action: options?.action }];
        // Three at a time. A taller stack covers the content it is describing,
        // and beyond three nobody reads them anyway.
        return next.slice(-3);
      });

      window.setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message, action) => toast(message, { tone: "success", action }),
      error: (message, action) => toast(message, { tone: "error", action }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {isHydrated
        ? createPortal(<ToastStack toasts={toasts} onDismiss={dismiss} />, document.body)
        : null}
    </ToastContext.Provider>
  );
}

/**
 * Reading a toast is not optional for a screen-reader user, so the stack is a
 * live region. `polite` rather than `assertive`: these confirm actions the user
 * just took, and interrupting them mid-sentence is worse than waiting.
 */
function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      className={cn(
        // Anchored to the viewport, never to a parent. The bottom offset clears
        // the mobile bottom navigation (56px) plus the safe area.
        "pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] px-4",
        "sm:bottom-6 sm:right-6 sm:left-auto sm:items-end sm:px-0",
      )}
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

const TONE_STYLE: Record<ToastTone, { wrap: string; icon: React.ReactNode }> = {
  success: {
    wrap: "bg-brand-900 text-white",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-brand-300" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 10.5l3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    wrap: "bg-danger text-white",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-white/85" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 6.5v4.2M10 13.3v.4" strokeLinecap="round" />
      </svg>
    ),
  },
  info: {
    wrap: "bg-ink text-white",
    icon: (
      <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-white/70" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 9v4.5M10 6.4v.4" strokeLinecap="round" />
      </svg>
    ),
  },
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const style = TONE_STYLE[toast.tone];

  return (
    <div
      className={cn(
        // `w-full` inside a `max-w` parent, so a long message wraps rather than
        // widening the stack past the viewport.
        "animate-fade-up pointer-events-auto flex w-full max-w-sm items-start gap-2.5",
        "rounded-control px-3.5 py-3 text-sm shadow-pop",
        style.wrap,
      )}
    >
      {style.icon}
      <p className="min-w-0 flex-1 leading-snug">{toast.message}</p>

      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded px-1 text-sm font-semibold underline underline-offset-2"
        >
          {toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/15 hover:text-white"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Throws when used outside the provider rather than returning a no-op. A
 * silently swallowed toast is exactly the "did my button work?" failure this
 * overhaul is meant to eliminate, so it should fail loudly in development.
 */
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
