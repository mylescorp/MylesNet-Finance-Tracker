import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Vercel skips a deployment when this command exits 0 and builds when it exits 1.
if (process.env.VERCEL_ENV !== "production") process.exit(1);

const branch = process.env.VERCEL_GIT_COMMIT_REF;
const commit = process.env.VERCEL_GIT_COMMIT_SHA;
if (branch !== "main" || !commit || !/^[a-f0-9]{40}$/i.test(commit)) {
  // Unknown build context should not block a potentially important deployment.
  console.warn("Release gate could not identify a main-branch commit; allowing the production build.");
  process.exit(1);
}

try {
  const current = JSON.parse(readFileSync("package.json", "utf8"));
  const previousSource = execFileSync("git", ["show", `${commit}^:package.json`], { encoding: "utf8" });
  const previous = JSON.parse(previousSource);
  if (current.version === previous.version) {
    console.log(`Skipping production deployment: app version remains ${current.version}.`);
    process.exit(0);
  }
  console.log(`Production release v${current.version} detected; deploying.`);
  process.exit(1);
} catch (error) {
  console.warn("Release gate could not compare app versions; allowing the production build.", error instanceof Error ? error.message : error);
  process.exit(1);
}
