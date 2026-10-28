import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { pwaBrand, resolvePwaHost } from "@/lib/pwa-brand";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers();
  const host = resolvePwaHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );

  return {
    id: `${host.origin}/`,
    name: host.name,
    short_name: host.shortName,
    description: pwaBrand.description,
    theme_color: pwaBrand.themeColor,
    background_color: pwaBrand.backgroundColor,
    display: "standalone",
    start_url: `${host.origin}/dashboard`,
    scope: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
