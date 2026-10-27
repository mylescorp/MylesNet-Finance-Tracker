import Link from "next/link";
import { ArrowDownUp, ArrowUpRight, HandCoins, PiggyBank, Wallet } from "lucide-react";
import { Card, WorkspaceTitle } from "@/components/AppShell";

const entryTypes = [
  { title: "Sale", detail: "Record income by date, category, and receiving account.", href: "/sales", icon: ArrowUpRight },
  { title: "Expense", detail: "Record a business cost with its category and payment account.", href: "/expenses", icon: Wallet },
  { title: "Money movement", detail: "Record a transfer, withdrawal, or partner capital contribution.", href: "/movements", icon: ArrowDownUp },
  { title: "Savings or investment", detail: "Create a holding or record a contribution or withdrawal.", href: "/savings", icon: PiggyBank },
  { title: "Loan", detail: "Register borrowing or record a principal and interest repayment.", href: "/loans", icon: HandCoins },
];

export default function AddEntryPage() {
  return <>
    <WorkspaceTitle eyebrow="Accountant entry" title="Add an entry" description="Choose what you are recording. Your saved entry updates the workspace and is added to its audit history." />
    <div className="board-grid">
      {entryTypes.map(({ title, detail, href, icon: Icon }) => <Card key={title} className="board-feature-card">
        <div className="card-heading"><span className="sidebar-link-icon"><Icon size={20} aria-hidden="true" /></span><div><h2 className="card-title">{title}</h2><p className="card-subtitle">{detail}</p></div></div>
        <Link className="button button-accent" href={href}>Continue to {title.toLowerCase()}</Link>
      </Card>)}
    </div>
  </>;
}
