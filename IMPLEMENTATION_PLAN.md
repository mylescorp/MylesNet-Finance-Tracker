# Finance Tracker Improvement and Feature Implementation Plan

## Purpose

Bring the finance workspace from its current broad but uneven feature set to a clear, dependable operating tool. The work covers every issue and feature raised in the end-to-end review: accurate feature status, trustworthy balances, cash closeout, expense evidence and suppliers, recurring bills and alerts, reconciliation matching, reporting and month-end close, sales operations, partner reporting, and safe integration readiness.

This is an implementation plan, not a claim that a feature is already complete. Before each phase, inspect the current branch and code because the project is actively changing and some board copy may be stale.

## Implementation status

Status below tracks work in this branch. A phase marked partial is not accepted as complete until its listed completion criteria are met. Backend and deployment dependent work is gated on a confirmed development or staging Convex target; the production deployment is explicitly out of bounds for local validation.

| Phase | Status | Work completed in this branch | Remaining work / exit gate |
| --- | --- | --- | --- |
| 0. Safe baseline | Partial | Read repository rules, generated Convex guidance, Next 16 guides, existing app docs, permissions and integration constraints. Isolated changes in a managed worktree and documented known existing capabilities. | Verify every route against a running non-production workspace and reconcile the inventory with current backend behavior. |
| 1. Truthful status and metrics | Partial | Corrected board descriptions and unsupported metrics; clarified supplier and closeout limitations; made print/share labels match behavior; separated today's sales from the chosen historical range; added category-budget actuals with explicit full-month comparison and incomplete-range states. | Review all route empty/loading/restricted/error states in the running app and ensure every displayed period total has a completeness basis. |
| 2. First-use and balances | Partial | Added an authorized first-entry/opening-balance reminder, a role-gated workspace setup checklist, and corrected README balance guidance. CSV and pasted-expense imports now validate the mapped rows before commit, preview date coverage and normalized rows, estimate cash/mobile-money/unallocated ledger changes, flag identical rows for review without silently dropping them, and report imported/skipped counts after completion. | Review setup checklist states and safe-integer boundaries; verify opening-balance lock/audit behavior in staging and confirm preview figures against the saved import batch. |
| 3. Cash closeout and reconciliation | Partial | Added optional cash denomination counts with server-side safe-integer, uniqueness, account-scope and balance-sum validation; included counts in idempotency matching, authorized reconciliation history and audit details; added a cash count form and history display. This branch adds reviewer sign-off for matched counts and explained differences, saved reviewer notes, and reasoned reopening with audit snapshots. | Reviewer assignment, persisted multi-account period states, source-linked issue disposition and closing certificate remain. The current closeout checklist is a read-only summary of today’s saved counts and approvals, not a posting lock. Validate role access and count/reversal history in a configured staging workspace. |
| 4. Expenses, suppliers, budgets, recurring costs | Partial | Added business-scoped monthly category budgets, warning thresholds, and posted-expense actuals; suppliers can be created, searched, edited, archived and linked to expenses with reference IDs; authenticated receipt upload and registration run in one server request with idempotent retries and failed-upload cleanup, alongside restricted retrieval/removal, correction retention, and workspace-reset cleanup. | Recurring expense templates/due alerts, item-level price data, and staging verification remain. Actuals are not prorated across partial or multi-month periods. |
| 5. Bills and payment capture | Partial | Existing bill schedules, recurrence calculations, overdue labels, confirmed idempotent payment posting, account effects, linked expense records, archive/restore, audit, and reversal flows are present. This branch adds a 90-day occurrence forecast, supplier snapshot defaults, configurable in-app lead reminders shown on Bills and the dashboard, and audited pause/resume. Forecast queries now receive the current business date so reactive results advance when the date changes; a boundary regression covers the 90-day horizon. | Verify forecast cadence edge cases against a staging workspace. External reminder delivery remains unconfigured; schedule lists show an explicit incomplete state at the 100-schedule cap. |
| 6. Statement matching | Not started | Existing CSV import batches, preview, duplicate checks, resumability, history, and reversal remain in place. | Add statement-specific parsing, deterministic matching, ambiguity review, row/source traceability, resumable matching decisions, and parity tests using staging samples. |
| 7. Report delivery | Partial | Daily/weekly report previews and recipient/provider-not-configured states are present; print and copy-link actions are accurately labeled. | Add verified consent-based recipients, timezone-aware schedule, preview/test send, provider status/retries, and authenticated/expiring report links after provider configuration. |
| 8. Month-end close and statements | Partial | Recorded cashbook P&L and selected-period print/export views are available with explicit cashbook basis. Added a full-calendar-month close checklist, day-by-day source coverage attestations, a prepared cashbook and budget snapshot, separate reviewer approval, source-change invalidation, and reasoned reopen history. | Add a reproducible printable/exportable statement artifact with account movement context, exclusions, preparer/reviewer and timestamps; verify close/statement behavior against a staging workspace. |
| 9. Sales operations and data quality | Partial | Import history, weak-day flags, issue assignment/review history, safe corrections, and responsive entry forms exist. | Add a weak-day diary, voucher batch/stock lifecycle, split-correction provenance, and additional small-screen interaction review. |
| 10. Partner statements and distribution portal | Partial | Partner-scoped statements, ownership history, separate approval/payment records, and cross-role restrictions are present. This branch adds explicit period and ownership-effective-date context plus a print/save-PDF action on the linked partner statement, with privacy regression coverage. | Verify archived-partner and membership-role transition behavior against staging data; approval/payment history and ownership edge cases still need broader verification. |
| 11. Integration readiness | Guarded / not started | Documented that parallel Centipid and Google Form adapters exist and that existing external callers must remain unchanged. | Capture deployed webhook contract and complete staging parity evidence before any production caller change. |
| 12. Release | In progress | Added user-facing Changesets; README and this roadmap now distinguish implemented capabilities from known gaps. Lint, typecheck, tests and production build pass on this branch. | Finish agreed implementation scope, run checks after final edits, create PR, obtain Greptile 5/5 with no unresolved comment issues, and merge only after that exact gate. |

### Confirmed branch validation

- `npm run lint` — passed after removing unused code and documenting intentional async settings hydration effects.
- `npm run typecheck` — passed.
- `npm test` — 13 files and 44 tests passed; includes supplier/receipt isolation, partner statement privacy, reconciliation sign-off/reopen, bill reminder lifecycle checks, large chunked import impact, budget currency locking, forecast day-boundary coverage, and month-end close/source coverage controls.
- `npm run build` — passed after month-end close UI, Convex schema, query, and mutation changes (includes tests and typecheck).
- `git diff --check` — passed.
- `npx convex dev --once --typecheck disable` — passed against the isolated local Convex deployment after schema/function changes; generated types refreshed. No production or external webhook target was used. Authenticated UI walkthrough, real-data validation, and integration parity remain outstanding.

## Guardrails and required practices

- Treat `design-reference/` as read-only. Keep `public/brand/` and `app/tokens.css` byte-for-byte aligned with the supplied references.
- Keep money calculations and authorization in Convex. Every public business-data query and mutation must derive the caller identity server-side and check active workspace membership and the required permission.
- Keep UGX as safe whole-shilling integers. Preserve idempotency on all transaction ingress and auditable corrections/reversals.
- Before any Convex edits, read `convex/_generated/ai/guidelines.md`; regenerate Convex types after schema or function changes.
- Before writing Next.js code, read the relevant Next 16 guide under `node_modules/next/dist/docs/` from this repository.
- Add a Changeset for every user-visible change, following `.changeset/README.md`.
- Use development or staging data for local and integration validation. Never point local work at production.
- Do not modify or redirect the existing external webhook until its deployed contract is captured and staging parity is demonstrated. Keep current Centipid and Google Form integrations on their existing paths until their explicit cutover gates are met.
- Inspect and preserve pre-existing user changes. At plan creation, `convex/workspace.ts` has a pre-existing uncommitted change; do not overwrite or attribute it to this work.
- Avoid presenting estimates as actuals, incomplete periods as closed, or missing data as zero. Label provenance and completeness anywhere totals are shown.

## Capabilities already present in the current codebase

Phase 0 must confirm these in the running UI before adding replacements. The current code already contains substantial workflows that need completion and clearer presentation, not a second implementation:

- Cash and mobile-money opening balances before ledger activity, followed by auditable balance adjustments.
- Cashbook sales/expense entry, imported batches, idempotent Centipid and Google Form adapters, corrections, reversals, and audit events.
- Account movements, savings holdings and contribution/withdrawal flows, loans and repayments, recurring bill schedules and confirmed payments.
- Partner ownership history, scoped partner statements, second-person distribution approvals, payout records, and reversals.
- Reconciliation counts, superseding corrections, variance explanations, and reopening with reasons.
- Analytics insights, data-health flags, issue assignments/review history, role permissions, and CSV export.

The first implementation work removed stale product copy, improved first-use guidance, and began addressing the remaining gaps listed in the phases below. Do not rebuild the above unless Phase 0 uncovers a specific behavior defect.

## Workstreams and completion order

### Phase 0 — Establish a safe baseline and verify the feature inventory

**Tasks**

1. Review the current branch, working tree, current app route map, Convex schema/functions, permissions, and existing Changesets.
2. Preserve and understand the existing uncommitted `convex/workspace.ts` diff before touching that file.
3. Walk each board in the running development environment and classify each section as:
   - working and backed by persisted data;
   - partially working or dependent on configuration;
   - a visual placeholder / unavailable;
   - intentionally restricted by role.
4. Compare those observations with `README.md`, `WEBHOOK_COMPATIBILITY.md`, board specs, settings labels, navigation permissions, and actual public Convex functions.
5. Record the confirmed inventory and any changed assumptions in a short implementation checklist before feature work starts.

**Completion criteria**

- Every current navigation route and advertised workflow has an explicit status and owner.
- Stale board text and metrics are identified without assuming that descriptions alone prove a backend feature is absent.
- Existing local changes and integration constraints are recorded and preserved.

### Phase 1 — Make status, metrics, and report actions truthful

**Tasks**

1. Replace stale descriptions such as “not available yet” where the operations backend and UI already support the workflow.
2. For incomplete features, show a clear “not configured” or “planned” state with a useful next step. Do not show fake values or unexplained dashes.
3. Hide metrics whose calculation or data source is not implemented. For partial values, show a label and a completeness explanation.
4. Make print, PDF, and share actions distinct:
   - print opens the print dialog;
   - PDF export produces a usable saved/downloaded document or is labeled as “Print / Save PDF”;
   - report sharing either produces an authorized, scoped share artifact or is explicitly labeled as copying a page link.
5. Ensure copied links do not imply public access or a frozen report snapshot. Preserve normal server authorization when a recipient opens a workspace page.
6. Review empty, loading, restricted, pending, and incomplete states across Sales, Expenses, Analytics, Reports, Operations, and Settings.

**Completion criteria**

- No screen claims an implemented workflow is unavailable, or an unavailable workflow is presented as ready.
- No unsupported metric looks like a real zero or a failed data load.
- Button labels accurately describe their behavior.
- Every report number indicates its period and whether the underlying data is complete where applicable.

### Phase 2 — First-use onboarding and trustworthy balances

**Tasks**

1. Add an onboarding checklist for workspace setup: business details, currency/timezone, accounts, opening balances, role setup, import history, and first reconciliation.
2. Explain that balances begin at zero and remain incomplete until opening balances or source history are entered.
3. Provide a guided opening-balance entry for cash and mobile money with date, source/explanation, actor, and audit record.
4. Keep opening balances locked after ledger activity; later differences must use existing auditable balance adjustments.
5. Make import preview show source, date coverage, account mapping, duplicates, unallocated values, and expected balance effects before commit.
6. Improve post-import summary with imported/skipped counts, date range, account impact, warnings, and a route to import history.
7. Add a first closeout action to compare counted cash/mobile money with book balances and explain any variance.
8. Ensure account balance and daily total calculations remain safe integers and reject overflow.

**Completion criteria**

- A new workspace cannot mistake zero starting balances for a verified real-world balance.
- Opening balance changes and later adjustments are distinguishable, attributable, and auditable.
- Import preview and completion provide enough information to detect incorrect mapping before relying on balances.
- The first reconciliation can be completed without editing ledger data directly.

### Phase 3 — Cashier closeout and reconciliation controls

**Tasks**

1. Build a closeout flow for each supported account: counted balance, optional denomination count for cash, book balance, variance, explanation, and submission time.
2. Support assignment and review/sign-off by an authorized supervisor; define which roles can count, explain, approve, reopen, and export.
3. Add close checklist items for cash count, mobile-money confirmation, unresolved issues, and required approvals.
4. Preserve immutable reconciliation history. Corrections should supersede/reopen with a reason rather than silently overwrite old counts.
5. Add period state (open, awaiting review, closed, reopened) where it is needed for reporting controls.
6. Show unresolved differences with source links and make completion rules explicit.
7. Add printable closing certificate containing period, account counts, variances/explanations, open issues, preparer, reviewer, and timestamps.

**Completion criteria**

- Reconciliation actions are permission-checked server-side and audit logged.
- A closed period has a clear review trail and cannot be silently altered.
- Users can identify the source of a difference and its disposition.
- Certificate totals reconcile to the persisted source records.

### Phase 4 — Expense evidence, suppliers, budgets, and recurring costs

**Tasks**

1. **Implemented in this branch:** Add supplier records with business-scoped identity, optional contact details, active/archive state, normalized names, duplicate prevention and audit history.
2. **Implemented in this branch:** Associate expenses with an optional supplier and supplier reference while retaining existing cashbook categories and account; supplier identity/reference is snapshotted on the entry and preserved on correction.
3. **Implemented in this branch:** Add receipt upload through an authenticated endpoint that stores file bytes and registers their expense link in one server request, with safe file size/type checks, idempotent retries, private access, and workspace-reset cleanup; browser disconnects do not require a follow-up registration request.
4. **Implemented in this branch:** Provide a receipt preview/download path that first checks workspace Expenses access and returns file bytes instead of exposing a public storage URL.
5. **Implemented in this branch:** Add monthly category budget values and warning thresholds. The comparison uses posted expense rows, the selected category and optional account, and explicitly compares selected-period actuals with the full monthly limit without proration. Equipment spend follows its saved expense category; multi-month ranges are marked incomplete for budget comparison.
6. Add recurring expense templates with cadence, next due date, supplier/category/account defaults, and pause/archive controls.
7. Detect likely recurring patterns as suggestions only; do not create expenses or bills without an explicit user action.
8. Add budget and due-date alerts in-app. Keep notifications quiet when nothing actionable is happening.
9. **Partially implemented:** Show supplier-linked posted expense history with a bounded completeness indicator. True item-level price history still requires expense line items and quantities; do not label transaction spend as unit pricing.

**Completion criteria**

- Receipt and supplier data cannot cross workspace boundaries.
- A recurring template never posts a financial entry without confirmation.
- Budget calculations clearly state the period, category scope, and actual-vs-planned basis.
- Expense correction/void behavior preserves the source receipt and audit history or explicitly records what was detached.

**Branch scope note:** Category budgets, supplier directory/linkage, receipt files and supplier-linked expense spend history are implemented. Recurring expense templates remain open; bill due reminders are now in-app and bill schedules support supplier defaults. True per-item price comparison needs an expense line-item model.

### Phase 5 — Bills, reminders, and payment capture

**Tasks**

1. Complete bill schedule creation/edit/archive and upcoming-due views, including the next 90 days and overdue state.
2. Support recurrence, amount variability, supplier, due date, account preference, and reminder lead time.
3. Add in-app reminders first. Add calendar/provider delivery only after choosing and configuring a supported provider.
4. Track reminder attempts and delivery state if external delivery is enabled; never imply delivery when it failed or was not configured.
5. Require a user to confirm a bill payment before posting an expense.
6. Make payment posting idempotent and link the bill, payment, expense entry, and audit event.
7. Support payment reversal with a reason while preserving the original payment/expense linkage.
8. Show forecast obligations separately from posted actual expenses to prevent double-counting.

**Completion criteria**

- Upcoming obligations do not change cash balances or profit until payment is confirmed.
- Confirmed payments update balances and expense totals exactly once.
- Reversals are auditable and restore consistent bill/payment/account state.
- Reminder status is truthful and opt-in where external communication is involved.

### Phase 6 — Statement import and reconciliation matching

**Tasks**

1. Confirm the Centipid/export formats from real staging samples; do not assume undocumented column names.
2. Implement source-specific parsers with explicit mapping, date/amount validation, duplicate detection, and a preview.
3. Match imported rows against saved transactions using deterministic references first, then transparent secondary matching rules.
4. Present matched, unmatched, ambiguous, and duplicate rows separately; let authorized users resolve each with a recorded decision.
5. Import confirmed unmatched transactions through the existing idempotent ledger/import path.
6. Preserve original source file hash, batch, row identifiers, mapping, and audit events. Do not store unnecessary sensitive data.
7. Provide chunked progress, resumability, cancellation, and reversal for large imports, consistent with the existing import batch behavior.
8. Add reconciliation summaries for imported total, matched total, unmatched total, and residual variance.

**Completion criteria**

- No row is posted before the user reviews the preview and mapping.
- Retries cannot double-post entries.
- A user can trace each imported entry to its source row and each match to its decision.
- Cancel/reversal behavior is tested on staging data and cannot reverse unrelated ledger entries.

### Phase 7 — Daily/weekly report delivery

**Tasks**

1. Finalize report content and data semantics: sales, expenses, balances, closeout status, unresolved issues, estimates, and completeness.
2. Add per-workspace recipient management with explicit consent, verification, role restrictions, and unsubscribe/disable controls.
3. Add timezone-aware daily and weekly schedules using workspace timezone and week-start preference.
4. Build a preview and test-send flow before activating a schedule.
5. Add provider configuration only after selecting the provider and storing credentials in deployment secrets, never client code or repository files.
6. Record delivery attempts, provider response identifiers, failures, and retry state without exposing integration secrets.
7. Keep WhatsApp reply handling outside initial scope unless a verified provider and security contract are approved.
8. If a report includes a link, ensure it is authenticated/scoped or uses a purpose-built expiring token with minimal data and revocation support.

**Completion criteria**

- Reports are generated using the intended business date and workspace timezone.
- Recipients can be verified, consent can be withdrawn, and schedule settings can be audited.
- UI shows generated/sent/failed states accurately.
- A delivery failure does not silently mark a report as sent.

### Phase 8 — Month-end close and statements

**Tasks**

1. Define close period boundaries using workspace timezone, fiscal year start, and date convention.
2. Add a month-end checklist for unresolved reconciliation differences, unreviewed issues, pending imports, missing source days, and incomplete balances.
3. Calculate the existing cashbook P&L from saved posted entries and distinguish it from accounting profit; do not imply tax/accounting treatment not represented in the data model.
4. Add reviewer approval and period close/reopen permissions with required reasons and audit history.
5. Produce a printable/exportable statement with period, basis, totals, category breakdowns, account movement context, exclusions, completeness, preparer, and approver.
6. Add budget-vs-actual after category budget semantics are finalized.
7. Make any downloadable file workspace-scoped, generated from authorized data, and avoid public URL exposure by default.
8. Support historical exports with bounded queries and clear row/period limits.

**Completion criteria**

- A closed statement can be reproduced from saved data and explains its accounting basis and exclusions.
- Reopening a close is permission-checked and auditable.
- Users can distinguish cashbook net from formal accounting profit.
- Budget comparison uses the same period and category rules on both sides.

### Phase 9 — Sales operations and data quality

**Tasks**

1. Surface import history and data checks on Sales, including source, date coverage, mappings, duplicates, and rollback status.
2. Add a weak-day diary that records explanation, author, and date without changing source sales values.
3. Implement split corrections as auditable corrections with provenance for estimated vs confirmed allocations.
4. Clarify Centipid analytics imports and whether their totals are allocated or unallocated. Never silently convert an estimate into account-level actuals.
5. Build voucher batch/stock tracking only after defining issued, redeemed, expired, voided, and remaining-balance semantics and a stable source identity.
6. Improve mobile entry layout for sales and expenses, including connection/loading feedback, duplicate retry safety, and large touch targets.
7. Add data-quality flags for missing days, late data, possible duplicates, and unusual amounts with assignment and resolution history.
8. Keep data-health flags separate from financial entries; resolving a flag must not mutate money values.

**Completion criteria**

- Every sales total has clear source and allocation provenance.
- Voucher counts/balances reconcile with redemption events and cannot be double-counted.
- Data-quality review does not silently modify ledger records.
- Mobile entry remains usable on small screens and retries are idempotent.

### Phase 10 — Partner statements and distribution portal

**Tasks**

1. Define precisely which fields a partner can see: own ownership history, own contributions, own distribution decisions, own payouts, and statement-period context.
2. Ensure partner statements never reveal business-wide sales, expenses, other partners' statements, or unrelated records.
3. Show a clear period, completeness, ownership effective date, payout status, and calculation basis.
4. Add export/print for a partner's own scoped statement if appropriate.
5. Review role transitions, archived partners, ownership changes, and historical snapshots against current authorization checks.
6. Keep distribution approvals separated from record creation/payment where configured; retain independent approver controls.

**Completion criteria**

- Partner-specific reporting is useful without returning business-wide totals.
- Ownership effective dates and payout calculations can be explained from saved history.
- Cross-partner and cross-workspace access attempts are denied server-side.

### Phase 11 — Integration readiness and controlled activation

**Tasks**

1. Keep the current external Apps Script webhook untouched while collecting the deployed endpoint contract, caller list, retry behavior, and representative staging payloads.
2. Run staging parity for payment, voucher (including historical aliases), expense, ignored events, unauthorized requests, and duplicate retries.
3. Compare HTTP/JSON response shapes, ledger entries, account balances, daily totals, audit events, and idempotency behavior.
4. For Google Forms, install the companion script only in a staging copy and validate identity checks, respondent eligibility, queued retries, row idempotency, invalid sections, and review receipts.
5. Document rollback procedure and maintain the old endpoint through a defined rollback window.
6. Only change a production caller URL after parity evidence, owner/operator sign-off, and deploy configuration review.
7. Rotate/revoke integration tokens through the supported UI and ensure secrets are never printed or committed.

**Completion criteria**

- Staging parity evidence is recorded in `WEBHOOK_COMPATIBILITY.md`.
- Production cutover is an explicit operational step with a rollback window and known owners.
- Existing callers continue to work until the new route is verified and activated.
- No production deployment is targeted by local configuration.

### Phase 12 — Release, support, and follow-through

**Tasks**

1. Add one user-facing Changeset per released feature/fix.
2. Update README and compatibility docs when the shipped behavior or integration state changes.
3. Review role/permission matrices for each new query and mutation.
4. Run the project’s appropriate automated checks and staging workflows when implementation begins; no check should target production data.
5. Review mobile layout, keyboard navigation, focus management, loading/errors, and empty/restricted states for every new workflow.
6. Prepare release notes and operator guidance for onboarding, importing, closeout, receipt handling, report delivery, and rollback.
7. Track remaining deferred items explicitly instead of leaving stale “coming soon” board sections.

**Completion criteria**

- Documentation, Changesets, permissions, UI, and backend behavior agree.
- Release has a reversible deployment path and a staged data validation plan.
- Every incomplete workflow is either intentionally deferred and labeled or completed to its acceptance criteria.
- Create the pull request only after implementation and validation are complete. Do not merge unless the latest Greptile review is exactly 5/5 and has no unresolved comment issues; if that gate is not met, keep the PR unmerged, fix the findings, and request another review.

## Cross-cutting engineering requirements

Apply to every phase:

- **Authorization:** derive identity in Convex, verify active membership in the requested workspace, and enforce narrow permissions in each public function. Do not rely on client-side navigation visibility.
- **Financial correctness:** safe integer checks, consistent account and daily-total updates, idempotent writes, explicit state transitions, and auditable correction/reversal paths.
- **Data completeness:** cap or paginate unbounded reads; return completeness indicators when limits affect totals; never silently display partial totals as complete.
- **Privacy:** scope suppliers, receipts, exports, report recipients, imports, and partner statements to a business and role. Minimize personally identifying data.
- **Accessibility and responsiveness:** labels, keyboard controls, focus behavior, responsive tables/forms, understandable errors, and mobile-first entry workflows.
- **Operational safety:** staging first for imports and integrations; secrets only in deployment environment; backups and rollback instructions for schema/data transitions.
- **Compatibility:** preserve existing idempotency contracts and integration aliases until a tested migration is approved.

## Recommended delivery milestones

1. **Trust and clarity:** Phases 0–2.
2. **Operational controls:** Phases 3–6.
3. **Reporting and close:** Phases 7–8.
4. **Sales quality and partner access:** Phases 9–10.
5. **Integration activation and release readiness:** Phases 11–12.

The order is intentional: first make current behavior legible and establish reliable starting balances; then add workflows that depend on those balances; then automate delivery and close; finally activate external routes with evidence and rollback.
