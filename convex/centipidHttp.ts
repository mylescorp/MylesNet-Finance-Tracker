import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { isIgnoredCentipidEvent } from "./centipidUtils";

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Payload { return !!value && typeof value === "object" && !Array.isArray(value); }
function asText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value)) return String(value.email || value.phone || value.msisdn || value.username || value.name || "Unknown");
  return "";
}
function pick(body: Payload, payload: Payload, keys: string[]) {
  for (const source of [body, payload]) for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}
function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value ?? "").replace(/[^0-9.\-]/g, "")) || 0;
}
function maskPII(value: string) {
  return value.replace(/([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2").replace(/\+?\d{10,13}/g, text => `***${text.slice(-3)}`);
}
function maskCustomer(value: string) {
  if (value.includes("@")) return maskPII(value);
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? `***${digits.slice(-3)}` : value;
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function json(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }

export const health = httpAction(async () => json({ status: "ok" }));

export const webhook = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (token.length < 32 || token.length > 200) return json({ status: "unauthorized" });
  const tokenHash = await hash(token);
  let raw = "";
  try { raw = await request.text(); } catch { return json({ status: "error", message: "No payload found" }); }
  if (raw.length > 65_536) return json({ status: "error", message: "Payload is too large" });
  let payload: unknown;
  try {
    if (/^\s*[\[{]/.test(raw)) payload = JSON.parse(raw) as unknown;
    else if (raw.trim()) {
      const form: Payload = {};
      for (const [key, value] of new URLSearchParams(raw)) form[key] = value;
      payload = form;
    }
  } catch { return json({ status: "error", message: "Invalid payload" }); }
  const query = new URL(request.url).searchParams;
  if (Array.isArray(payload)) payload = payload[0] ?? {};
  if (!isRecord(payload) && query.size > 0) {
    const fromQuery: Payload = {};
    query.forEach((value, key) => { if (key !== "token") fromQuery[key] = value; });
    payload = fromQuery;
  }
  if (Array.isArray(payload)) payload = payload[0] ?? {};
  if (!isRecord(payload)) return json({ status: "error", message: "No payload found" });
  const body = isRecord(payload.data) ? payload.data : isRecord(payload.payload) ? payload.payload : payload;
  const event = String(payload.event || payload.event_type || payload.topic || body.event || body.event_type || "payment.received").toLowerCase().trim().slice(0, 120);
  const ignored = isIgnoredCentipidEvent(event);
  let kind: "payment" | "voucher" | "expense" | "ignored" = "ignored";
  if (!ignored && event.includes("expense")) kind = "expense";
  else if (!ignored && event.includes("voucher") && event.includes("redeem")) kind = "voucher";
  else if (!ignored && event.includes("payment")) kind = "payment";
  const amount = Math.abs(parseAmount(pick(body, payload, ["amount", "price", "value", "total", "paid_amount", "amount_paid"])));
  const transactionIdRaw = asText(pick(body, payload, ["transaction_id", "transaction", "reference", "ref", "receipt", "receipt_number", "payment_id", "id"])).slice(0, 120);
  const transactionId = maskPII(transactionIdRaw);
  const rawHash = await hash(raw || JSON.stringify(payload));
  const eventGroup = kind === "expense" ? "expense" : "sale";
  const eventKey = await hash(transactionIdRaw ? `${eventGroup}:${transactionIdRaw}` : rawHash);
  const paymentMethod = maskPII(asText(pick(body, payload, ["gateway", "payment_method", "method", "provider"]) || (kind === "voucher" ? "Voucher Redemption" : "Centipid System")).slice(0, 120));
  let description = maskPII(asText(pick(body, payload, ["description", "note"])).slice(0, 240));
  if (kind === "voucher") description = `Voucher Redeemed: ${maskPII(asText(pick(body, payload, ["code", "voucher_code", "serial", "voucher"]))) || "Hotspot Voucher"}`;
  else if (!description) description = "Automated billing sync via Centipid Webhook";
  const customer = maskCustomer(asText(pick(body, payload, ["customer_email", "subscriber", "customer", "user", "username", "phone", "msisdn", "email"])) || "Unknown").slice(0, 100);
  const result = await ctx.runMutation(internal.centipid.processWebhook, {
    tokenHash, eventKey, rawHash, event, kind, amount, transactionId, paymentMethod, description, customer,
    category: maskPII(asText(pick(body, payload, ["category", "expense_category", "type"])).slice(0, 100)),
    account: asText(pick(body, payload, ["account", "paid_from", "source"])).slice(0, 100),
    paidTo: maskPII(asText(pick(body, payload, ["paid_to", "vendor", "payee", "title", "name", "description"])).slice(0, 100)),
  });
  if (result.status === "success") return json({ status: "success", routed: result.routed });
  if (result.status === "ignored") return json({ status: "ignored", event: result.event ?? event });
  if (result.status === "duplicate") return json({ status: "duplicate" });
  return json({ status: "unauthorized" });
});
