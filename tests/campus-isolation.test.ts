import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/session";
import { assertOwnership, assertSameCampus, campusScope } from "@/lib/authorization/campus";
import { ForbiddenError } from "@/lib/errors";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user_1",
    email: "student@example.com",
    name: "Test Student",
    role: "STUDENT",
    campusId: "campus_abuad",
    emailVerified: true,
    isSuspended: false,
    ...overrides,
  };
}

describe("campus isolation", () => {
  it("locks campus-bound roles to their own campus", () => {
    expect(campusScope(actor(), { isAvailable: true })).toEqual({
      isAvailable: true,
      campusId: "campus_abuad",
    });
  });

  it("rejects a campus-bound actor requesting another campus", () => {
    expect(() => campusScope(actor(), {}, "campus_uniuyo")).toThrow(ForbiddenError);
  });

  it("rejects a campus admin reaching into another campus", () => {
    const admin = actor({ role: "CAMPUS_ADMIN" });
    expect(() => assertSameCampus(admin, "campus_uniuyo")).toThrow(ForbiddenError);
    expect(() => assertSameCampus(admin, "campus_abuad")).not.toThrow();
  });

  it("rejects an actor with no campus", () => {
    expect(() => campusScope(actor({ campusId: null }))).toThrow(ForbiddenError);
  });

  it("allows a super admin globally or scoped to one campus", () => {
    const superAdmin = actor({ role: "SUPER_ADMIN", campusId: null });
    expect(campusScope(superAdmin, { status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(campusScope(superAdmin, {}, "campus_uniuyo")).toEqual({ campusId: "campus_uniuyo" });
    expect(() => assertSameCampus(superAdmin, "campus_uniuyo")).not.toThrow();
  });
});

describe("ownership", () => {
  it("allows the owner and rejects other users", () => {
    expect(() => assertOwnership(actor(), "user_1")).not.toThrow();
    expect(() => assertOwnership(actor(), "user_2")).toThrow(ForbiddenError);
  });

  it("allows a campus admin only within their campus when permitted", () => {
    const admin = actor({ userId: "admin_1", role: "CAMPUS_ADMIN" });
    expect(() =>
      assertOwnership(admin, "user_2", {
        allowCampusAdmin: true,
        entityCampusId: "campus_abuad",
      }),
    ).not.toThrow();

    expect(() =>
      assertOwnership(admin, "user_2", {
        allowCampusAdmin: true,
        entityCampusId: "campus_uniuyo",
      }),
    ).toThrow(ForbiddenError);

    // Without the flag, an admin has no implicit ownership override.
    expect(() => assertOwnership(admin, "user_2")).toThrow(ForbiddenError);
  });
});
