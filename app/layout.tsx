import type { Metadata, Viewport } from "next";

import "./globals.css";

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
      <body className="antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col sm:max-w-screen-md lg:max-w-screen-lg">
          {children}
        </div>
      </body>
    </html>
  );
}
