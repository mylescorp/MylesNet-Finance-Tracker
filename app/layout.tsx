import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Script from "next/script";
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

const themeBootstrap = `(()=>{try{const theme=localStorage.getItem("mylesnet-theme");if(theme==="dark"){document.documentElement.dataset.theme="dark"}else if(theme==="system"){document.documentElement.removeAttribute("data-theme")}else{document.documentElement.dataset.theme="light"}}catch{document.documentElement.dataset.theme="light"}})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ConvexAuthNextjsServerProvider><html lang="en" data-theme="light" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}><body suppressHydrationWarning><Script id="theme-bootstrap" strategy="beforeInteractive">{themeBootstrap}</Script><PwaBootstrap brandName={pwaBrand.shortName} />{children}</body></html></ConvexAuthNextjsServerProvider>;
}
