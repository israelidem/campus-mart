import { cn } from "@/lib/utils";

/**
 * The Campus Mart wordmark.
 *
 * A mark rather than plain text so the product has something recognisable at
 * 24px in a header, on an install icon, and on a delivery agent's phone in
 * sunlight. The glyph is a shopping tote whose handle doubles as a route
 * between two points — the two things this product does, in one shape.
 *
 * Built from inline SVG, not an image file: it inherits `currentColor`, so the
 * same component works on cream, on near-black, and on the brand green without
 * a second asset or a colour-inverted PNG.
 */
export function Wordmark({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2 text-ink", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-brand-700 text-white">
        <svg viewBox="0 0 24 24" className="size-[1.125rem]" fill="none" aria-hidden="true">
          {/* Tote body */}
          <path
            d="M5 8.5h14l-1.1 10.2a1.8 1.8 0 01-1.8 1.6H7.9a1.8 1.8 0 01-1.8-1.6L5 8.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          {/* Handle, drawn as a route with a stop at each end */}
          <path
            d="M9 8.5V6.4A3 3 0 0115 6.4v2.1"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="9" cy="13.2" r="1.35" fill="currentColor" />
          <circle cx="15" cy="16.4" r="1.35" fill="currentColor" />
          <path
            d="M10.1 14.1l3.8 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="1 2"
          />
        </svg>
      </span>

      {showText ? (
        <span className="font-display text-[1.0625rem] font-semibold leading-none tracking-tight">
          Campus<span className="text-brand-600">Mart</span>
        </span>
      ) : null}
    </span>
  );
}
