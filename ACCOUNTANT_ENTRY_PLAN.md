# Accountant entry: app form and Google Form bridge

## Goal

Let the accountant submit finance records from the protected MylesNet app or from the existing Google Form. Both routes must reach the same Convex workspace, use the same finance rules, deduplicate retries, and leave an attributable audit trail. Keep the reference boards, images, and existing Centipid webhook unchanged.

## Confirmed source workflow

- The workbook has a linked `MylesNet Entry Form` with sections for Sales, Expense, Money movement, Savings / investment, and Loan. It collects respondent email and writes responses to the protected `Form responses 1` sheet.
- An installed Apps Script trigger runs `onEntrySubmit` for form submissions. The current source handler appends normalized rows to the legacy Sales, Expense, Movements, Savings, and Loans tabs; it does not send those submissions into Convex.
- The current web app already has direct sale and expense forms plus operational forms for movements, savings, loans, bills, reconciliation, and partner creation. These use separate Convex operations rather than one common intake contract.
- The Google Form's current fields do not fully describe several app transactions. Loan entries omit start date, term, and deposit account; savings entries omit the source account and whether the value is a balance or a cash flow; money movement includes partner payouts and other adjustments that are not supported as posted movement types. These submissions must be held for completion/review, not silently guessed into finance records.

## Delivery plan

### 1. Shared intake contract

Define a typed submission envelope with a stable source key, submission timestamp, submission kind, normalized field names, and source label. Keep respondent email out of finance notes and logs. Validate date, currency precision, category, account, and amount server-side. Derive workspace and actor context from the authenticated user for app submissions; authenticate Google Apps Script separately with a dedicated rotated secret.

### 2. In-app accountant workflow

Provide one clear `Add entry` entry point with the five form types and conditionally show the fields for the chosen type. Reuse the existing authenticated Convex operations for Sales, Expenses, Movements, Savings, and Loans, and link to the related workflow when the operation requires an existing holding, bill, loan, or partner. Do not weaken role checks. Keep warning confirmations, idempotency keys, and audit events.

### 3. Google Form compatibility bridge

Add a separate Convex HTTP route for Google Form submissions; do not change `/centipid` or the deployed Apps Script `doPost`. Extend the existing `onEntrySubmit` path to POST a normalized event after the current Sheet write succeeds. Use a deterministic response key and retry-safe response semantics. Store unsupported/incomplete submission types in a protected review queue. Do not expose or reuse the Centipid webhook token.

### 4. Staging parity

Use a development Convex deployment and a test copy/form or explicit test submissions. Compare one valid and one invalid submission for each form section, retry each accepted submission, and verify one saved effect, expected balances/reports, and audit history. Keep Sheet writes enabled while comparing. Never use a test helper that appends fake data to the live workbook.

### 5. Production activation and cutover

After staging parity, set the dedicated secret in the production Convex deployment and Apps Script properties, deploy the reviewed adapter, verify real accountant submissions, and monitor retries/duplicates. Keep the Sheet as a rollback record during a named transition period. Decide and document whether the Sheet remains a mirror or becomes read-only before disabling any legacy writes.

## Acceptance criteria

- App and Google Form submissions are tenant-scoped, validated, idempotent, and attributable.
- Replayed Google Form events never create duplicate ledger or operational effects.
- Incomplete/unsupported submissions appear with a clear review status and cannot alter balances until valid data is supplied.
- The app's existing webhook endpoint and contract, all design-reference assets, and existing financial records remain untouched.
- Staging parity succeeds before any production endpoint, secret, trigger, or Form behavior is changed.

## Implementation progress on this branch

- Added a common `Add an entry` starting point that routes to the existing authenticated Sales, Expense, Movement, Savings, and Loan forms.
- Added a separate Convex Google Form endpoint with a dedicated owner-managed token sent in a bearer header, idempotent response receipts, member-email matching, and automatic posting for valid Sales and Expense submissions. The sales mappings match the current `Code.gs` field labels and default app income categories.
- Greptile review fixes on this branch query active tokens directly (so revocation/rotation has no historical-row limit) and bound queue retries so permanently failing rows cannot block new submissions; failed rows can be manually retried after correction.
- Google Form amounts are UGX; non-UGX workspace submissions now go to review. The bridge also honors required-note, negative-balance, and duplicate safeguards, and reads dates from typed response cells using the spreadsheet timezone/locale.
- Added an owner-visible receipt list in Settings → Data. Other form types and invalid/unmapped records are clearly held for review and do not affect balances.
- Added a companion Apps Script queue with retry delivery and a setup guide. It is source-only and has not been installed into the live Apps Script project.
- TypeScript typecheck passes. Convex code generation could not run because this isolated checkout has no configured development deployment; the API type map was updated locally. No Convex or Vercel deployment was made.
- Production activation remains a separate cutover after staging copy, configured category mapping, parity review, and owner approval.

## Release boundary

The app-side endpoint and companion Apps Script source can be prepared in this branch. Production connectivity cannot be considered active until the dedicated secret is configured in both systems and a reviewed Apps Script deployment is authorized and verified. No production data migration is included in this work.
