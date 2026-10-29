import { execFileSync } from "node:child_process";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });

if (process.env.VERCEL_ENV === "production") {
  run("npx", [
    "convex",
    "deploy",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
    "--cmd",
    "npm run build",
  ]);
} else {
  if (process.env.VERCEL_ENV === "preview" && !process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL to the stable staging deployment for Vercel Preview builds.");
  }
  run("npm", ["run", "build"]);
}
