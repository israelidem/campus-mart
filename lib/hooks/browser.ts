"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Two browser facts that every adaptive component needs, read the way React
 * wants external values read.
 *
 * The obvious implementation of both is `useState(false)` plus an effect that
 * immediately calls `setState` — and that is exactly what these replace. That
 * pattern renders once with the wrong answer, commits it, then renders again,
 * which for the account menu meant a desktop user could see the mobile sheet
 * flash before the dropdown took over. `useSyncExternalStore` has an explicit
 * server snapshot, so hydration matches and the correct branch renders first.
 */

/**
 * Subscribe to a CSS media query.
 *
 * The server snapshot is `false` by deliberate choice, not laziness: this
 * codebase is mobile-first, so "not desktop" is the layout that must render
 * without JavaScript. Guessing the other way would ship a desktop dropdown to a
 * phone whenever hydration is slow — the §6 bug, reintroduced through the back
 * door.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A store that never changes, so React only ever reads the two snapshots. */
const neverChanges = () => () => {};

/**
 * `false` during SSR and the hydration pass, `true` afterwards.
 *
 * Used to gate `createPortal`, which needs a real `document.body`. Checking
 * `typeof document` directly would let the server and client disagree about the
 * same render and produce a hydration mismatch instead.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}
