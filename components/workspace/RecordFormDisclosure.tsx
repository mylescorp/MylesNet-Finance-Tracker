import type { ReactNode } from "react";

/** Keeps record-entry cards out of the way until the user asks to create one. */
export function RecordFormDisclosure({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <details className="record-form-disclosure">
    <summary className="record-form-trigger">
      <span className="record-form-trigger-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <span className="record-form-trigger-action" aria-hidden="true">Open form</span>
    </summary>
    {children}
  </details>;
}
