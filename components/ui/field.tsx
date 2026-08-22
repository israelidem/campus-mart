"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Form controls.
 *
 * The previous inputs were `bg-transparent` with a `border-current/15`. On the
 * cream page that produced a control you could barely see, and inside a card it
 * disappeared entirely. Every control here has a real surface, a real border,
 * and a focus ring drawn from the brand ramp so keyboard users can always tell
 * where they are.
 */

const CONTROL = cn(
  "w-full rounded-control border bg-surface text-ink transition-colors",
  "border-rule-2 placeholder:text-ink-3",
  "focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/12",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/12",
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, "h-11 px-3.5 text-[0.9375rem]", className)} {...props} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL, "resize-y px-3.5 py-2.5 text-[0.9375rem] leading-relaxed", className)}
      {...props}
    />
  );
});

/**
 * Native select with our own chevron. A native control is deliberate: on a
 * phone it opens the OS picker, which is faster to operate one-handed and
 * always fits the viewport — the exact failure mode a custom dropdown has.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          CONTROL,
          "h-11 appearance-none pl-3.5 pr-10 text-[0.9375rem]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return <label className={cn("block text-sm font-medium text-ink", className)} {...props} />;
}

/**
 * Labelled field with accessible error wiring: the message is linked through
 * `aria-describedby`, the control is marked `aria-invalid`, and the error is
 * announced. `optional` prints a quiet marker instead of the more common
 * required asterisk — most fields in this product are required, so marking the
 * exceptions is less visual noise.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional ? <span className="text-xs text-ink-3">Optional</span> : null}
      </div>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
          })
        : children}

      {hint && !error ? (
        <p id={hintId} className="text-xs leading-relaxed text-ink-3">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-3.5 shrink-0" fill="currentColor">
            <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 4.5h1.5v5h-1.5v-5zm0 6.25h1.5v1.5h-1.5v-1.5z" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Password input with a visibility toggle.
 *
 * Required by §13, and worth a primitive rather than a per-screen
 * implementation: the toggle must announce its state to a screen reader and
 * must not submit the form, both of which are easy to get wrong once and then
 * copy everywhere.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, InputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(CONTROL, "h-11 pl-3.5 pr-12 text-[0.9375rem]", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          {visible ? (
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l14 14" strokeLinecap="round" />
              <path d="M8.2 8.3a2.5 2.5 0 003.5 3.5" strokeLinecap="round" />
              <path
                d="M6.2 6.3C4.5 7.4 3.2 8.9 2.5 10c1.3 2.2 4.1 5 7.5 5 1.2 0 2.3-.3 3.3-.9M12.4 5.4A7.6 7.6 0 0010 5c-.5 0-1 .05-1.4.14M17.5 10c-.5-.9-1.4-2-2.6-3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 10S5.3 5 10 5s7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" strokeLinecap="round" />
              <circle cx="10" cy="10" r="2.5" />
            </svg>
          )}
        </button>
      </div>
    );
  },
);

/**
 * A search field. Its own component because search is the front door of the
 * marketplace and appears on four screens; `type="search"` gives phones the
 * right keyboard and a native clear affordance.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute left-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-ink-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="M13.2 13.2L17 17" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        className={cn(
          CONTROL,
          "h-12 rounded-full pl-11 pr-4 text-[0.9375rem] [&::-webkit-search-cancel-button]:appearance-none",
          className,
        )}
        {...props}
      />
    </div>
  );
});

/**
 * An accessible switch. Used for "accepting orders", "on duty", and other
 * single-toggle operational states where a checkbox would read as a form field
 * rather than a live control.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id: string;
}) {
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs leading-relaxed text-ink-2">
            {description}
          </p>
        ) : null}
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "bg-brand-600" : "bg-rule-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow-soft transition-[left]",
            checked ? "left-[1.375rem]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
