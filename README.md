# MylesNet Finance Tracker

## Product updates

The signed-in workspace changelog is available from **What's new** at the bottom of the sidebar. Its unread badge counts changes since the last visit on this browser and clears when opened. For each distinct user-visible change, add a `.changeset/*.md` file following the [Changeset instructions](./.changeset/README.md). Pull requests that change application code must include a Changeset. Do not edit `CHANGELOG.md` for ordinary feature pull requests; the release workflow updates it when preparing a versioned release.

Responsive finance workspace built with Next.js App Router, Convex, Convex Auth (Google OAuth), and Vercel. The approved design package is preserved in [`design-reference/`](./design-reference/).

## Local setup

1. Install dependencies with `npm install`.
2. Run `npm run dev`. Convex will ask you to select or create a **development** deployment and will write its URL into the local environment file.
3. Configure Google OAuth for that deployment. The callback URL is `https://<your-deployment>.convex.site/api/auth/callback/google`; set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in the Convex deployment environment, not in browser variables.
4. For the first owner only, set a strong random `OWNER_SETUP_CODE` (at least 32 characters) in that Convex deployment. Sign in with Google and use the one-time workspace setup panel. Remove the environment value after the first owner is established.

Do not point local development at the supplied production deployment. Use a separate development or staging deployment and seed it with non-production data.

## Production target

The user-provided production Convex deployment is recorded in [`DEPLOYMENTS.md`](./DEPLOYMENTS.md). Production deployment requires a scoped Convex deploy key, Google OAuth credentials and callback setup, Vercel environment variables, the first-owner setup secret, and a recovery plan. No credentials are stored in this repository.

## Current implementation scope

- Google sign-in and protected application routes.
- Business membership checks in Convex and a one-time first-owner claim.
- Auditable cashbook entries for sales and expenses, currency-precision-aware safe integer amounts, idempotency keys, daily totals, and permission-checked corrections and voiding.
- Dashboard totals and recent entries from Convex records. Empty or pending states do not use sample financial figures.
- Account balances change with recorded cash/mobile-money sales, expenses, movements, savings flows, loan activity, bill payments, and partner flows. Owners can set opening balances before ledger activity and use auditable balance adjustments later. The dashboard setup checklist tracks business details, balance verification, team access, import history, and first reconciliation. New balances begin at zero, so they must be set or reconciled against real funds before being relied on.
- Operational screens support transfers, withdrawals, deposits, savings holdings and flows, loans and repayments, recurring bills with a 90-day forecast, supplier defaults, in-app lead reminders, pause/resume, and confirmed payments, partner ownership/distributions/payouts, and cash/mobile-money reconciliation. Reviewers can sign off matched or explained counts with an audited note and reopen them with a reason. Cash counts can include an optional denomination breakdown validated against the counted total and retained with the reconciliation audit trail. These workflows preserve reversals and audit history where applicable.
- Expenses support workspace-scoped suppliers, optional supplier and invoice references on entries, and private PDF/image receipt attachments with restricted retrieval and audit history. Supplier history totals linked posted spend; item-level prices and quantities are not tracked.
- Expense budgets support monthly amounts and warning thresholds per saved category. The Expenses screen compares posted actuals over one calendar month and optional account filter with the full monthly limit; partial-month values are not prorated and multi-month ranges do not report a comparison.
- Partner access includes partner-scoped statements; partners do not receive workspace-wide totals or other partners' statements.
- CSV imports have preview, resumable batches, deduplication, history, and reversal workflows. Centipid and Google Form ingestion use separate parallel adapters with independent tokens.
- Responsive shared navigation, preserved brand images and design tokens.
- Remaining gaps include recurring expense templates, reviewer assignment/sign-off and period certificates, multi-period budget reporting, automated report delivery and external bill/calendar reminders, item-level supplier pricing, and statement-based CSV auto-matching. See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for detail.

## Webhook compatibility

See [`WEBHOOK_COMPATIBILITY.md`](./WEBHOOK_COMPATIBILITY.md). The app's Centipid route is a parallel compatibility adapter; the existing Apps Script deployment and URL have not been changed. Production cutover requires staging parity and an explicit caller update. The Google Form companion script is also separate and must be validated in a staging copy before activation.
