import { execFileSync } from "node:child_process";

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
  || /^(next\.config\.|package\.json|package-lock\.json)$/.test(file),
);

if (changesApplicationCode && !changedFiles.includes("CHANGELOG.md")) {
  console.error("Application changes require a dated user-facing entry in CHANGELOG.md.");
  process.exit(1);
}

console.log(changesApplicationCode ? "Application changes include a changelog entry." : "No application changes require a changelog entry.");
