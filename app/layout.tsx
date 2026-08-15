import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono, Karla } from "next/font/google";

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
    default: "Campus Mart",
    template: "%s · Campus Mart",
  },
  description:
    "Campus Mart is a campus marketplace: order from approved vendors on your campus and have it delivered by verified student agents.",
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
  maximumScale: 5,
  themeColor: "#0f7a4d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}
      >
        <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col sm:max-w-screen-md lg:max-w-screen-lg">
          {children}
        </div>
      </body>
    </html>
  );
}
