import Link from "next/link";

const sections = [
  ["General", "/settings/general"],
  ["Finance", "/settings/finance"],
  ["Rules", "/settings/rules"],
  ["Data", "/settings/data"],
  ["Releases", "/settings/releases"],
] as const;

export function SettingsNav({ current }: { current: string }) {
  return (
    <nav className="settings-links" aria-label="Settings sections">
      {sections.map(([label, href]) => (
        <Link key={href} href={href} aria-current={current === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
