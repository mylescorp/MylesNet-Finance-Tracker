import { Sparkles } from "lucide-react";
import { WorkspaceTitle } from "@/components/AppShell";
import { readChangelog } from "@/lib/changelog";

export default function ChangelogPage() {
  const entries = readChangelog();

  return <>
    <WorkspaceTitle title="What's new" description="Product updates, fixes, and improvements to your finance workspace." />
    <div className="changelog-list" aria-label="Product updates">
      {entries.map((entry) => <article className="changelog-entry" key={entry.id}>
        <div className="changelog-date">{entry.status === "upcoming" ? entry.date : <time dateTime={entry.date}>{new Date(`${entry.date}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</time>}</div>
        <div className="changelog-marker" aria-hidden="true" />
        <section className="card changelog-card">
          <div className="changelog-release-label"><Sparkles size={13} aria-hidden="true" /> {entry.status === "upcoming" ? "UPCOMING" : "RELEASE"} <span>{entry.status === "upcoming" ? "Next release" : `v${entry.version}`}</span></div>
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
