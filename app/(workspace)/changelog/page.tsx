import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sparkles } from "lucide-react";
import { WorkspaceTitle } from "@/components/AppShell";

type ChangelogEntry = {
  date: string;
  title: string;
  sections: { title: string; items: string[] }[];
};

function readChangelog(): ChangelogEntry[] {
  const source = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | undefined;
  let section: ChangelogEntry["sections"][number] | undefined;

  for (const line of source.split(/\r?\n/)) {
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

export default function ChangelogPage() {
  const entries = readChangelog();

  return <>
    <WorkspaceTitle eyebrow="MYLESNET · UPDATES" title="What's new" description="Product updates, fixes, and improvements to your finance workspace." />
    <div className="changelog-list" aria-label="Product updates">
      {entries.map((entry) => <article className="changelog-entry" key={`${entry.date}-${entry.title}`}>
        <div className="changelog-date"><time dateTime={entry.date}>{new Date(`${entry.date}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</time></div>
        <div className="changelog-marker" aria-hidden="true" />
        <section className="card changelog-card">
          <div className="changelog-release-label"><Sparkles size={13} aria-hidden="true" /> UPDATE</div>
          <h2 className="changelog-title">{entry.title}</h2>
          {entry.sections.map((group) => <div className="changelog-section" key={group.title}>
            <h3>{group.title}</h3>
            <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>)}
        </section>
      </article>)}
      {entries.length === 0 && <section className="card changelog-empty"><h2>No updates yet</h2><p>New product updates will appear here.</p></section>}
    </div>
  </>;
}
