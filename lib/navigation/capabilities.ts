import type { Actor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { Capabilities } from "@/lib/navigation/navigation";

/** Everything the shell needs about the current person, from one query. */
export type ShellContext = {
  capabilities: Capabilities;
  /** The campus this person is signed in to, or null for a Super Admin. */
  campusName: string | null;
  campusCode: string | null;
};

/**
 * Resolves what the signed-in person can do, for the shell.
 *
 * One query. The shell renders on every page in the app, so this runs on every
 * page in the app; four round trips to decide which five links to draw would tax
 * every screen for the benefit of the header. The profile rows are all
 * one-to-one with the user, so a single `findUnique` with nested selects gets
 * everything the navigation model needs, campus label included.
 *
 * Only the discriminating columns are selected. The shell needs to know *that*
 * someone is an approved vendor, never their bank details, and a narrow select
 * keeps it that way as the profile models grow.
 */
export async function resolveShellContext(actor: Actor): Promise<ShellContext> {
  const row = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: {
      campus: { select: { name: true, code: true } },
      studentProfile: { select: { status: true } },
      vendorProfile: { select: { status: true } },
      agentProfile: { select: { status: true } },
      // A student has at most one cart per campus; the shell only ever wants the
      // one on the campus they are signed in to.
      carts: { select: { campusId: true, _count: { select: { items: true } } } },
    },
  });

  const cart = row?.carts.find((c) => c.campusId === actor.campusId);

  return {
    capabilities: {
      role: actor.role,
      /*
       * Taken from the actor rather than from `row.campus`, because it must mean
       * exactly what the page guards mean. Those guards test `actor.campusId`, so
       * anything else here would let navigation and the guards disagree — which is
       * the disagreement that produced the redirect loops in the first place.
       */
      hasCampus: Boolean(actor.campusId),
      /*
       * Buying requires an approved student profile *and* a campus. The campus
       * check is not redundant: a Super Admin has no campus, and a campus-less
       * account has no marketplace to shop in, so offering it a cart would be a
       * link to a page that refuses.
       */
      isVerifiedStudent: Boolean(actor.campusId) && row?.studentProfile?.status === "APPROVED",
      vendorStatus: row?.vendorProfile?.status ?? "NO_APPLICATION",
      agentStatus: row?.agentProfile?.status ?? "NO_APPLICATION",
      cartCount: cart?._count.items ?? 0,
    },
    campusName: row?.campus?.name ?? null,
    campusCode: row?.campus?.code ?? null,
  };
}
