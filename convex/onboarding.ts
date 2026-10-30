import { v } from "convex/values";
import { query } from "./_generated/server";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

export const checklist = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"),
      tasks: v.array(v.object({ id: v.string(), title: v.string(), detail: v.string(), href: v.string(), state: v.union(v.literal("done"), v.literal("action"), v.literal("recommended")) })),
    }),
  ),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "dashboard.view"))) return { access: "restricted" as const };
    const businessId = current.business._id;
    const [balances, firstEntry, firstOperationalRecord, firstReconciliation, memberships, importBatch] = await Promise.all([
      ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId)).take(2),
      ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
      ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId)).first(),
      ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
      ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId)).take(101),
      ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", businessId)).first(),
    ]);
    const ledgerStarted = Boolean(firstEntry || firstOperationalRecord);
    const bothOpeningAccountsHaveRecords = balances.some(row => row.account === "cash" && row.openingBalanceUgx !== undefined)
      && balances.some(row => row.account === "mobile_money" && row.openingBalanceUgx !== undefined);
    const reconciled = Boolean(firstReconciliation);
    const openingState = reconciled || bothOpeningAccountsHaveRecords ? "done" as const : "action" as const;
    return {
      access: "ready" as const,
      tasks: [
        { id: "business", title: "Confirm business details", detail: `${current.business.name} · ${current.business.currency} · ${current.business.timezone}`, href: "/settings/general", state: Boolean(current.business.name.trim() && current.business.currency && current.business.timezone) ? "done" as const : "action" as const },
        { id: "balances", title: "Set or verify starting balances", detail: ledgerStarted && !bothOpeningAccountsHaveRecords && !reconciled ? "Ledger activity already exists. Opening balances are locked; reconcile funds and use an auditable adjustment if needed." : "Confirm cash and mobile-money balances against real funds before relying on totals.", href: "/settings/finance", state: openingState },
        { id: "access", title: "Review team access", detail: memberships.length > 1 ? `${memberships.length - 1} additional active workspace member${memberships.length === 2 ? "" : "s"}.` : "Invite staff or assign roles when the team is ready.", href: "/settings/access", state: memberships.length > 1 ? "done" as const : "recommended" as const },
        { id: "imports", title: "Review imports", detail: importBatch ? "Import history is available for review." : "Only needed when bringing existing transaction history into the workspace.", href: "/settings/data", state: importBatch ? "done" as const : "recommended" as const },
        { id: "closeout", title: "Complete a first reconciliation", detail: reconciled ? "A reconciliation record is saved." : "Count cash and confirm mobile-money funds against the book balances.", href: "/reconcile", state: reconciled ? "done" as const : "action" as const },
      ],
    };
  },
});
