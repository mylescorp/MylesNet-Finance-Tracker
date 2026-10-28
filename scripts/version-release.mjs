import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packageName = "mylesnet-finance-tracker";
const changesetDir = join(root, ".changeset");
const changesetFiles = readdirSync(changesetDir)
  .filter((file) => file.endsWith(".md") && file !== "README.md");

if (changesetFiles.length === 0) {
  console.error("No Changesets found; there is no release to prepare.");
  process.exit(1);
}

const changes = changesetFiles.map((file) => {
  const source = readFileSync(join(changesetDir, file), "utf8");
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`${file} must have valid Changesets frontmatter.`);

  const packageEntry = match[1].match(new RegExp(`^["']?${packageName}["']?:\\s*(major|minor|patch)\\s*$`, "m"));
  if (!packageEntry) throw new Error(`${file} must declare ${packageName} with a major, minor, or patch bump.`);

  const body = match[2].trim();
  const [title, ...descriptionLines] = body.split(/\r?\n/);
  const description = descriptionLines.join(" ").trim();
  if (!title || !description) throw new Error(`${file} must include a title and a description separated by a blank line.`);

  const bump = packageEntry[1];
  return {
    id: file.slice(0, -".md".length),
    title: title.trim(),
    description,
    category: bump === "minor" ? "New" : bump === "major" ? "Breaking changes" : "Fixes",
  };
});

const previousPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
execFileSync("npx", ["changeset", "version"], { cwd: root, stdio: "inherit" });
const nextPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (nextPackage.version === previousPackage.version) {
  throw new Error(`Changesets did not bump the app version from ${previousPackage.version}.`);
}

const packageLockPath = join(root, "package-lock.json");
const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
packageLock.version = nextPackage.version;
if (packageLock.packages?.[""]) packageLock.packages[""].version = nextPackage.version;
writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);

const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const todayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const date = `${todayParts.find((part) => part.type === "year").value}-${todayParts.find((part) => part.type === "month").value}-${todayParts.find((part) => part.type === "day").value}`;

if (changelog.includes(`## v${nextPackage.version} — `)) {
  throw new Error(`CHANGELOG.md already contains version ${nextPackage.version}.`);
}

const releaseCards = changes.map(({ id, category, title, description }) => `<!-- change-id: ${id} -->\n### ${category} — ${title}\n\n- ${description}`).join("\n\n");
const release = `## v${nextPackage.version} — ${date}\n\n${releaseCards}\n\n`;
const firstReleaseIndex = changelog.search(/^## v\d+\.\d+\.\d+(?:-[\w.-]+)? — \d{4}-\d{2}-\d{2}$/m);
const updatedChangelog = firstReleaseIndex >= 0
  ? `${changelog.slice(0, firstReleaseIndex)}${release}${changelog.slice(firstReleaseIndex)}`
  : `${changelog.trimEnd()}\n\n${release}`;
writeFileSync(changelogPath, updatedChangelog);
console.log(`Prepared ${changes.length} What's new cards for v${nextPackage.version}.`);
