"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { uploadExpenseReceipt } from "@/lib/upload-expense-receipt";

const acceptedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function AttachExpenseReceipt({ entryId }: { entryId: Id<"entries"> }) {
  const input = useRef<HTMLInputElement>(null);
  const token = useAuthToken();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<{ file: File; idempotencyKey: string } | null>(null);

  async function upload(file: File, idempotencyKey: string) {
    if (!file) return;
    if (file.size <= 0 || file.size > 5 * 1024 * 1024 || !acceptedTypes.includes(file.type)) {
      setMessage("Choose a PDF, JPEG, PNG, or WebP file under 5 MB.");
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true); setMessage("");
    try {
      await uploadExpenseReceipt({ entryId, file, token, idempotencyKey });
      setRetry(null);
      setMessage("Receipt attached.");
    } catch (error) {
      setRetry({ file, idempotencyKey });
      setMessage(error instanceof Error ? error.message : "The receipt could not be attached.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return <span className="expense-receipt-attach"><input ref={input} hidden type="file" accept={acceptedTypes.join(",")} aria-label="Choose an expense receipt" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, crypto.randomUUID()); event.currentTarget.value = ""; }} /><button className="button" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Add receipt"}</button>{retry && <button className="button" type="button" disabled={busy} onClick={() => void upload(retry.file, retry.idempotencyKey)}>{busy ? "Uploading…" : "Retry receipt"}</button>}{message && <small role="status">{message}</small>}</span>;
}
