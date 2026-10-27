import { Card, WorkspaceTitle } from "@/components/AppShell";
import { EntryForm } from "@/components/workspace/EntryForm";

export default function ExpensesPage() {
  return <><WorkspaceTitle eyebrow="Cashbook" title="Expenses" description="Record money spent by the business." /><Card><div className="card-heading"><div><h2 className="card-title">New expense</h2><p className="card-subtitle">Each entry is attributed to the signed-in user and recorded in the audit trail.</p></div></div><EntryForm kind="expense" /></Card></>;
}
