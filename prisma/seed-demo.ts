import "dotenv/config";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/slug";

/**
 * Demo marketplace seed.
 *
 * `prisma/seed.ts` deliberately only bootstraps the platform owner and the first
 * campus — everything else is supposed to arrive through the UI. That is correct
 * for production but leaves the marketplace completely empty, and §27 of the
 * UI/UX brief is explicit that the redesigned storefront must be demonstrated
 * against the real database rather than hardcoded fixtures. An empty marketplace
 * also hides real bugs: a broken query and a store with no products render
 * identically.
 *
 * So this script fills in the layer the bootstrap seed cannot: approved vendors,
 * campus categories, and priced, stocked products, written through Prisma with
 * the same field names and invariants the app enforces.
 *
 * Two deliberate notes:
 *
 *  - Vendor accounts are created through Better Auth, not raw inserts, so their
 *    passwords are hashed exactly as a real sign-up would hash them and the demo
 *    vendors can actually sign in and drive the vendor dashboard.
 *  - Rating aggregates are written directly for some stores. Real ratings only
 *    exist after a completed delivery, which needs a whole order lifecycle this
 *    script does not simulate, so the counters are seeded so the marketplace has
 *    something to sort "top rated" by. `ratingSum` and `ratingAverageHundredths`
 *    are kept mutually consistent, and two stores are left unrated on purpose so
 *    the "no ratings yet" rendering path is exercised too.
 *
 * Re-running is safe: every write is an upsert keyed on the same unique
 * constraint the schema declares.
 *
 * Usage:
 *   npm run db:seed          (once, creates owner + campus)
 *   npm run db:seed:demo
 */

const CAMPUS_CODE = process.env["SEED_CAMPUS_CODE"] ?? "ABUAD";

/** Shared password for every demo vendor, so the dashboard can be signed into. */
const DEMO_PASSWORD = process.env["SEED_DEMO_PASSWORD"] ?? "campus-mart-demo-2026";

/**
 * Demo data is unmistakably fake, so it must never be creatable against a
 * production database by accident.
 */
function assertNotProduction(): void {
  if (process.env["NODE_ENV"] === "production" && process.env["ALLOW_DEMO_SEED"] !== "true") {
    throw new Error(
      "Refusing to write demo data with NODE_ENV=production. Set ALLOW_DEMO_SEED=true if this really is a demo deployment.",
    );
  }
}

/** Campus-appropriate top level of the marketplace (brief §8). */
const CATEGORIES = [
  { name: "Food", description: "Meals, snacks and small chops from campus kitchens." },
  { name: "Drinks", description: "Soft drinks, water, juices and hot beverages." },
  { name: "Fashion", description: "Clothing, footwear and accessories." },
  { name: "Electronics", description: "Chargers, earphones, accessories and repairs." },
  { name: "Books", description: "Course texts, past questions and stationery sets." },
  { name: "Beauty", description: "Skincare, haircare and grooming." },
  { name: "School supplies", description: "Notebooks, printing, and lab requirements." },
  { name: "Services", description: "Laundry, printing, tailoring and repairs." },
];

type DemoProduct = {
  name: string;
  category: string;
  priceNaira: number;
  stock: number;
  unitLabel?: string;
  description: string;
  soldCount?: number;
};

type DemoVendor = {
  storeName: string;
  email: string;
  phone: string;
  storefrontLocation: string;
  description: string;
  /** Omitted for stores that should render as "no ratings yet". */
  rating?: { count: number; average: number };
  products: DemoProduct[];
};

const VENDORS: DemoVendor[] = [
  {
    storeName: "Campus Bites",
    email: "campusbites.demo@campusmart.test",
    phone: "08030000001",
    storefrontLocation: "Shop 4, Student Centre",
    description:
      "Hot rice, grills and swallow served all day. Order ahead and skip the queue between lectures.",
    rating: { count: 128, average: 4.8 },
    products: [
      {
        name: "Chicken & Chips",
        category: "Food",
        priceNaira: 3500,
        stock: 40,
        description: "Fried chicken quarter with seasoned potato chips and coleslaw.",
        soldCount: 312,
      },
      {
        name: "Jollof Rice & Beef",
        category: "Food",
        priceNaira: 2200,
        stock: 60,
        description: "Party-style jollof with a beef cut and fried plantain.",
        soldCount: 480,
      },
      {
        name: "Egusi & Pounded Yam",
        category: "Food",
        priceNaira: 2800,
        stock: 25,
        description: "Melon seed soup with assorted meat and freshly pounded yam.",
        soldCount: 96,
      },
      {
        name: "Meat Pie",
        category: "Food",
        priceNaira: 700,
        stock: 80,
        unitLabel: "piece",
        description: "Buttery crust with minced beef, potato and carrot filling.",
        soldCount: 640,
      },
      {
        name: "Chapman",
        category: "Drinks",
        priceNaira: 1200,
        stock: 30,
        unitLabel: "bottle",
        description: "Chilled Nigerian Chapman, served in a 50cl bottle.",
        soldCount: 143,
      },
      {
        name: "Peppered Snail",
        category: "Food",
        priceNaira: 4500,
        // Deliberately zero. Browse queries filter on `stockQuantity > 0`, so
        // this product is *hidden* from the grid rather than shown as sold out —
        // which is the behaviour we want to be able to see: a store's item count
        // should reflect what a student can actually buy today.
        stock: 0,
        description: "Weekend special. Sells out fast.",
        soldCount: 58,
      },
    ],
  },
  {
    storeName: "Hostel Mart",
    email: "hostelmart.demo@campusmart.test",
    phone: "08030000002",
    storefrontLocation: "Ground floor, Hostel B",
    description:
      "The provisions shop inside your hostel. Toiletries, noodles and drinks without leaving the building.",
    rating: { count: 74, average: 4.5 },
    products: [
      {
        name: "Indomie Chicken (Carton)",
        category: "Food",
        priceNaira: 8900,
        stock: 15,
        unitLabel: "carton",
        description: "Full carton of 40 packs. Cheaper than buying singles.",
        soldCount: 61,
      },
      {
        name: "Bottled Water (Pack)",
        category: "Drinks",
        priceNaira: 1500,
        stock: 50,
        unitLabel: "pack of 12",
        description: "Chilled table water, sold by the pack.",
        soldCount: 220,
      },
      {
        name: "Antiseptic Soap",
        category: "Beauty",
        priceNaira: 950,
        stock: 45,
        description: "Medicated bar soap, 175g.",
        soldCount: 189,
      },
      {
        name: "Detergent Sachet",
        category: "Services",
        priceNaira: 400,
        stock: 120,
        unitLabel: "sachet",
        description: "Enough for one bucket of hostel laundry.",
        soldCount: 512,
      },
      {
        name: "Phone Charger (Type-C)",
        category: "Electronics",
        priceNaira: 3200,
        stock: 18,
        description: "Fast-charge brick with a 1m braided Type-C cable.",
        soldCount: 47,
      },
    ],
  },
  {
    storeName: "The Book Corner",
    email: "bookcorner.demo@campusmart.test",
    phone: "08030000003",
    storefrontLocation: "Beside the Faculty of Law car park",
    description:
      "Course texts, past questions and printing. Bring your material on a flash drive or send it ahead.",
    rating: { count: 39, average: 4.9 },
    products: [
      {
        name: "Engineering Mathematics (Stroud)",
        category: "Books",
        priceNaira: 12500,
        stock: 8,
        description: "Seventh edition, clean copy.",
        soldCount: 22,
      },
      {
        name: "Past Questions Bundle — 100 Level",
        category: "Books",
        priceNaira: 2500,
        stock: 35,
        unitLabel: "bundle",
        description: "Compiled and sorted by course code, last five sessions.",
        soldCount: 148,
      },
      {
        name: "A4 Photocopy",
        category: "School supplies",
        priceNaira: 30,
        stock: 5000,
        unitLabel: "page",
        description: "Black and white, same-day.",
        soldCount: 8400,
      },
      {
        name: "Hardcover Notebook (200 leaves)",
        category: "School supplies",
        priceNaira: 1800,
        stock: 60,
        description: "Ruled, stitched binding that survives a full session.",
        soldCount: 176,
      },
      {
        name: "Project Binding",
        category: "Services",
        priceNaira: 3500,
        stock: 40,
        unitLabel: "copy",
        description: "Hard binding with gold lettering, ready in 24 hours.",
        soldCount: 63,
      },
    ],
  },
  {
    storeName: "Threads by Zainab",
    email: "threads.demo@campusmart.test",
    phone: "08030000004",
    storefrontLocation: "Room 12, Postgraduate Hostel",
    description:
      "Ready-to-wear and campus-friendly tailoring. Message before ordering if you need a custom size.",
    products: [
      {
        name: "Oversized Graphic Tee",
        category: "Fashion",
        priceNaira: 6500,
        stock: 22,
        description: "Heavyweight cotton, screen-printed. Unisex sizing S–XXL.",
        soldCount: 74,
      },
      {
        name: "Ankara Two-Piece",
        category: "Fashion",
        priceNaira: 15000,
        stock: 9,
        description: "Wax print co-ord set, lined. Made to your measurements.",
        soldCount: 31,
      },
      {
        name: "Campus Hoodie",
        category: "Fashion",
        priceNaira: 12000,
        stock: 14,
        description: "Brushed fleece inside, embroidered chest mark.",
        soldCount: 58,
      },
      {
        name: "Trouser Alteration",
        category: "Services",
        priceNaira: 2000,
        stock: 30,
        unitLabel: "item",
        description: "Hem, waist or taper. Next-day turnaround.",
        soldCount: 112,
      },
    ],
  },
  {
    storeName: "Gadget Clinic",
    email: "gadgetclinic.demo@campusmart.test",
    phone: "08030000005",
    storefrontLocation: "Shop 9, Commercial Area",
    description:
      "Screen replacements, battery swaps and accessories. Diagnostics are free; you approve the quote first.",
    products: [
      {
        name: "Wireless Earbuds",
        category: "Electronics",
        priceNaira: 18500,
        stock: 12,
        description: "Bluetooth 5.3, charging case, roughly 5 hours per charge.",
        soldCount: 44,
      },
      {
        name: "20,000mAh Power Bank",
        category: "Electronics",
        priceNaira: 14000,
        stock: 20,
        description: "Two USB-A ports and a Type-C input. Survives a hostel blackout.",
        soldCount: 87,
      },
      {
        name: "Laptop Cooling Pad",
        category: "Electronics",
        priceNaira: 9500,
        stock: 7,
        description: "Five-fan pad with adjustable height.",
        soldCount: 19,
      },
      {
        name: "Phone Screen Replacement",
        category: "Services",
        priceNaira: 25000,
        stock: 10,
        unitLabel: "repair",
        description: "Original-grade panel with a 3-month warranty on the part.",
        soldCount: 36,
      },
      {
        name: "Screen Protector Fitting",
        category: "Services",
        priceNaira: 1500,
        stock: 60,
        unitLabel: "fitting",
        description: "Tempered glass fitted while you wait, bubbles guaranteed out.",
        soldCount: 203,
      },
    ],
  },
];

/** Stores trade 08:00–21:00 every day, so "Open now" is true during a demo. */
const OPENS_AT_MINUTE = 8 * 60;
const CLOSES_AT_MINUTE = 21 * 60;

/**
 * Creates a demo vendor's login through Better Auth when it does not exist, so
 * the password hash matches a real sign-up, then puts the account on the campus
 * with the VENDOR role.
 */
async function ensureVendorUser(
  vendor: DemoVendor,
  campusId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { email: vendor.email },
    select: { id: true },
  });

  const id =
    existing?.id ??
    (
      await auth.api.signUpEmail({
        body: { name: vendor.storeName, email: vendor.email, password: DEMO_PASSWORD },
        asResponse: false,
      })
    ).user.id;

  // Better Auth creates every account as an unverified STUDENT with no campus.
  // A vendor needs the role, the campus, and a verified email to be usable.
  await prisma.user.update({
    where: { id },
    data: {
      role: "VENDOR",
      campusId,
      emailVerified: true,
      phone: vendor.phone,
    },
  });

  return { id, created: !existing };
}

async function main(): Promise<void> {
  assertNotProduction();

  const campus = await prisma.campus.findUnique({
    where: { code: CAMPUS_CODE },
    select: { id: true, code: true, name: true },
  });

  if (!campus) {
    throw new Error(
      `Campus ${CAMPUS_CODE} does not exist. Run \`npm run db:seed\` first to create the owner and the first campus.`,
    );
  }
  console.log(`Seeding demo marketplace into ${campus.code} — ${campus.name}\n`);

  // Categories first: products reference them by id.
  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const slug = slugify(category.name);
    const row = await prisma.category.upsert({
      where: { campusId_slug: { campusId: campus.id, slug } },
      create: {
        campusId: campus.id,
        name: category.name,
        slug,
        description: category.description,
        sortOrder: index,
        isActive: true,
      },
      update: { name: category.name, description: category.description, sortOrder: index },
      select: { id: true },
    });
    categoryIds.set(category.name, row.id);
  }
  console.log(`${CATEGORIES.length} categories ready`);

  const now = new Date();
  let productCount = 0;

  for (const vendor of VENDORS) {
    const user = await ensureVendorUser(vendor, campus.id);
    const slug = slugify(vendor.storeName);

    // Rating aggregates are kept mutually consistent: the sum is the source of
    // truth and the hundredths average is derived from it, exactly as the
    // rating service maintains them.
    const ratingSum = vendor.rating ? Math.round(vendor.rating.average * vendor.rating.count) : 0;
    const ratingAverageHundredths = vendor.rating
      ? Math.round((ratingSum * 100) / vendor.rating.count)
      : 0;

    const shared = {
      storeName: vendor.storeName,
      description: vendor.description,
      phone: vendor.phone,
      storefrontLocation: vendor.storefrontLocation,
      status: "APPROVED" as const,
      acceptingOrders: true,
      studentVendor: true,
      submittedAt: now,
      reviewedAt: now,
      ratingCount: vendor.rating?.count ?? 0,
      ratingSum,
      ratingAverageHundredths,
    };

    const profile = await prisma.vendorProfile.upsert({
      where: { campusId_slug: { campusId: campus.id, slug } },
      create: { ...shared, userId: user.id, campusId: campus.id, slug },
      update: shared,
      select: { id: true },
    });

    // Opening hours for all seven days. A day with no row is treated as closed
    // by `isWithinOperatingHours`, so a partial schedule would make the store
    // look shut.
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const hours = {
        isClosed: false,
        opensAt: OPENS_AT_MINUTE,
        closesAt: CLOSES_AT_MINUTE,
      };
      await prisma.vendorOperatingHours.upsert({
        where: { vendorProfileId_dayOfWeek: { vendorProfileId: profile.id, dayOfWeek } },
        create: { vendorProfileId: profile.id, dayOfWeek, ...hours },
        update: hours,
      });
    }

    for (const product of vendor.products) {
      const productSlug = slugify(product.name);
      const categoryId = categoryIds.get(product.category) ?? null;
      const fields = {
        name: product.name,
        description: product.description,
        // Prices live in kobo everywhere in this codebase; never a float naira.
        priceKobo: product.priceNaira * 100,
        stockQuantity: product.stock,
        lowStockThreshold: 5,
        unitLabel: product.unitLabel ?? null,
        isAvailable: true,
        soldCount: product.soldCount ?? 0,
        categoryId,
      };

      await prisma.product.upsert({
        where: { vendorProfileId_slug: { vendorProfileId: profile.id, slug: productSlug } },
        create: {
          ...fields,
          slug: productSlug,
          campusId: campus.id,
          vendorProfileId: profile.id,
        },
        update: fields,
      });
      productCount++;
    }

    console.log(
      `  ${vendor.storeName.padEnd(20)} ${String(vendor.products.length).padStart(2)} products` +
        (vendor.rating ? `  ★ ${vendor.rating.average} (${vendor.rating.count})` : "  unrated") +
        (user.created ? "  [account created]" : "  [account existed]"),
    );
  }

  console.log(
    `\nDemo marketplace ready: ${VENDORS.length} approved stores, ${productCount} products.`,
  );
  console.log(`Vendor sign-in: ${VENDORS[0]?.email} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
