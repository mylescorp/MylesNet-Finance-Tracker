import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangelogEntry = {
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
      const category = release[1] === "major" ? "Breaking changes" : release[1] === "minor" ? "New" : "Fixes";
      return [{
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
      entry = { date, version, title: heading[2], sections: [], status: "released" };
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
  const entryIds = entries.map(entry => createHash("sha256").update(JSON.stringify(entry)).digest("hex"));
  const contentHash = createHash("sha256").update(JSON.stringify(entryIds)).digest("hex");
  return { contentHash, entryIds, totalChanges: entryIds.length };
}
