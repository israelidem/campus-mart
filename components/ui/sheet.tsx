"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useIsHydrated } from "@/lib/hooks/browser";
import { cn } from "@/lib/utils";

/**
 * Overlays: bottom sheet on phones, centred dialog on desktop.
 *
 * This component exists because of the mobile account menu in the screenshot.
 * That menu was a desktop dropdown absolutely positioned against a trigger, so
 * on a phone it ran off the viewport, could not be scrolled, and made the page
 * scroll sideways. The fix is not a smaller dropdown — it is a different
 * component. Anything overlaying content on a phone is anchored to the bottom
 * of the *viewport*, is width-constrained to it, and scrolls internally.
 *
 * What this handles that a hand-rolled overlay usually misses:
 *
 *  • Rendered through a portal into `document.body`. This is not tidiness; it is
 *    the difference between working and not. `position: fixed` resolves against
 *    the viewport *only* while no ancestor has created a containing block, and
 *    `backdrop-filter` creates one — as do `transform`, `filter` and `will-change`.
 *    The account menu lives inside a `backdrop-blur` header, so `inset-0`
 *    resolved against a 64px-tall strip and the sheet was clipped into it,
 *    unusable. Escaping to `body` means no ancestor can ever do that again,
 *    whatever styles a future header grows.
 *  • `position: fixed; inset: 0` on the container — never anchored to a trigger,
 *    so it cannot be pushed outside the viewport by its parent.
 *  • `max-height: 85dvh` with internal overflow — a long menu scrolls instead
 *    of clipping, and `dvh` accounts for the mobile URL bar.
 *  • `pb-safe` — the last row clears the iOS home indicator.
 *  • Escape to close, and a click on the backdrop to close.
 *  • Focus is moved into the panel on open and restored to the trigger on
 *    close; Tab is trapped while open.
 *  • Body scroll is locked, which is what stops the page behind from moving.
 */

function useOverlayBehaviour(open: boolean, onClose: () => void) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // Compensating for the scrollbar's width prevents the content behind the
    // overlay from shifting sideways as it disappears — the jump that makes an
    // overlay feel cheap on desktop.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // Focus the panel itself rather than its first control: focusing a
    // destructive button by default is how people sign themselves out by
    // pressing Enter.
    const frame = requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(frame);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return panelRef;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** `bottom` is a mobile sheet that centres on desktop; `center` is always centred. */
  placement = "bottom",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  placement?: "bottom" | "center";
  className?: string;
}) {
  const panelRef = useOverlayBehaviour(open, onClose);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const isHydrated = useIsHydrated();

  if (!open) return null;

  /*
   * `createPortal` needs a real `document.body`, which does not exist while
   * rendering on the server. Gating on the hydration flag rather than on
   * `typeof document` keeps the server and client agreeing about the first
   * render, which is what avoids a hydration mismatch. Nothing is lost: a sheet
   * is only ever opened by a tap, which cannot happen before hydration.
   */
  if (!isHydrated) return null;

  const overlay = (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-brand-950/45"
      />

      <div
        className={cn(
          "relative z-10 flex w-full",
          placement === "bottom"
            ? "items-end justify-center sm:items-center sm:p-6"
            : "items-center justify-center p-4 sm:p-6",
        )}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn(
            "flex max-h-[85dvh] w-full flex-col bg-raised shadow-pop outline-none",
            placement === "bottom"
              ? "animate-sheet rounded-t-sheet sm:animate-fade-up sm:max-w-md sm:rounded-sheet"
              : "animate-fade-up max-w-md rounded-sheet",
            className,
          )}
        >
          {/* Grab handle: a purely visual affordance that tells a thumb this
              panel came from the bottom edge. Hidden on desktop, where the
              panel is a centred dialog and the handle would be meaningless. */}
          {placement === "bottom" ? (
            <div className="flex shrink-0 justify-center pt-2.5 sm:hidden">
              <span aria-hidden="true" className="h-1 w-9 rounded-full bg-rule-2" />
            </div>
          ) : null}

          <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-0.5 text-sm leading-relaxed text-ink-2">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {/* The scrolling region. `overscroll-contain` stops a flick at the
              end of this list from scrolling the page behind it. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
            {children}
          </div>

          {footer ? (
            <footer className="pb-safe shrink-0 border-t border-rule px-5 py-3.5">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
            </footer>
          ) : (
            <div className="pb-safe shrink-0 pb-2" />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

/**
 * Confirmation dialog for destructive or irreversible actions — rejecting an
 * application, suspending a campus, cancelling a delivery. Replaces
 * `window.confirm` and `window.prompt`, both of which were in use: they cannot
 * be styled, they cannot be tested, and on mobile they are indistinguishable
 * from a browser warning.
 *
 * `requireReason` turns it into the prompt replacement: the confirm button
 * stays disabled until a reason is typed, because these reasons are written to
 * the audit log and shown to the person affected.
 */
type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  isLoading?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
};

/**
 * The `open` check lives here, one level above the state, on purpose.
 *
 * A reason typed for one rejection must never be pre-filled for the next student
 * in the queue. The obvious way to guarantee that is an effect that clears the
 * field on close — but that is a `setState` inside an effect, which renders the
 * stale value once before correcting it. Unmounting the body instead makes the
 * reset structural: there is no old value to clear because there is no
 * component. `Sheet` already renders nothing while closed, so this changes
 * nothing visually.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

function ConfirmDialogBody({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  isLoading = false,
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState("");
  const reasonId = React.useId();

  const canConfirm = !requireReason || reason.trim().length > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      placement="center"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
            disabled={!canConfirm}
            isLoading={isLoading}
            loadingLabel="Working…"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {requireReason ? (
        <div className="space-y-1.5 pb-2">
          <label htmlFor={reasonId} className="block text-sm font-medium text-ink">
            {reasonLabel}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={reasonPlaceholder}
            className="w-full rounded-control border border-rule-2 bg-surface px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-ink placeholder:text-ink-3 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/12"
          />
          <p className="text-xs text-ink-3">
            This is recorded and shown to the person affected, so keep it factual.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
