import { describe, expect, it } from "vitest";

import {
  defaultOperatingHours,
  formatMinuteOfDay,
  isWithinOperatingHours,
  localDayAndMinute,
  parseMinuteOfDay,
  type OperatingHoursDay,
} from "@/lib/vendors/operating-hours";
import { operatingHoursSchema, slugifyStoreName, storeNameSchema } from "@/validations/vendor";

/** 2026-08-12 is a Wednesday (dayOfWeek 3). */
const WEDNESDAY_0900_LAGOS = new Date("2026-08-12T08:00:00Z"); // 09:00 in Lagos (UTC+1)
const WEDNESDAY_2100_LAGOS = new Date("2026-08-12T20:00:00Z"); // 21:00 in Lagos

function week(overrides: Partial<OperatingHoursDay> & { dayOfWeek: number }): OperatingHoursDay[] {
  return defaultOperatingHours().map((day) =>
    day.dayOfWeek === overrides.dayOfWeek ? { ...day, ...overrides } : day,
  );
}

describe("localDayAndMinute", () => {
  it("uses the campus timezone rather than the server's", () => {
    // Same instant, two campuses: Lagos is an hour ahead of UTC.
    expect(localDayAndMinute(WEDNESDAY_0900_LAGOS, "Africa/Lagos")).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 9 * 60,
    });
    expect(localDayAndMinute(WEDNESDAY_0900_LAGOS, "UTC")).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 8 * 60,
    });
  });

  it("rolls the weekday over when the timezone crosses midnight", () => {
    // 23:30 UTC on Wednesday is 00:30 on Thursday in Lagos.
    expect(localDayAndMinute(new Date("2026-08-12T23:30:00Z"), "Africa/Lagos")).toEqual({
      dayOfWeek: 4,
      minuteOfDay: 30,
    });
  });
});

describe("isWithinOperatingHours", () => {
  it("is open inside the configured window", () => {
    expect(isWithinOperatingHours(defaultOperatingHours(), WEDNESDAY_0900_LAGOS, "Africa/Lagos")).toBe(
      true,
    );
  });

  it("is closed outside the configured window", () => {
    expect(isWithinOperatingHours(defaultOperatingHours(), WEDNESDAY_2100_LAGOS, "Africa/Lagos")).toBe(
      false,
    );
  });

  it("is closed on a day marked closed", () => {
    const hours = week({ dayOfWeek: 3, isClosed: true, opensAt: null, closesAt: null });
    expect(isWithinOperatingHours(hours, WEDNESDAY_0900_LAGOS, "Africa/Lagos")).toBe(false);
  });

  it("treats an unconfigured day as closed", () => {
    const hours = defaultOperatingHours().filter((day) => day.dayOfWeek !== 3);
    expect(isWithinOperatingHours(hours, WEDNESDAY_0900_LAGOS, "Africa/Lagos")).toBe(false);
  });

  it("closes exactly at the closing minute", () => {
    // 20:00 Lagos, with a window that closes at 20:00.
    const closingTime = new Date("2026-08-12T19:00:00Z");
    expect(isWithinOperatingHours(defaultOperatingHours(), closingTime, "Africa/Lagos")).toBe(false);
  });
});

describe("minute-of-day helpers", () => {
  it("round-trips a time string", () => {
    expect(formatMinuteOfDay(parseMinuteOfDay("08:30") ?? -1)).toBe("08:30");
    expect(parseMinuteOfDay("8:05")).toBe(485);
  });

  it("rejects nonsense", () => {
    expect(parseMinuteOfDay("")).toBeNull();
    expect(parseMinuteOfDay("25:00")).toBeNull();
    expect(parseMinuteOfDay("10:75")).toBeNull();
  });
});

describe("operatingHoursSchema", () => {
  it("accepts a full week", () => {
    expect(operatingHoursSchema.safeParse({ days: defaultOperatingHours() }).success).toBe(true);
  });

  it("rejects a week with a missing or duplicated day", () => {
    const days = defaultOperatingHours();
    expect(operatingHoursSchema.safeParse({ days: days.slice(1) }).success).toBe(false);

    const duplicated = [...days.slice(0, 6), { ...days[5] }];
    expect(operatingHoursSchema.safeParse({ days: duplicated }).success).toBe(false);
  });

  it("rejects a closing time that is not after the opening time", () => {
    const days = defaultOperatingHours().map((day) =>
      day.dayOfWeek === 1 ? { ...day, opensAt: 20 * 60, closesAt: 8 * 60 } : day,
    );
    expect(operatingHoursSchema.safeParse({ days }).success).toBe(false);
  });

  it("rejects an open day with no times", () => {
    const days = defaultOperatingHours().map((day) =>
      day.dayOfWeek === 1 ? { ...day, opensAt: null, closesAt: null } : day,
    );
    expect(operatingHoursSchema.safeParse({ days }).success).toBe(false);
  });
});

describe("store name handling", () => {
  it("slugifies for per-campus uniqueness", () => {
    expect(slugifyStoreName("  Campus  Bites!! ")).toBe("campus-bites");
    // Two stores whose names differ only in punctuation or case collide, which
    // is what the (campusId, slug) unique constraint is meant to prevent.
    expect(slugifyStoreName("Campus Bites")).toBe(slugifyStoreName("campus  bites"));
  });

  it("collapses whitespace and rejects names without letters or digits", () => {
    expect(storeNameSchema.parse("  Campus   Bites ")).toBe("Campus Bites");
    expect(storeNameSchema.safeParse("!!!").success).toBe(false);
  });
});
