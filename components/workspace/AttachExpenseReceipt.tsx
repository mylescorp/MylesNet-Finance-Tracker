"use client";

import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const acceptedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function AttachExpenseReceipt({ entryId }: { entryId: Id<"entries"> }) {
  const input = useRef<HTMLInputElement>(null);
  const generate = useMutation(api.expenseReceipts.generateUploadUrl);
  const register = useMutation(api.expenseReceipts.registerUpload);
  const attach = useMutation(api.expenseReceipts.attachToEntry);
  const discard = useMutation(api.expenseReceipts.discardUpload);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(file?: File) {
    if (!file) return;
    if (file.size <= 0 || file.size > 5 * 1024 * 1024 || !acceptedTypes.includes(file.type)) {
      setMessage("Choose a PDF, JPEG, PNG, or WebP file under 5 MB.");
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true); setMessage("");
    let uploadId: Id<"expenseReceiptUploads"> | null = null;
    try {
      const session = await generate({});
      if (session === "restricted") throw new Error("Your role cannot attach receipts.");
      uploadId = session.uploadId;
      const response = await fetch(session.uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The receipt upload did not complete.");
      const result = await response.json() as { storageId?: string };
      if (!result.storageId) throw new Error("The receipt upload response was incomplete.");
      const registration = await register({ uploadId, storageId: result.storageId as Id<"_storage"> });
      if (!registration.ok) throw new Error(registration.message);
      await attach({ entryId, uploadId, fileName: file.name });
      setMessage("Receipt attached.");
    } catch (error) {
      if (uploadId) await discard({ uploadId }).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "The receipt could not be attached.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return <span className="expense-receipt-attach"><input ref={input} hidden type="file" accept={acceptedTypes.join(",")} aria-label="Choose an expense receipt" disabled={busy} onChange={event => void upload(event.currentTarget.files?.[0])} /><button className="button" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Add receipt"}</button>{message && <small role="status">{message}</small>}</span>;
}
