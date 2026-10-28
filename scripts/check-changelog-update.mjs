import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const baseRef = process.env.GITHUB_BASE_REF;
if (!baseRef) {
  console.error("GITHUB_BASE_REF is required to check the pull request changes.");
  process.exit(2);
}

const base = `origin/${baseRef}`;
const changedFiles = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const changesApplicationCode = changedFiles.some((file) =>
  /^(app|components|convex|integrations|lib|public)\//.test(file)
  || /^(next\.config\.(?:js|mjs|ts)|package\.json|package-lock\.json)$/.test(file),
);

const changesetFiles = changedFiles.filter((file) => /^\.changeset\/.+\.md$/.test(file) && file !== ".changeset/README.md" && existsSync(file));
const releasePackageChanged = changedFiles.includes("package.json") && changedFiles.includes("CHANGELOG.md");

if (releasePackageChanged) {
  const basePackage = JSON.parse(execFileSync("git", ["show", `${base}:package.json`], { encoding: "utf8" }));
  const currentPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseHeader = new RegExp(`^## v${currentPackage.version.replaceAll(".", "\\.")} — \\d{4}-\\d{2}-\\d{2}$`, "m");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  if (currentPackage.version !== basePackage.version && releaseHeader.test(changelog)) {
    console.log(`Versioned release PR for v${currentPackage.version} includes its release notes.`);
    process.exit(0);
  }
}

if (!changesApplicationCode) {
  console.log("No application changes require a Changeset.");
  process.exit(0);
}

if (changesetFiles.length === 0) {
  console.error("Application changes require one user-facing Changeset per distinct feature or fix.");
  process.exit(1);
}

const packageName = "mylesnet-finance-tracker";
for (const file of changesetFiles) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`${file} must have valid Changesets frontmatter.`);
  const packageEntry = match[1].match(new RegExp(`^["']?${packageName}["']?:\\s*(major|minor|patch)\\s*$`, "m"));
  if (!packageEntry) throw new Error(`${file} must declare ${packageName} with a major, minor, or patch bump.`);
  const body = match[2].trim();
  const [title, ...descriptionLines] = body.split(/\r?\n/);
  if (!title?.trim() || !descriptionLines.join(" ").trim()) {
    throw new Error(`${file} must include a user-facing title and description separated by a blank line.`);
  }
}

console.log(`Application changes include ${changesetFiles.length} valid Changeset(s).`);
