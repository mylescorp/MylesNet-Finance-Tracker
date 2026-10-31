import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-file-name, x-idempotency-key",
  "access-control-expose-headers": "x-file-name",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" } });
}

export const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS }));

async function readLimitedBody(request: Request): Promise<ArrayBuffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_FILE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (totalBytes === 0) return null;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export const upload = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return json({ message: "Sign in again before attaching a receipt." }, 401);
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return json({ message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." }, 415);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) return json({ message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." }, 413);
  let data: ArrayBuffer | null;
  try { data = await readLimitedBody(request); } catch { return json({ message: "The receipt could not be read. Try again." }, 400); }
  if (!data) return json({ message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." }, 413);
  const entryId = new URL(request.url).searchParams.get("entryId") ?? "";
  let fileName = request.headers.get("x-file-name") ?? "";
  try { fileName = decodeURIComponent(fileName); } catch { return json({ message: "Enter a valid receipt file name." }, 400); }
  const idempotencyKey = request.headers.get("x-idempotency-key") ?? "";
  const storageId = await ctx.storage.store(new Blob([data], { type: contentType }));
  try {
    const recorded = await ctx.runMutation(internal.expenseReceipts.recordUploadedFile, { userId, entryId: entryId as Id<"entries">, storageId, requestedFileName: fileName, idempotencyKey });
    if (recorded.reused) await ctx.storage.delete(storageId);
    return json({ ok: true });
  } catch (error) {
    await ctx.storage.delete(storageId);
    const message = error instanceof Error ? error.message : "The receipt could not be attached.";
    return json({ message }, 400);
  }
});

export const download = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return json({ message: "Sign in again before viewing this receipt." }, 401);
  const receiptId = new URL(request.url).searchParams.get("receiptId") ?? "";
  let file: { storageId: Id<"_storage">; fileName: string; contentType: string } | null = null;
  try { file = await ctx.runQuery(internal.expenseReceipts.authorizedFile, { userId, receiptId: receiptId as Id<"expenseReceipts"> }); } catch { /* Malformed or unauthorized ids are intentionally indistinguishable. */ }
  if (!file) return json({ message: "This receipt is not available in your workspace." }, 404);
  const blob = await ctx.storage.get(file.storageId);
  if (!blob) return json({ message: "This receipt file is no longer available." }, 404);
  const safeName = encodeURIComponent(file.fileName);
  return new Response(blob, { headers: { ...CORS_HEADERS, "content-type": file.contentType, "content-disposition": `inline; filename*=UTF-8''${safeName}`, "x-file-name": safeName, "x-content-type-options": "nosniff" } });
});
