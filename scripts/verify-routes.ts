/**
 * Runtime smoke check for the redesigned routes.
 *
 * `tsc --noEmit` proves the Prisma field names in `getStorefront` are real (the
 * generated client is fully typed) but cannot prove a page renders. This asks
 * the dev server for the real URLs, which compiles each route on demand and
 * turns any render-time failure into a 500 we can see.
 *
 * It also reports how much data the marketplace actually has, because §27 of the
 * brief is explicit that a beautiful marketplace over an empty database is not
 * acceptable — and an empty storefront looks identical to a broken one.
 *
 * Usage, with `npm run dev` running:  npx tsx scripts/verify-routes.ts
 */
// Loads DATABASE_URL from .env, exactly as the seeds do; without it the Prisma
// singleton throws on import.
import "dotenv/config";

import { prisma } from "@/lib/db/prisma";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  const [campuses, approvedVendors, products, categories] = await Promise.all([
    prisma.campus.count(),
    // `status`, not `verificationStatus` — VendorProfile keeps its review state
    // in `status: VerificationStatus`.
    prisma.vendorProfile.count({ where: { status: "APPROVED" } }),
    prisma.product.count(),
    prisma.category.count(),
  ]);

  console.log("--- marketplace data depth (brief §27) ---");
  console.log(`campuses          ${campuses}`);
  console.log(`approved vendors  ${approvedVendors}`);
  console.log(`categories        ${categories}`);
  console.log(`products          ${products}`);

  const store = await prisma.vendorProfile.findFirst({
    where: { status: "APPROVED" },
    select: { id: true, storeName: true },
  });

  if (store) {
    console.log(`\nstorefront under test: ${store.storeName}  ${store.id}`);
  } else {
    console.log("\nNo approved vendor — seed the database to exercise the storefront properly.");
  }

  const targets: Array<[string, string]> = [
    ["/", "landing"],
    ["/sign-in", "sign-in"],
    ["/marketplace", "marketplace"],
    [store ? `/store/${store.id}` : "/store/missing", "storefront"],
  ];

  console.log("\n--- route compile + render ---");
  let failures = 0;

  for (const [path, label] of targets) {
    try {
      // `manual` keeps an auth redirect visible as a 3xx rather than following
      // it to sign-in and reporting a misleading 200.
      const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const location = response.headers.get("location");
      const ok = response.status < 500;
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  ${response.status}  ${label.padEnd(11)} ${path}` +
          (location ? `  ->  ${location}` : ""),
      );
      if (!ok) {
        const body = await response.text();
        // Next puts the real cause in the page shell; the first stack line is
        // the useful part.
        console.log("      " + body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
      }
    } catch (error) {
      failures++;
      console.log(
        `FAIL  ---  ${label.padEnd(11)} ${path}  (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  console.log(failures === 0 ? "\nAll routes rendered." : `\n${failures} route(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
