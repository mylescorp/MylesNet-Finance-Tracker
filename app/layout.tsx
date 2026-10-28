import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import PwaBootstrap from "@/components/PwaBootstrap";
import { pwaBrand } from "@/lib/pwa-brand";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrument = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: pwaBrand.name,
  description: pwaBrand.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/logo.png",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: pwaBrand.shortName,
  },
};

export const viewport: Viewport = {
  themeColor: pwaBrand.themeColor,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ConvexAuthNextjsServerProvider><html lang="en"><body className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}><PwaBootstrap brandName={pwaBrand.shortName} />{children}</body></html></ConvexAuthNextjsServerProvider>;
}
