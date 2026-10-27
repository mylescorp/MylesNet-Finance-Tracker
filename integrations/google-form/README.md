# Google Form bridge

This bridge is a separate ingress path for the existing accountant Form. It does not change the Centipid route, the legacy `doPost`, or the current `onEntrySubmit` sheet-writing behavior.

## What it does

- The dedicated Convex endpoint is `POST /google-form` with the private token sent as an `Authorization: Bearer ...` header; its token is independent from Centipid's.
- The Apps Script trigger writes form responses to a hidden retry queue, then sends them to Convex. A stable spreadsheet/sheet/row key makes delivery idempotent.
- Valid Sales and Expense submissions are posted to the ledger when the existing workspace categories and accounts match.
- Movement, Savings / investment, Loan, unknown, invalid, or incomplete submissions are recorded as `Needs review` and do not change balances.
- The respondent email is used only to match an active owner/cashier membership; it is not saved in the receipt or finance notes. Unmatched respondents are held for review.
- Retries run every five minutes, stop after eight transient failures, and mark permanent 4xx failures as `failed` so they cannot block later rows. The hidden queue keeps the failure result; `retryFailedGoogleFormRow_` can manually requeue a failed row after fixing the cause. Convex keeps an owner-visible receipt history in Settings → Data.

## Staging setup

1. Use a development Convex deployment and a staging copy of the workbook and linked Form. Do not install the trigger on the production Sheet during development.
2. Deploy the app branch to the staging Convex deployment so the `/google-form` route and schema are available.
3. In the staged app, open Settings → Data and create the Google Form connection URL. Copy it once; the secret is not shown again.
4. Add `GoogleFormBridge.gs` to the staged bound Apps Script project. Do not replace `doPost` or `onEntrySubmit`.
5. Run `configureGoogleFormIngressUrl_` and paste the copied URL. Run `installGoogleFormBridgeTriggers_` and approve Google’s script permissions.
6. The app's default `Product sales` and `Service income` categories cover the Form's sales subtypes. If you renamed them, ensure income categories still unambiguously map product/direct/equipment sales and installation/connection fees. Expense categories must match the Form's `Category` choices, and `Paid from` must identify cash or mobile money. Submit a test Sale and Expense; retry one queued row and confirm it is deduplicated. Submit Movement, Savings, and Loan responses and confirm they appear as `Needs review` without changing balances.
7. Compare the staged app totals and receipts with the response Sheet and Apps Script audit trail. Resolve category/date mapping before production use.

## Production activation

Production activation requires a reviewed deployment of this app and an owner-approved staging parity result. Then create a production-only connection URL, set it in the production Apps Script project, install the trigger, and verify a real submission. Keep the existing Sheet writes and response history during the agreed rollback period. Do not remove the old handler or Centipid endpoint as part of this bridge.

## Current limitations

The existing Form cannot safely auto-post every section. It does not collect sufficient account/flow details for Savings / investment and Loan, and some movement choices (partner payout and other cash adjustment) lack an approved accounting rule. Those are intentionally review-only until the form fields and cashbook policies are resolved. The review queue is informational in this initial bridge; posting a queued record requires entering it through the app's approved workflow.
