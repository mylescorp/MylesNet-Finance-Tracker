import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export const receive = httpAction(async (ctx, request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 32 || token.length > 200) return json({ status: "unauthorized" }, 401);
  let payload: string;
  try { payload = await request.text(); } catch { return json({ status: "error", message: "Could not read submission." }, 400); }
  if (!payload || payload.length > 16_000) return json({ status: "error", message: "Submission is empty or too large." }, 400);
  let result;
  try {
    result = await ctx.runMutation(internal.googleForms.receive, { tokenHash: await sha256(token), payload });
  } catch {
    return json({ status: "error", message: "Submission could not be processed. The Sheet response remains saved; retry after checking the connection." }, 503);
  }
  if (result.status === "unauthorized") return json({ status: "unauthorized" }, 401);
  return json({ status: result.status, message: result.message });
});
