import { describe, expect, it } from "vitest";

import {
  applyBasisPoints,
  clampKobo,
  formatKobo,
  koboToNaira,
  multiplyKobo,
  nairaToKobo,
  sumKobo,
} from "@/lib/money";

describe("money", () => {
  it("converts naira to kobo without floating point drift", () => {
    expect(nairaToKobo(2500)).toBe(250_000);
    expect(nairaToKobo(0.1)).toBe(10);
    expect(nairaToKobo(2000)).toBe(200_000);
  });

  it("rejects amounts that cannot be expressed in whole kobo", () => {
    expect(() => nairaToKobo(1.234)).toThrow();
  });

  it("rejects non-integer and negative kobo", () => {
    expect(() => sumKobo([1.5])).toThrow();
    expect(() => sumKobo([-1])).toThrow();
  });

  it("sums and multiplies exactly", () => {
    // ₦5,000 goods + ₦3,000 goods + ₦400 + ₦500 delivery = ₦8,900
    expect(sumKobo([500_000, 300_000, 40_000, 50_000])).toBe(890_000);
    expect(multiplyKobo(200_000, 3)).toBe(600_000);
  });

  it("applies commission in basis points", () => {
    // 2.5% of ₦5,000 = ₦125
    expect(applyBasisPoints(500_000, 250)).toBe(12_500);
    expect(applyBasisPoints(1, 250)).toBe(0);
    expect(() => applyBasisPoints(500_000, 10_001)).toThrow();
  });

  it("clamps delivery fees to configured bounds", () => {
    expect(clampKobo(45_000, 20_000, 100_000)).toBe(45_000);
    expect(clampKobo(10_000, 20_000, 100_000)).toBe(20_000);
    expect(clampKobo(500_000, 20_000, 100_000)).toBe(100_000);
  });

  it("round-trips and formats", () => {
    expect(koboToNaira(250_000)).toBe(2500);
    expect(formatKobo(250_000)).toContain("2,500.00");
  });
});
