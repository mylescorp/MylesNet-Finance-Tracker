import { Card, WorkspaceTitle } from "@/components/AppShell";
import { EntryForm } from "@/components/workspace/EntryForm";

export default function SalesPage() {
  return <><WorkspaceTitle eyebrow="Cashbook" title="Sales" description="Record and review business income." /><Card><div className="card-heading"><div><h2 className="card-title">New sale</h2><p className="card-subtitle">Amounts are stored as whole Uganda shillings. Saved entries update the audit trail.</p></div></div><EntryForm kind="sale" /></Card></>;
}
