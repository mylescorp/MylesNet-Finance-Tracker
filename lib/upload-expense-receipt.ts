import type { Id } from "@/convex/_generated/dataModel";

function siteEndpoint(path: string) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!configuredSiteUrl && !cloudUrl) throw new Error("Receipt access is unavailable because the workspace connection is not configured.");
  const url = new URL(configuredSiteUrl || cloudUrl!);
  if (!configuredSiteUrl) {
    if (url.hostname.endsWith(".convex.cloud")) url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    else if (url.port === "3210") url.port = "3211";
  }
  return `${url.origin}${path}`;
}

export async function uploadExpenseReceipt(args: { entryId: Id<"entries">; file: File; token: string | null; idempotencyKey: string }) {
  if (!args.token) throw new Error("Sign in again before attaching a receipt.");
  const response = await fetch(`${siteEndpoint("/expense-receipt")}?entryId=${encodeURIComponent(args.entryId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": args.file.type,
      "X-File-Name": encodeURIComponent(args.file.name),
      "X-Idempotency-Key": args.idempotencyKey,
    },
    body: args.file,
  });
  let result: { message?: string } = {};
  try { result = await response.json() as { message?: string }; } catch { /* The status still reports a failed upload. */ }
  if (!response.ok) throw new Error(result.message ?? "The receipt could not be attached. Try again.");
}

export async function downloadExpenseReceipt(args: { receiptId: Id<"expenseReceipts">; token: string | null }) {
  if (!args.token) throw new Error("Sign in again before viewing this receipt.");
  const response = await fetch(`${siteEndpoint("/expense-receipt")}?receiptId=${encodeURIComponent(args.receiptId)}`, { headers: { Authorization: `Bearer ${args.token}` } });
  if (!response.ok) {
    let result: { message?: string } = {};
    try { result = await response.json() as { message?: string }; } catch { /* Fall through to the generic response. */ }
    throw new Error(result.message ?? "This receipt is not available to your account.");
  }
  const encodedName = response.headers.get("x-file-name") ?? "receipt";
  let fileName = "receipt";
  try { fileName = decodeURIComponent(encodedName); } catch { /* Keep the safe fallback. */ }
  return { fileName, contentType: response.headers.get("content-type") ?? "application/octet-stream", blob: await response.blob() };
}
