import { describe, expect, it } from "vitest";

import {
  assertFeeBoundsCoherent,
  campusSettingsSchema,
  createCampusSchema,
} from "@/validations/campus";

describe("createCampusSchema", () => {
  it("uppercases the campus code and trims text", () => {
    const parsed = createCampusSchema.parse({
      code: " abuad ",
      name: "  Afe Babalola University ",
      city: " Ado-Ekiti ",
    });

    expect(parsed.code).toBe("ABUAD");
    expect(parsed.name).toBe("Afe Babalola University");
    expect(parsed.city).toBe("Ado-Ekiti");
  });

  it("defaults country and timezone so a campus is never half-configured", () => {
    const parsed = createCampusSchema.parse({ code: "UI", name: "University of Ibadan", city: "Ibadan" });

    expect(parsed.country).toBe("Nigeria");
    expect(parsed.timezone).toBe("Africa/Lagos");
  });

  it("rejects a code with punctuation or spaces", () => {
    expect(() =>
      createCampusSchema.parse({ code: "AB-UAD", name: "Test", city: "Ado-Ekiti" }),
    ).toThrow();
  });
});

describe("campusSettingsSchema", () => {
  it("rejects a fractional kobo amount", () => {
    expect(() => campusSettingsSchema.parse({ deliveryBaseFeeKobo: 20050.5 })).toThrow();
  });

  it("rejects a commission above 20%", () => {
    expect(() => campusSettingsSchema.parse({ commissionBps: 2001 })).toThrow();
    expect(campusSettingsSchema.parse({ commissionBps: 250 }).commissionBps).toBe(250);
  });

  it("rejects an empty update", () => {
    expect(() => campusSettingsSchema.parse({})).toThrow();
  });

  it("allows clearing the announcement with null", () => {
    expect(campusSettingsSchema.parse({ announcement: null }).announcement).toBeNull();
  });
});

describe("assertFeeBoundsCoherent", () => {
  it("accepts a minimum below the maximum", () => {
    expect(() =>
      assertFeeBoundsCoherent({ deliveryMinimumFeeKobo: 20000, deliveryMaximumFeeKobo: 150000 }),
    ).not.toThrow();
  });

  it("rejects a minimum above the maximum", () => {
    expect(() =>
      assertFeeBoundsCoherent({ deliveryMinimumFeeKobo: 200000, deliveryMaximumFeeKobo: 150000 }),
    ).toThrow();
  });
});
