import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangelogEntry = {
  id: string;
  date: string;
  version: string;
  title: string;
  sections: { title: string; items: string[] }[];
  status: "released" | "upcoming";
};

function readChangelogSource() {
  return readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
}

export function currentAppVersion() {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function readPendingChangesets(): ChangelogEntry[] {
  const changesetDirectory = join(process.cwd(), ".changeset");
  if (!existsSync(changesetDirectory)) return [];
  return readdirSync(changesetDirectory)
    .filter(file => file.endsWith(".md") && file !== "README.md" && file !== "versioned-changelog.md")
    .flatMap(file => {
      const source = readFileSync(join(changesetDirectory, file), "utf8");
      const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (!match) return [];
      const release = match[1].match(/^['"]?mylesnet-finance-tracker['"]?:\s*(major|minor|patch)\s*$/m);
      if (!release) return [];
      const [title, ...descriptionLines] = match[2].trim().split(/\r?\n/);
      const description = descriptionLines.join(" ").trim();
      if (!title?.trim() || !description) return [];
      const id = file.slice(0, -".md".length);
      const category = release[1] === "major" ? "Breaking changes" : release[1] === "minor" ? "New" : "Fixes";
      return [{
        id,
        date: "Next release",
        version: "",
        title: title.trim(),
        sections: [{ title: category, items: [description] }],
        status: "upcoming" as const,
      }];
    });
}

export function readChangelog(options: { includePending?: boolean } = {}): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let version = "";
  let date = "";
  let entry: ChangelogEntry | undefined;
  let section: ChangelogEntry["sections"][number] | undefined;
  let nextEntryId = "";

  for (const line of readChangelogSource().split(/\r?\n/)) {
    const cardId = line.match(/^<!-- change-id: ([a-zA-Z0-9_-]+) -->$/);
    if (cardId) {
      nextEntryId = cardId[1];
      continue;
    }
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
      entry = { id: nextEntryId || `${version}-${entries.length}`, date, version, title: heading[2], sections: [], status: "released" };
      nextEntryId = "";
      section = { title: heading[1], items: [] };
      entry.sections.push(section);
      entries.push(entry);
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item && entry && section) section.items.push(item[1]);
  }

  const includePending = options.includePending ?? (process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview");
  return includePending ? [...readPendingChangesets(), ...entries] : entries;
}

export function readChangelogSummary() {
  const entries = readChangelog();
  const entryIds = entries.map(entry => entry.id || createHash("sha256").update(`${entry.version}:${entry.title}`).digest("hex"));
  // Keep the previous content-hash IDs during migration so readers who opened
  // What's new before stable IDs were introduced do not see old cards as new.
  const legacyEntryIds = entries.map(entry => createHash("sha256").update(JSON.stringify({
    date: entry.date,
    version: entry.version,
    title: entry.title,
    sections: entry.sections,
    status: entry.status,
  })).digest("hex"));
  const contentHash = createHash("sha256").update(JSON.stringify(entryIds)).digest("hex");
  return { contentHash, entryIds, legacyEntryIds, totalChanges: entryIds.length };
}
