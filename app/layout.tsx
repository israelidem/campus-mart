import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono, Karla } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";

import "./globals.css";

/*
 * Three type roles, deliberately not one family doing all three jobs:
 * - display: Bricolage Grotesque, for headlines only. Its uneven widths read as
 *   painted hostel signage rather than a startup grotesque.
 * - body: Karla, humanist and legible at phone sizes.
 * - mono: DM Mono, reserved for anything the server decided — prices, fees,
 *   OTPs, deadlines, references. If it is mono, it came from the server.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const body = Karla({
  subsets: ["latin"],
  variable: "--font-karla",
  display: "swap",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Campus Mart — Everything your campus needs, delivered",
    template: "%s · Campus Mart",
  },
  description:
    "Order from verified vendors on your campus and have it brought to your hostel by a student delivery agent. Pay on delivery with a code only you have.",
  applicationName: "Campus Mart",
  appleWebApp: {
    capable: true,
    title: "Campus Mart",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Was `maximumScale: 5`. Pinch-zoom is an accessibility requirement, and
  // capping it is the kind of thing that quietly fails an audit; `viewportFit`
  // is what lets `env(safe-area-inset-*)` return anything but zero, which the
  // bottom navigation and sheets depend on.
  viewportFit: "cover",
  themeColor: "#0b3d2c",
};

/**
 * The root layout deliberately does **not** constrain width.
 *
 * It used to wrap every page in `max-w-screen-lg`, which meant no screen could
 * ever be full-bleed: the landing hero could not reach the edges, sticky bars
 * were inset from the viewport, and the marketplace could not run a
 * scroll-to-edge product rail. Width is now each route group's decision —
 * `(app)` applies a content column, the landing page manages its own sections.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // `data-scroll-behavior` acknowledges the `scroll-behavior: smooth` declared in
  // globals.css. Without it Next.js logs a console warning on every route change,
  // and §28 does not allow console noise during normal usage.
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}>
        {/* Keyboard users land here first; without it, reaching the main content
            of the marketplace means tabbing through every category chip. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>

        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
