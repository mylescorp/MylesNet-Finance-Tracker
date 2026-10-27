import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrument = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "MylesNet Finance Tracker",
  description: "A clear, auditable cashbook for MylesNet.",
  icons: { icon: "/brand/logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ConvexAuthNextjsServerProvider><html lang="en"><body className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>{children}</body></html></ConvexAuthNextjsServerProvider>;
}
