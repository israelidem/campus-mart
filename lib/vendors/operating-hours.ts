/**
 * Vendor opening-hours evaluation (PRD §23).
 *
 * Kept pure and free of Prisma so it can be unit-tested and reused by the
 * marketplace, the cart and the order engine. Whether a store is orderable is
 * decided on the server; the client only renders the answer (Rule 29, Rule 30).
 */

export type OperatingHoursDay = {
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: number | null;
  closesAt: number | null;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The weekday and minute-of-day at `instant` in `timeZone`.
 *
 * Opening hours are wall-clock times on a campus, so they must be compared in
 * the campus timezone rather than the server's. Vercel runs in UTC while ABUAD
 * is UTC+1, which would otherwise shift every store's hours by an hour.
 */
export function localDayAndMinute(
  instant: Date,
  timeZone: string,
): { dayOfWeek: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const dayOfWeek = WEEKDAY_INDEX[lookup("weekday")] ?? instant.getUTCDay();
  // "24" appears in some locales for midnight; normalise it to 0.
  const hour = Number(lookup("hour")) % 24;
  const minute = Number(lookup("minute"));

  return { dayOfWeek, minuteOfDay: hour * 60 + minute };
}

/** Whether the schedule has the store open at `instant`. */
export function isWithinOperatingHours(
  hours: readonly OperatingHoursDay[],
  instant: Date,
  timeZone: string,
): boolean {
  const { dayOfWeek, minuteOfDay } = localDayAndMinute(instant, timeZone);
  const today = hours.find((day) => day.dayOfWeek === dayOfWeek);

  // An unconfigured day is treated as closed: a store must state when it trades
  // before students can order from it.
  if (!today || today.isClosed) return false;
  if (today.opensAt == null || today.closesAt == null) return false;

  return minuteOfDay >= today.opensAt && minuteOfDay < today.closesAt;
}

/** "08:00" for 480. Used for display only. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "08:00" or "8:00" → minutes from midnight, or null when unparseable. */
export function parseMinuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;

  const total = hour * 60 + minute;
  return total > 24 * 60 ? null : total;
}

/** A sensible starting schedule: open 08:00–20:00 on weekdays, closed Sunday. */
export function defaultOperatingHours(): OperatingHoursDay[] {
  return Array.from({ length: 7 }, (_unused, dayOfWeek) => ({
    dayOfWeek,
    isClosed: dayOfWeek === 0,
    opensAt: dayOfWeek === 0 ? null : 8 * 60,
    closesAt: dayOfWeek === 0 ? null : 20 * 60,
  }));
}
