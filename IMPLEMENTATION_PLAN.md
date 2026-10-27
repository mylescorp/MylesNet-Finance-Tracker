# MylesNet Finance Tracker — implementation plan

This plan implements the approved design package in `design-reference/`. The boards, previews, canvas source, tokens, logo, banner and original-sheet references are read-only inputs and must remain byte-for-byte unchanged. Values shown only as mock examples remain labeled as samples or estimates; they are never inserted as real finance records.

## Delivery sequence

1. **Inventory and guardrails** — map every board to a route, record the existing Convex and UI capabilities, confirm the current branch/PR state, and preserve all source assets. Keep the existing webhook untouched until its deployed contract and a staging parity path are available.
2. **Design foundation** — make the complete light and dark token palettes selectable (system/light/dark), persist the user preference, add accessible theme controls, and align the shared shell, typography, controls, charts, navigation, responsive behavior, and print/export presentation with the reference package.
3. **Shared application patterns** — build reusable period filters, KPI and insight cards, status chips, tables, chart primitives, empty/loading/error states, forms, dialogs, search/notification surfaces, and mobile navigation. Use real workspace data and clear empty states throughout.
4. **Cashbook and controls** — extend the Convex model and owner/member authorization for configurable accounts/categories, entries, transfers, opening balances, recurring bills, savings, loans, partners, audit history, weak-day tags, split corrections, reconciliation, issues, and period controls. Keep money as safe integer UGX and preserve idempotency/audit semantics.
5. **Implement all 18 boards** — Dashboard; Analytics; Sales; Expenses; Movements; Savings; Loans; Daily Report; Monthly P&L; Partners; Bills; Reconcile; Settings General, Finance, Rules, Data, Access, and Releases. Each route follows its board’s content hierarchy and uses tenant-scoped Convex data. Optional provider actions remain clearly unavailable until their provider contracts and credentials are configured.
6. **Responsive and accessibility pass** — verify desktop, tablet, and phone layouts, keyboard operation, text alternatives for charts, status labels, form feedback, and safe table behavior.
7. **Validation and release review** — run the existing type, lint, and production build checks; compare the reference assets and generated token copies; inspect the full diff; commit and create a PR. Wait for Greptile, address every finding, and repeat until the latest review is 5/5 with no new findings. Merge only after that condition is verified.

## Acceptance checklist

- All 18 design boards have corresponding working, responsive app routes; no route remains a generic scaffold.
- Light and dark themes both use the supplied token values, the selected preference persists, and system preference is respected until a manual choice is saved.
- The original reference folder and the logo/banner source files are unchanged; production images continue to use the approved assets.
- Every displayed finance value comes from authorized workspace records or is explicitly identified as a sample, estimate, or unavailable integration.
- Every Convex operation derives the identity from the session, checks business and role scope, validates amounts/dates, and records an audit event for consequential changes.
- The existing webhook URL, payload, authentication, and behavior remain unchanged until its contract and staging parity are verified.
- No provider integration is reported as operational until configured and exercised with an approved test destination.
- Existing typecheck, lint, and build checks pass; the PR has a current Greptile 5/5 review with no new findings before merge.

## Settings product scope

The Settings screen is the workspace control center. See [`SETTINGS_PRODUCT_PLAN.md`](SETTINGS_PRODUCT_PLAN.md) for the detailed behavior and safe-release boundaries. The feature branch implements country and timezone selection, currency-precision-aware entries, date/locale and fiscal preferences, categories, pre-ledger opening balances, targets, human review rules, owner-only CSV exports, expiring email-bound invites, role management, access audit history, and read-only release information.

The initial accounting model remains the approved auditable cashbook. Currency changes are allowed only before an opening balance or transaction exists. Currency conversion of a populated ledger, spreadsheet migration, off-platform backups and restore, automated email delivery, and deployment rollback remain separate integrations that need source contracts and staging validation.

## Current branch status

- Settings screens are being connected to tenant-scoped Convex data and owner-checked mutations.
- The existing webhook contract and supplied reference images remain unchanged.
- Before merging, finish the validation and review gate above: inspect the diff, run the project checks, open the PR, resolve Greptile comments, and obtain a current 5/5 review.

## External facts still required for full integrations

The repository does not include the original workbook export, webhook endpoint/call samples, messaging/calendar provider contracts, or backup/archive credentials. Preserve compatibility and make the corresponding views explain their not-configured state until those inputs are supplied. Do not invent sample figures as production data or change the webhook as a substitute for discovery.

## Follow-on core workflow status

The isolated `codex/core-finance-workflows` branch adds record-backed v1 flows for account movements, savings holdings and flows, loan disbursements and repayments, recurring bill schedules and confirmed payments, partner ownership records with identity-linked capital statements, and account reconciliation counts. It also changes the Daily Report to show all seven trailing business dates, including dates with no recorded entries. See [`CASHBOOK_RULES.md`](CASHBOOK_RULES.md) for the account and profit effects and known limits.

These workflows are not deployed. They do not import spreadsheet rows, alter the existing webhook, enable profit distributions or payouts, create automatic bill accruals, support period locks, or replace the pending source-data, recovery, security, and external-provider decisions above. Financial settings now treat operational records as activity so saving settings cannot reset recorded balances or relabel amounts by changing currency. Treat this as an incremental workflow delivery, not completion of the full production rollout checklist.
