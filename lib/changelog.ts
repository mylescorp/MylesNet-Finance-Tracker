import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangelogEntry = {
  date: string;
  title: string;
  sections: { title: string; items: string[] }[];
};

function readChangelogSource() {
  return readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
}

export function readChangelog(): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | undefined;
  let section: ChangelogEntry["sections"][number] | undefined;

  for (const line of readChangelogSource().split(/\r?\n/)) {
    const release = line.match(/^## (\d{4}-\d{2}-\d{2}) — (.+)$/);
    if (release) {
      entry = { date: release[1], title: release[2], sections: [] };
      entries.push(entry);
      section = undefined;
      continue;
    }
    const heading = line.match(/^### (.+)$/);
    if (heading && entry) {
      section = { title: heading[1], items: [] };
      entry.sections.push(section);
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item && section) section.items.push(item[1]);
  }

  return entries;
}

export function readChangelogSummary() {
  const source = readChangelogSource();
  const version = createHash("sha256").update(source).digest("hex");
  const entries = readChangelog();
  const totalChanges = entries.reduce((total, current) =>
    total + current.sections.reduce((sectionTotal, section) => sectionTotal + section.items.length, 0), 0);
  return { version, totalChanges };
}
