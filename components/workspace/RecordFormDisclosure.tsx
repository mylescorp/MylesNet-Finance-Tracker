import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Keeps record-entry cards out of the way until the user asks to create one. */
export function RecordFormDisclosure({ title, description, children, id, open, hideTrigger = false, onClose }: { title: string; description?: string; children: ReactNode; id?: string; open?: boolean; hideTrigger?: boolean; onClose?: () => void }) {
  if (hideTrigger) return <div id={id} className="record-form-disclosure record-form-disclosure-top-trigger" role="region" aria-label={title} hidden={!open}>
    <div className="record-form-open-heading"><div><strong>{title}</strong>{description && <span>{description}</span>}</div>{onClose && <button className="icon-button" type="button" aria-label={`Close ${title.toLowerCase()} form`} onClick={onClose}><X size={15} /></button>}</div>
    {children}
  </div>;

  return <details id={id} className="record-form-disclosure" open={open}>
    <summary className="record-form-trigger">
      <span className="record-form-trigger-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <span className="record-form-trigger-action" aria-hidden="true">Open form</span>
    </summary>
    {children}
  </details>;
}
