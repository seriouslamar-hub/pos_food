import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { ErrorReporter } from "@/components/error-reporter";
import { HydrationMarker } from "@/components/hydration-marker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Fast-Food POS", template: "%s · Fast-Food POS" },
  description:
    "Point of sale, kitchen display and back office for fast-food branches.",
  applicationName: "Fast-Food POS",
  appleWebApp: { capable: true, title: "POS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18181b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* The service worker only runs in production builds; the till must
            never reload by itself when the connection comes back. */}
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV !== "production"}
          reloadOnOnline={false}
        >
          {children}
        </SerwistProvider>
        <HydrationMarker />
        <ErrorReporter />
      </body>
    </html>
  );
}
