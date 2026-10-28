# Production Completion Plan: CRUD, RBAC, and Recovery

This plan tracks every gap found in the production-readiness audit. Financial records use correction, void, or reversal events with actor, timestamp, reason, and linked audit history; hard deletion is reserved for unposted drafts and temporary uploads.

## Release gates

- [ ] Every public Convex read and write derives the current authenticated user server-side, resolves the selected workspace membership, and enforces a documented role permission.
- [ ] Every supported record type has a complete create/read/update/archive-or-reverse lifecycle, with balance and derived-total changes applied atomically.
- [ ] Every operation has workspace ownership checks, strict input validation, idempotency where it can be retried, and an audit event for consequential changes.
- [ ] UI actions match the server permission matrix and expose validation/recovery states without relying on hidden controls for security.
- [ ] Production build, typecheck, lint, and focused access/ledger lifecycle checks pass.
- [ ] PR receives a current 5/5 Greptile review with no new finding before merge; production deployment happens only after credentials, provider settings, and data recovery readiness are confirmed.

## Workstreams

### A. Auth, workspace selection, and RBAC
- [x] Replace the single-active-workspace assumption with an explicit selected workspace context validated against the caller's active membership. A server-backed selection and workspace chooser now drive a shared resolver used by public finance, settings, imports, analytics, distributions, and integration-management functions.
- [ ] Apply role/permission checks consistently to every public business query and mutation; document Owner, Cashier, Finance Approver, and Partner capabilities.
- [x] Add verified, audited owner transfer with protection against leaving a workspace without an owner. A transfer to a verified, active cashier or finance approver is supported with typed email confirmation; the outgoing owner retains cashier access.
- [x] Add paginated member, invitation, and audit history; maintain revocation as an auditable inactive state. Owner access screens page members, all invitation outcomes, and audit events; invitation revocation records a timestamp.

### B. Cashbook and account lifecycle
- [ ] Add safe correction and reversal screens for sales and expenses; retain originals and reconcile account balance and daily aggregates. Owner-only correction of posted manual rows now voids the original, links a replacement, adjusts account/day totals atomically, honors required-note and duplicate/negative-balance warnings, and records the reason and before/after values; imported rows and generated operational expenses still require their source-specific correction path.
- [ ] Add linked reversal workflows for movement fees, bill payments, loan interest, and other generated entries.
- [ ] Add account CRUD (create, rename/update, archive) with safeguards against removing accounts referenced by financial history.
- [ ] Preserve owner-only balance adjustments with immutable audit history and corrected same-accounting-period behavior.

### C. Operational records
- [ ] Movements: review, correction/reversal, and archive rules for transfer, withdrawal, deposit, and contribution. Owner-only reversal with linked fee reversal is implemented in this working branch; edit/archive coverage remains.
- [ ] Savings: edit/archive holdings and correct flows. Owner-only edit/archive/restore is now available for holdings, with a paginated archive view; archive requires a zero balance. Flow reversal restores holding/account balances with negative-balance review. Focused lifecycle verification remains.
- [ ] Loans: edit unposted terms, archive/void eligible loans, and reverse repayments. Owner-only repayment reversal now restores principal/account and voids linked interest history; loan lifecycle and focused verification remain.
- [ ] Bills: edit/cancel/archive schedules. Owner-only edit/archive/restore is now available for schedules, with a paginated archive view. Schedule edits use a stale-date guard and preserve recurrence anchors; payment reversal restores due date/account and voids linked expense history. Focused lifecycle verification remains.
- [x] Partners: owner-only profile updates and paginated archive/restore are implemented. Archival requires a zero effective ownership share, rejects unresolved future positive ownership, and is blocked while an active membership or invitation remains linked. Distribution creation includes archived partners' historical effective-dated shares, so archiving does not rewrite earlier periods.
- [ ] Reconciliation: correct counts through superseding records, reopen explained differences where authorized, and retain immutable count history. Owner-only current-day correction and reopen flows now preserve the audit trail; correction of older counts remains unavailable because historical book balances are not reconstructed.

### D. Distribution controls
- [x] Preserve the second-person approval, minimum payout, reserve, ownership snapshots, payout ledger, cancellation, and reversal rules. Proposal approval is restricted to a different active reviewer; payout limits and balance checks are enforced server-side.
- [x] Pending proposals can be cancelled with an owner-supplied reason and safely recreated with a new idempotency key. Proposal history and payout history are paginated, with reviewer permissions checked on every query and mutation.

### E. Imports and external ingress
- [ ] Add preview, completed-batch reversal, partial-batch recovery, and row-level correction while keeping source hashes/idempotency stable. Preview, source-hash idempotency, partial-batch resume/cancel, owner-only resumable reversal for completed or cancelled batches, and owner correction of imported rows are implemented; reversing a batch also reverses a corrected replacement. Focused lifecycle verification remains.
- [ ] Add paginated import history and exportable import reports. Import history now paginates in the owner settings screen, and retained Centipid metadata downloads as JSON; standardized CSV/PDF reports remain.
- [ ] Add integration receipt history, actionable failures, and safe idempotent retry/reprocess for Google Forms and Centipid. Receipt histories are now paginated; Centipid processing failures are recorded with safe retry counts; Google Form needs-review submissions can be retried with the same source key. Owner-triggered reprocessing and downloadable receipt exports remain.
- [ ] Preserve the existing webhook URL and payload contract; run documented staging parity before any caller cutover.

### F. Analytics, issues, reports, and close
- [x] Turn generated data-health flags into a persistent, role-scoped review queue with acknowledge/assign/resolve and audit events. Flags persist review status, note, and owner/cashier assignment by report-period issue key; the cross-period history is filterable by status and paginated.
- [ ] Complete report exports and paginated source data; distinguish print-to-PDF from generated downloadable PDF.
- [ ] Add period close, role-scoped lock/unlock with reason, and controls preventing edits to locked periods except authorized reopen/correction.
- [ ] Add scheduled report delivery and delivery history once the provider and recipient-consent contract are configured.

### G. Backup, restore, and production readiness
- [ ] Implement owner-authorized workspace archive export with integrity metadata and bounded/chunked generation.
- [ ] Implement validated restore/rollback workflow in a staging workspace, with collision checks and a dry-run report.
- [ ] Document off-platform backup schedule, retention, restore drill, and responsible operator.
- [ ] Validate OAuth, Convex production secrets, Vercel deployment settings, webhook parity, and data migration before cutover.

## External dependencies that must be resolved before production cutover

- Google OAuth and production deployment secrets must be configured in the provider consoles; never commit them.
- Report-delivery provider, recipient consent, sender identity, and retry rules need owner configuration.
- Production backup destination, retention requirements, and recovery operator need confirmation.
- Existing Apps Script/Centipid caller URL and staging parity results must be verified before redirecting traffic.
- The workbook import must be reconciled row-by-row against the production source before historical numbers are treated as authoritative.

## Current working branch evidence

- Accounts with multiple active workspace memberships now receive a workspace chooser and can switch from the sidebar. Selection is stored per user and audited. Manual cashbook entries; operational creation, edits, and reversals; reconciliation updates; account adjustments; partner ownership, distributions, approvals, payouts, and payout reversals; imports; integration token management; settings writes; invitations; member changes; and ownership transfer bind to the workspace ID displayed by the client and recheck membership server-side. Operations, analytics, distribution, import, and integration history reads now also bind explicitly. Remaining settings/workspace/report queries and a full permission/data lifecycle audit remain open.
- Owner-only movement reversal is implemented for transfers, withdrawals, deposits, and partner contributions. It reverses account effects, updates partner capital where applicable, voids the generated withdrawal-fee entry and daily expense totals, and writes an audit reason.
- Workspace ownership can be handed off to a verified, active cashier or finance approver after the current owner types the member's email and provides a reason. The former owner retains cashier access, and the transfer is audited.
- Owner access history now paginates member lists, accepted/pending/expired/revoked invitations, and audit events. Invitation revocation is separately timestamped so the history distinguishes it from acceptance and natural expiry.
- Reconciliation count corrections now preserve the original record as superseded and create a new immutable count with the updated book comparison, reason, idempotency key, and audit events. Corrections are limited to the current business day because the ledger does not reconstruct historical balances.
- Owners can reopen an explained reconciliation with a reason; the resolution fields are cleared while the earlier explanation and reopen reason remain in the audit history.
- Owner-only cashbook entry void controls are available on Sales and Expenses. Savings flow, loan repayment, and bill payment reversals now update linked balances, records, and daily expense totals atomically, with owner-only UI actions and audit reasons.
- Manual sale/expense correction now creates a linked replacement while voiding the original and atomically adjusts account balances and daily totals; review still needs to cover imported and source-generated records through their owning workflow.
- Savings holdings and recurring bill schedules now support owner-only edit, archive, and restore actions with validation and audit events. Archived records remain visible in their history sections; savings holdings cannot be archived while a balance remains.
- Archive lists are paginated; payment histories resolve their bill record independently from the currently loaded archive page. Bill rename/archive/restore no longer resets recurrence anchors or overwrites a payment date saved after the edit screen was opened.
- Partner names can be corrected without changing ownership. Partners can be archived only after ownership is reallocated to zero and linked active access is removed; restore is owner-only, and archived records remain paginated with the current effective share resolved from history. Historical distribution snapshots include the partner shares effective during the requested profit period. Ownership update idempotency keys now reject reuse for different share schedules.
- Distribution lifecycle review confirmed that approval requires a different active reviewer, proposal cancellation is reasoned and limited to pending requests, payouts enforce the remaining allocation and reserve thresholds, and proposal/payout history is paginated. Cancel and recreate is the supported amendment path.
- Data-health review history now has an owner/cashier-only paginated query across report periods and status filters for open, acknowledged, and resolved items. Rows retain period, issue type, amount, note, assignee, and last updater; status, assignment, and notes can be updated directly from the cross-period queue with the same stale-write protection and audit trail.
- Imported rows can now be corrected by an owner after their batch is completed or cancelled. The original source hash and row idempotency key remain intact; the replacement retains its import lineage, and batch reversal unwinds the replacement's own date, daily totals, and account effect. In-progress, reversed, malformed, or already-corrected imported rows remain ineligible.
- Integration work preserves the existing Centipid webhook URL and request/response contract. Owner-only paginated receipt histories now include attempts and actionable status, and retries reuse source keys to avoid duplicate financial records. Google Form history is paginated and needs-review submissions can be safely reprocessed from a source resend.
- Local typecheck, lint, production build, and `git diff --check` passed for this working branch. Convex code generation ran against a newly configured localhost-only deployment; no production deployment was targeted.
- PR #17 remains open. Greptile findings addressed in the current working changes include workspace response validation, stale form state on workspace switch, savings archive/restore isolation, bill restore limits, reconciliation correction semantics and concurrency, supported currency rounding, expired invitation revocation, and Google Form retry counts. Existing code also already derives paid-off loan status and hides direct-void actions for linked expenses. A fresh review is required after these changes are pushed. The PR is not merged or deployed. All unchecked workstreams remain in scope.
