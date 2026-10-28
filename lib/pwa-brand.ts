const brandName = process.env.PWA_BRAND_NAME?.trim();
const shortName = process.env.PWA_SHORT_NAME?.trim();
const description = process.env.PWA_DESCRIPTION?.trim();
const themeColor = process.env.PWA_THEME_COLOR?.trim();
const backgroundColor = process.env.PWA_BACKGROUND_COLOR?.trim();

export const pwaBrand = {
  name: brandName || "MylesNet Finance Tracker",
  shortName: shortName || "MylesNet Finance",
  description: description || "An auditable cashbook for your business.",
  themeColor: themeColor || "#1A395B",
  backgroundColor: backgroundColor || "#F3F3F1",
  baseDomain: process.env.PWA_BASE_DOMAIN?.trim().toLowerCase() || "finance.mylescorptech.com",
};

function tenantLabel(hostname: string): string | null {
  const baseDomain = pwaBrand.baseDomain.replace(/^\.+|\.+$/g, "");
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return null;

  const tenant = hostname.slice(0, -suffix.length);
  if (!tenant || tenant.includes(".")) return null;

  return tenant
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolvePwaHost(hostHeader: string | null, protocolHeader: string | null) {
  const rawHost = hostHeader?.split(",")[0]?.trim();
  const fallbackHost = pwaBrand.baseDomain;
  const protocol = protocolHeader?.split(",")[0]?.trim().toLowerCase() === "http" ? "http" : "https";

  try {
    if (rawHost && !/^[a-z\d.-]+(?::\d{1,5})?$/i.test(rawHost)) throw new Error("Invalid host header");
    const origin = new URL(`${protocol}://${rawHost || fallbackHost}`).origin;
    const hostname = new URL(origin).hostname.toLowerCase();
    const tenant = tenantLabel(hostname);
    return {
      origin,
      name: tenant ? `${tenant} · ${pwaBrand.name}` : pwaBrand.name,
      shortName: tenant || pwaBrand.shortName,
    };
  } catch {
    const origin = `https://${fallbackHost}`;
    return { origin, name: pwaBrand.name, shortName: pwaBrand.shortName };
  }
}
