# MylesNet Finance Tracker — Web App Plan

## 1. Goal

Turn the approved MylesNet Finance Tracker redesign into a responsive, multi-user web application. The 18 approved boards remain the visual and content specification. This document replaces the Google Sheets implementation approach; it does not replace or modify the original brief, mockups, reference screenshots, design tokens, logo, or banner.

The web app must preserve the tracker’s business rules and make data quality visible. It must not treat values shown only in mockups as live data or silently repair known discrepancies.

## 2. What stays fixed

Use these files as read-only design references throughout implementation:

- `MylesNet_Finance_Tracker_Redesign/previews/` — all 18 approved board images.
- `MylesNet_Finance_Tracker_Redesign/boards/` — exact board content, layout, and labels; these are the primary screen specifications.
- `MylesNet_Finance_Tracker_Redesign/canvas-source/` — original canvas files and board ordering/positions.
- `MylesNet_Finance_Tracker_Redesign/design-tokens/` — colour, type, spacing, and Tailwind token source.
- `MylesNet_Finance_Tracker_Redesign/references/` — screenshots of the original sheet and templates.
- `MylesNet_Finance_Tracker_Redesign/assets/logo.png` and `banner.png` — approved brand images.

Do not edit, replace, rename, recompress, crop, recolour, or move these files. The logo and banner should be served directly from the existing `assets/` paths. Use the board previews and HTML as references; do not substitute them for the app’s responsive screens. Keep the Google Sheets `AGENT_PROMPT.md` as a historical brief.

## 3. Product shape and navigation

Build a responsive finance workspace with a shared top navigation, page title, global search, notification count, account/user menu, and persistent “Add entry” action. The desktop navigation follows the order and grouping in the approved brief. On small screens it becomes a compact menu with a prominent quick-add action.

Create these routes, using the 18 boards as the source of layout and content:

| Route / screen | Source board |
|---|---|
| Dashboard | `01-Dashboard` |
| Analytics | `02-Analytics` |
| Sales | `03-Sales` |
| Expenses | `04-Expenses` |
| Movements | `05-Movements` |
| Savings | `06-Savings` |
| Loans | `07-Loans` |
| Daily Report | `08-Daily-Report` |
| Monthly P&L | `09-Monthly-PnL` |
| Partners | `10-Partners` |
| Bills | `11-Bills` |
| Reconcile | `12-Reconcile` |
| Settings — General, Finance, Rules, Data, Access, Releases | `13`–`18-Settings-*` |

Implement each page as a responsive screen using the board’s hierarchy, copy, cards, table columns, and visual tokens. Use the actual charts, filters, responsive tables, dialogs, and forms that a browser supports. Do not reproduce spreadsheet-only mechanics such as merged cells, cell notes, protected ranges, hidden calculation tabs, or formula-driven navigation.

## 4. Recommended application architecture

The package contains design specifications but no established application codebase. Recommended default stack:

| Layer | Recommendation | Why / boundary |
|---|---|---|
| Web app | Latest stable Next.js, App Router, React, TypeScript | Server-rendered shell and routes with interactive client components for live finance views. Pin stable versions at project setup; do not use canary for production. Current Next.js docs use `proxy.ts` for request interception. |
| Backend and data | Convex | Use Convex functions as the only authoritative read/write boundary and Convex tables as the system of record. Use schema validators and indexes, and keep UI out of financial rules. |
| Identity and OAuth | Convex Auth | Use Convex Auth for Google OAuth and sessions, with app roles and business membership stored and enforced in Convex. |
| Hosting | Vercel for Next.js, connected to Convex deployments | Deploy the Next.js app and Convex functions together through the Vercel build pipeline. Use isolated preview deployments/data for previews and a protected production deploy key for production. |
| Styling | Existing design tokens with Tailwind CSS | Treat the current tokens as source of truth; build responsive primitives once and reuse them across the 18 routes. |
| Charts | A maintained React chart library selected during build | Use accessible labels and the approved palette; keep chart data calculations in shared backend/domain functions. |
| Files and jobs | Convex file storage and scheduled functions for simple app work | Use for receipt files and routine reminders/report schedules; authorize each upload/download in the backend and issue short-lived access URLs. Keep provider calls in server-side actions. Add a durable workflow/queue if retries or long-running integrations need stronger guarantees. |

### OAuth and authorization advice

Use **Google OAuth through Convex Auth** as the first sign-in option if MylesNet users already have Google accounts. Configure Google OAuth credentials and redirect URIs for each stable Convex deployment/environment; Convex Auth’s Google callback uses that deployment’s `.convex.site/api/auth/callback/google` URL. Keep `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Convex environment variables, never in `NEXT_PUBLIC_*` variables. Google requires exact callback URI registration, so do not assume arbitrary branch-specific Vercel preview backends can sign in automatically: use a stable staging OAuth deployment for acceptance, or explicitly provision preview callback URIs as part of preview setup. Convex Auth can create an identity at sign-in, so implement an invitation allowlist in Convex and prevent any uninvited identity from reading or writing business data or completing onboarding. OAuth proves identity but must not auto-grant finance access. Confirm whether Convex Auth supports the desired MFA and account recovery requirements before opening production to users. If it does not, document the limitation and keep privileged roles restricted until an acceptable control is available.

OAuth answers “who signed in”; it does not decide which finance records that user may see. Store the app’s business membership and role in Convex, keyed to the stable Convex Auth user ID. Every public Convex query, mutation, and action must verify the authenticated identity and authorize the requested operation and business/partner scope before reading or changing data. Never trust a role, partner ID, or business ID supplied only by the browser. Model partner access as a row-level constraint so a partner can only fetch their own statement. Next.js middleware can redirect unauthenticated users, but Convex function authorization remains mandatory. For authenticated state in Next.js Server Components or Server Actions, follow Convex Auth’s Next.js-specific setup and CSRF guidance; never perform side effects from GET requests.

**Known delivery risk:** Convex’s current documentation labels Convex Auth beta, and says Next.js server components, API routes, middleware, and SSR support are under active development. Keep Convex Auth as the selected direction, but make a focused compatibility prototype the first technical gate: verify Google sign-in, sign-out, session refresh, invite gating, protected routes, server-rendered reads if needed, Vercel preview and production environment separation, and the existing webhook. Do this on current stable Next.js, not canary. Next.js 16 calls its request interception file `proxy.ts`, while current Convex Auth examples may still use `middleware.ts`; explicitly verify the supported Next.js 16 pattern and adapt only as documented. If any required flow fails, keep the UI’s auth/data boundary small and follow the documented Convex Auth-compatible client/server pattern; report any blocker before building the full finance app. Recheck the current Convex Auth and Vercel deployment docs at implementation time.

### Backend design rules

- Define a strict Convex schema and argument/return validators. Build indexed, bounded queries and pagination for tables and search; avoid loading whole ledgers into the browser.
- Make dashboard/analytics queries period-bounded and index-backed. Add daily/monthly aggregate documents only where measurements show they are needed, and update them transactionally with ledger changes. If history or analysis grows beyond Convex’s fit for operational queries, stream/export analytics to a warehouse rather than turning Convex into an unbounded reporting engine.
- Put ledger changes in authorized mutations. Use server-side actions only for external APIs, webhook forwarding, report delivery, imports, and other side effects. Validate external response data before recording it.
- Centralize money, period, partner-allocation, and reconciliation rules in shared backend functions. In UGX, store whole-shilling amounts as safe integers; if fractional currencies are added later, define a currency-specific minor-unit policy. Never use floating-point arithmetic for ledger calculations.
- Record audit events for actor, action, affected record, timestamp, and before/after values. Corrections should be traceable and attributable; do not silently overwrite ledger history.
- Use idempotency keys and unique source/import identifiers for entry submissions, webhook calls, and imports so retries cannot create duplicate transactions.
- Keep the UI presentation separate from domain calculations so the same definitions power cards, tables, charts, reports, and exports.
- Keep all secrets out of client bundles and logs. Scope deploy keys and service credentials to the minimum required permissions.

### Existing webhook and integrations

Treat the existing webhook as a compatibility contract. Keep its current URL, payload, authentication, and response behavior during migration. The Next.js app may provide a stable route adapter if traffic must move, but the adapter must preserve the existing interface and call authorized server-side logic. Validate its signature/shared secret, timestamp or replay window, and idempotency key; rate-limit it; log request IDs without logging secrets or sensitive payloads. Capture current behavior and use staging/shadow comparisons before any cutover, with a tested rollback path. Do not assume the webhook is the same thing as OAuth: keep service-to-service authentication separate from interactive user login.

Keep the design tokens in `design-tokens/` as the canonical visual source. Build shared components against these tokens before page assembly.

## 5. Data model and migration

Create Convex tables corresponding to the current workbook concepts. At minimum, plan for:

- `users`, `roles`, `role_permissions`, and partner-to-user access mapping.
- `business_settings`, `accounts`, `income_types`, `expense_categories`, `partners`, and effective-dated ownership shares.
- `sales_entries`, `expense_entries`, `money_movements`, `savings_holdings`, `loans`, and `recurring_bills`.
- `split_actuals`, `weak_day_tags`, `voucher_batches`, `receipts`, `suppliers`, and `approval_requests` for the new workflows.
- `daily_reports`, `report_recipients`, `report_deliveries`, and integration configuration.
- `reconciliation_sessions`, `reconciliation_items`, `period_locks`, `issues`, and append-only `audit_events`.

Define identifiers, timestamps, status enums, source/import metadata, and void behavior before loading data. Store UGX amounts as whole-shilling safe integers, formatting currency at the presentation layer; reject unsafe or fractional values unless the supported currency requires minor units. Preserve original entry values and record corrections as attributable changes. Store a source reference and import batch ID for imported rows to support deduplication and reconciliation. Define indexes around tenant/business, date, status, and source IDs before building screens.

Before migration, map each existing sheet column to a target field, document missing/ambiguous fields, reconcile row counts and totals, and retain an export of the source data. Load a staging copy first. No live data should be changed by an unreviewed import.

### Existing webhook compatibility (must preserve)

Treat the current webhook as a live dependency. Do not disable, replace, rename, or change its URL, request format, authentication, or response behavior during the initial web app rollout. First identify its deployed endpoint, callers, payloads, authentication/secret handling, side effects, and failure/retry behavior. Add contract-level checks and capture representative requests before routing any traffic to the new app. If the web app needs to take over its work, put a compatibility adapter in front of the new server-side API so existing callers continue to receive the same behavior. Run old and new paths against staging or in shadow mode, compare results, then switch traffic only after parity is confirmed and a rollback path is ready. Keep the old endpoint available through the agreed rollback period. Do not expose webhook secrets in the browser.

## 6. Business rules and known data issues

Centralize and document calculations, with shared server-side functions and clear source/period metadata:

- Period filters and comparisons, sales, expenses, net, margins, averages, projections, targets, partner profit allocations, balances, bill forecasts, cash runway, equipment payback, loan payments, debt capacity, and savings scenarios.
- Estimated mobile-money/cash splits stay explicitly marked `Estimated` until actual split corrections exist. Derived views inherit this provenance label.
- Charts and reports identify whether they use entry totals, dashboard totals, or another defined basis. Never mix bases without a visible label.
- Missing days are distinguished from zero-sales days. Weak-day thresholds and anomaly rules come from settings.
- Every issue has a stable type, severity, source record/page, open/resolved state, and actionable destination. Notifications count open issues using the same rule everywhere.
- Reconciliation, period locking, partner payouts, approvals, and data corrections must be auditable and permission-checked.

Carry the source brief’s known issues forward as explicit migration/reconciliation fixtures, not as hard-coded app facts: the 500 sales mismatch; partner net mismatch; unexplained funding; estimated split on most imported sales; missing dates 23–26 July; 21,500 vs 22,000 daily mismatch; unbooked bandwidth bill; and inconsistent comparison basis. Verify these against the actual source data on import. Label mock-only values and estimates as samples; do not seed them as real records.

## 7. Screen and feature delivery order

### Phase 0 — Discovery and data contract

1. Confirm whether an existing app, Convex project, Vercel project, Google OAuth project, and source workbook access are available; the selected default is Next.js + Convex Auth + Convex + Vercel.
2. Inventory sheet columns, formulas, named ranges, Apps Script triggers, entry form, integrations, user roles, and current data volume.
3. Map every board component to an app feature and classify it as core, later release, sample, estimate, or external integration.
4. Approve the data dictionary, calculation definitions, access matrix, import plan, and backup/restore strategy.

### Phase 1 — Foundation

1. Set up the app shell, responsive navigation, design tokens, typography, shared card/table/form/status components, and the existing logo/banner usage.
2. Create separate Convex development, staging, and production deployments and matching Vercel environments, each connected to the right Google OAuth credentials and data. Configure Vercel’s build to deploy Convex functions and the Next.js app together; keep production deploy credentials scoped to production. Use isolated Convex preview deployments for preview builds, with a documented OAuth callback strategy.
3. Prototype Convex Auth Google OAuth on the chosen Next.js/Vercel setup. Verify invitation-only onboarding, session lifecycle, protected reads/writes, route behavior, and provider callback configuration before continuing.
4. Implement business membership/roles, server-side authorization, audit events, business settings, accounts, and period selection.
5. Build data import preview and validation in staging, including deduplication, source-to-target reconciliation, and a webhook compatibility/shadow test harness.

### Phase 2 — Core finance workflows

1. Build Sales and Expenses with create/edit/void flows, validation, receipt attachment, imports, category filters, and audit history.
2. Build Movements, account balances, Centipid withdrawal and fee handling, and movement classification.
3. Build Recurring Bills with due dates and mark-paid-to-expense flow; add Savings and Loans records and calculators.
4. Add partner ownership, capital ledger, payout eligibility, approvals, and partner-scoped statement views.

### Phase 3 — Dashboard, reporting, and data quality

1. Implement shared calculation services and period filters.
2. Build Dashboard, Analytics, Daily Report, Monthly P&L, and charts from persisted data.
3. Implement issue detection, global search, notifications, reconciliation workflow, close/lock behavior, and audit trail.
4. Add mobile-responsive dashboard, sales entry, and daily report experiences based on the provided mobile concepts.

### Phase 4 — Settings, exports, and integrations

1. Complete the six Settings sections, access controls, targets, rules, import history, and backup history.
2. Add PDF/CSV export and shareable statements with access controls and expiry where appropriate.
3. Integrate WhatsApp/report delivery, calendar sync, scheduled backups, and release management only after provider credentials, consent, and delivery requirements are confirmed.
4. Provide sandbox/preview workflows for changes; upgrades must not overwrite production data automatically.
5. Add production telemetry and operations: structured logs, error monitoring, alerts for failed imports/reports/webhooks, usage/cost limits, a recovery runbook, and a named operational owner.

The release order can be adjusted after the data and integration inventory, but the first usable release should prioritize authenticated access, reliable entry capture, balances, and reconciliation before advanced predictions or automation.

## 8. Web behavior replacing spreadsheet mechanics

| Spreadsheet plan | Web app equivalent |
|---|---|
| Formulas and hidden `Calc` sheet | Shared domain calculation functions / database queries, with documented definitions |
| Editable highlighted cells and protected ranges | Validated forms, role permissions, server-side authorization |
| Apps Script entry actions | Authenticated API mutations with audit events and idempotency |
| `Issues` sheet | Issue records/rules service and inbox UI |
| `Audit_Log` sheet | Append-only audit event store and searchable audit screen |
| `Nav`, `Search`, `Lists` sheets | App routing, indexed search endpoint, database-backed settings/options |
| Print ranges and PDF export links | Responsive print styles plus server-generated PDF/CSV exports |
| Workbook backup/restore | Database/object storage backups with tested restore procedure and audit trail |
| Mobile sheet | Responsive pages and mobile-specific quick actions |
| Sheet protections and role lookup | Server-enforced role/record-level access control |
| Spreadsheet period locks | Server-enforced closed-period checks on all writes |

## 9. Responsive design and asset handling

- Match the desktop boards at their reference content width and preserve the existing page background, card, typography, line, status, and chart palette tokens.
- At tablet widths, reflow multi-column card grids while keeping filters and page actions usable.
- At phone widths, collapse navigation, stack cards, convert wide tables to accessible row cards or controlled horizontal scrolling, and keep primary add actions reachable.
- Reuse the existing logo image in the shared application header. Use the banner only on the Dashboard, as specified by the board.
- Keep existing asset files byte-for-byte unchanged. If bundling requires copies, preserve the source and verify copied files against it; do not edit or resave originals.
- Provide text labels and accessible names alongside status colours, charts, icons, and action controls.

## 10. Completion criteria

The app is ready for staged acceptance when:

1. All 18 routes map to the approved boards, and responsive views work at desktop, tablet, and phone widths.
2. Original references, previews, tokens, logo, and banner remain unmodified and are used consistently.
3. Imported source row counts and financial totals reconcile, or every variance is explained and visible.
4. Calculations have documented definitions and are consistent across cards, tables, charts, exports, and partner views.
5. Estimated values, samples, missing data, and unresolved source discrepancies are visibly distinguished.
6. Role-based and partner-level access is enforced by the server for reads and writes.
7. Entry workflows, approvals, period locks, exports, notifications, and audit events behave end to end.
8. Backup restoration is demonstrated in a non-production environment before live migration.
9. External messaging/calendar integrations are verified with test recipients and documented operational ownership.
10. OAuth callbacks and sign-in work in all environments; access revocation takes effect, partner isolation is verified, and privileged actions require the intended stronger authentication.
11. Existing webhook callers pass compatibility checks and the rollback route remains available through the agreed cutover period.
12. Production has reviewed deployment secrets, rate limits, monitoring/alerts, retention policy, and a tested recovery process.

## 11. First implementation handoff

Before coding, produce these concrete outputs: a source-data mapping and import report; a transaction/accounting rules catalogue; a role-permission matrix; a route/component inventory tied to the 18 boards; a webhook contract record; a staged release checklist; and a list of provider decisions needed for WhatsApp, calendar, and email. Then implement Phase 1 and the first core workflow against staging data.

## 12. Open decisions to settle during discovery

- Whether there is an existing codebase, Convex project, Vercel project, or Google OAuth project to extend.
- Which Google accounts/domains are allowed, who can invite users, and what happens when an invite is revoked or an account is disabled.
- Confirm MFA/account recovery requirements and whether Convex Auth currently supports them adequately for privileged finance roles.
- Whether the original Google Sheet remains a migration source only or must continue syncing with the app.
- Which existing webhook(s) must remain compatible, who calls them, and the required parity/rollback window.
- Source-of-truth policy and process for future imports/duplicate entries; recommended initial policy is one-way import from Sheets, then Convex as source of truth, with no silent bidirectional sync.
- WhatsApp provider, recipient consent, and delivery/report retention requirements.
- Backup retention, data residency, encrypted off-platform archival, and partner portal access model.
- Whether release controls in the mockups represent real end-user functionality or are informational product concepts.

## 13. Production items added to the original brief

The spreadsheet plan did not specify these web-app requirements; they are necessary for a reliable finance application:

- Explicit business boundaries and authorization on every backend operation.
- Invitation, deactivation, access revocation, MFA for privileged roles, and account recovery policy.
- Idempotent entry/import/webhook handling, duplicate detection, append-only audit history, and controlled corrections.
- Separate preview/staging/production environments, secret rotation, release rollback, and schema/data migration procedures.
- Off-platform encrypted backups and a restore runbook. Convex dashboard backups are useful, but documented retention is limited (manual snapshots 7 days; automatic daily 7 days and weekly 14 days on Pro) and excludes code/configuration and environment variables; they should not be the only recovery plan.
- Monitoring for failed scheduled reports, external delivery, imports, webhook validation, unusual access, and usage/cost thresholds.
- Data retention/deletion, privacy notice and consent for messaging, attachment access controls, and secure export links.
- Accessible keyboard flows, screen-reader labels, chart summaries, contrast checks, and loading/empty/error states across routes.
- A clear system-of-record and reconciliation policy for the original Sheet, webhook, imported data, and new Convex records.

## 14. Current official references

Recheck these docs when implementation starts because platform releases and integrations evolve:

- [Next.js App Router](https://nextjs.org/docs/app) and [authentication guidance](https://nextjs.org/docs/app/guides/authentication).
- [Convex Next.js App Router](https://docs.convex.dev/client/nextjs/app-router/) and [Convex authentication overview](https://docs.convex.dev/auth/overview).
- [Convex Auth](https://docs.convex.dev/auth/convex-auth), its [Google OAuth setup](https://labs.convex.dev/auth/config/oauth/google), and [Next.js server-side auth guidance](https://labs.convex.dev/auth/authz/nextjs).
- [Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel).
- [Convex scheduling](https://docs.convex.dev/scheduling/overview) and [backup and restore](https://docs.convex.dev/database/backup-restore).

## 15. Remaining gaps to close before production rollout

These are the highest-impact decisions that the current plan still leaves open:

1. **Canonical ledger and accounting semantics — model chosen.** Use an auditable cashbook, not a full double-entry ledger. Still define how each event changes account balances and profit: sales, expenses, transfers, cash/mobile-money movement, withdrawal fees, partner capital, payouts, loans, refunds, equipment purchases, and bill accruals. Transfers must not accidentally count as income or expense. Define opening balances and how corrections/reversals work before finalizing the schema and reconciliation formulas.
2. **Calendar and period rules.** Declare the business timezone as `Africa/Kampala` (the spreadsheet brief’s timezone), currency `UGX`, week start, inclusive/exclusive date-range rules, and how timestamps are converted into a business day. Store timestamps consistently and render/report using the business timezone.
3. **Webhook facts and cutover owner.** The plan protects compatibility, but the actual endpoint, callers, request examples, authentication method, expected latency, retry behavior, and business owner are not present in this package. Capture these before implementation. Decide who can approve cutover and who can execute rollback.
4. **Convex Auth production readiness.** The required compatibility prototype is a gate, but no fallback decision or acceptance owner is named. Decide required account recovery, MFA/step-up authentication for payouts and period close, session expiry/revocation, invitation expiry, and what to do if Convex Auth does not meet the requirements.
5. **Release and data migration authority.** Name who approves import totals, which source wins when the Sheet and app disagree, the exact cutover date/process, how the old entry form is handled, and how long the Sheet remains read-only/available. Define rollback for data written after cutover.
6. **Business operations and approvals.** Define role-by-role permissions, approval thresholds, the two-person payout rule, period lock/unlock authority, and how an emergency correction is reviewed. The board names roles and controls but the exact matrix is not specified.
7. **External service contracts.** Choose providers and ownership for email, WhatsApp, calendar, PDF generation, receipt scanning/storage, and delivery receipts. Define what happens on provider outage, duplicate delivery, revoked credentials, or changed API behavior. Keep these integrations optional until the core ledger works.
8. **Recovery targets and support.** Set acceptable data-loss window (RPO), restore-time target (RTO), backup archive location/retention, restore approvers, incident contact, and support process. Convex backups alone do not cover source code/configuration or long retention.
9. **Acceptance and security review.** Define an acceptance matrix for calculations, imports, roles/partner isolation, webhook contract, mobile usability, accessibility, exports, and restore. Include a security review of file uploads, export links, OAuth invite abuse, webhook replay, and sensitive logs.
10. **Scope and release boundaries.** The boards contain a large feature set (including partner portal, WhatsApp commands, calendar sync, backup restore, release/rollback UI, and what-if tools). Mark each as MVP, later, or illustrative-only so the first release remains achievable without omitting a critical finance control.

Recommended order: define items 1–6 and capture the webhook facts before production migration; provider decisions and optional automation can follow after the first authenticated ledger workflows are stable.

## 16. Decisions confirmed in this questionnaire

- **Accounting model:** Auditable cashbook. Track transaction effects on accounts and profit with an audit trail, without requiring a full general ledger.

## 17. Implementation status — initial foundation

- The app is being built in `/home/myles/Projects/MylesNet Finance Tracker`, with the supplied GitHub repository configured as its `origin` remote.
- The complete reference package is copied into `design-reference/`; the approved logo, banner, and CSS tokens are also copied into their app locations. These copies were checked byte-for-byte against the source package.
- The selected stack is Next.js App Router, Convex, Convex Auth with Google OAuth, and Vercel. The production Convex URLs from the dashboard screenshot are recorded in `DEPLOYMENTS.md`; local development is reserved for a separate development deployment.
- The first implementation contains protected routes, business membership checks, first-owner setup guarded by a 32-character one-time code, UGX sales/expense entry mutations, per-account balances, period totals, idempotency keys, and append-only audit events for entry creation and voiding.
- Dashboard, Sales, and Expenses are connected to Convex. The other board routes currently display scoped implementation placeholders mapped to their original board specifications.
- Partner accounts currently receive no business-wide transaction details or totals. Partner-specific statement access must be implemented before enabling those routes.
- `Africa/Kampala` remains a provisional timezone default; week start, opening-balance import, full transfer/refund/capital/payout/loan semantics, and period closing still need agreement.
- No production deploy, schema push, or webhook cutover has been performed. The webhook source and contract were not included; its existing service has not been changed.
