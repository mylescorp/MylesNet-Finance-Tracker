import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangelogEntry = {
  date: string;
  version: string;
  title: string;
  sections: { title: string; items: string[] }[];
};

function readChangelogSource() {
  return readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
}

export function currentAppVersion() {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

export function readChangelog(): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let version = "";
  let date = "";
  let entry: ChangelogEntry | undefined;
  let section: ChangelogEntry["sections"][number] | undefined;

  for (const line of readChangelogSource().split(/\r?\n/)) {
    const release = line.match(/^## v(\d+\.\d+\.\d+(?:-[\w.-]+)?) — (\d{4}-\d{2}-\d{2})$/);
    if (release) {
      version = release[1];
      date = release[2];
      entry = undefined;
      section = undefined;
      continue;
    }
    const heading = line.match(/^### (New|Improvements|Fixes|Breaking changes) — (.+)$/);
    if (heading && version) {
      entry = { date, version, title: heading[2], sections: [] };
      section = { title: heading[1], items: [] };
      entry.sections.push(section);
      entries.push(entry);
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item && entry && section) section.items.push(item[1]);
  }

  return entries;
}

export function readChangelogSummary() {
  const source = readChangelogSource();
  const contentHash = createHash("sha256").update(source).digest("hex");
  const entries = readChangelog();
  return { contentHash, totalChanges: entries.length };
}
