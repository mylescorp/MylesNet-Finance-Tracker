import { readChangelogSummary } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readChangelogSummary(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
