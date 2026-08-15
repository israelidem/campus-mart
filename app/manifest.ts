import type { MetadataRoute } from "next";

/**
 * The installable app (PRD §55).
 *
 * Campus Mart is used walking between hostels on a phone, so it is installed
 * rather than bookmarked. A route rather than a static `manifest.json` so the
 * name and colours stay next to the code that renders them.
 *
 * `display: "standalone"` is what makes an installed Campus Mart lose the
 * browser chrome — an agent glancing at a hand-over code should not be looking
 * at an address bar.
 *
 * The shortcuts are the three things people open the app *to do*, one per role.
 * They are deliberately not a copy of the navigation: a shortcut menu with eight
 * entries is a menu nobody reads.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Mart",
    short_name: "Campus Mart",
    description:
      "Order from approved vendors on your campus and have it delivered by verified student agents.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches --color-paper so the splash screen does not flash white before the
    // first paint of a paper-coloured page.
    background_color: "#f6f7f3",
    theme_color: "#0f7a4d",
    lang: "en",
    categories: ["shopping", "food"],
    icons: [
      {
        src: "/icon.svg",
        // "any" size: an SVG scales to every launcher, which is the whole reason
        // for shipping one instead of a dozen PNGs.
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        // Android crops icons to its own shape; the maskable variant keeps the
        // mark inside the safe zone so nothing important is cut off.
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Marketplace", url: "/marketplace" },
      { name: "My orders", url: "/orders" },
      { name: "Deliveries", url: "/agent" },
    ],

  };
}
