# Webhook compatibility record

## Captured Apps Script contract

The local `/home/myles/Downloads/Code.gs` source was inspected. The current Apps Script endpoint remains untouched and continues to serve existing Centipid callers. Its `doPost` contract is:

- POST accepts JSON, JSON arrays (first element), or form-encoded fields. JSON may wrap fields in `data` or `payload`.
- The event name comes from `event`, `event_type`, or `topic`, with a nested event fallback; absent event defaults to `payment.received`.
- An optional shared token is read from `?token=...` (`WEBHOOK_TOKEN` in Apps Script properties).
- Amount aliases: `amount`, `price`, `value`, `total`, `paid_amount`, `amount_paid`.
- Voucher redemptions must include the actual sale amount in UGX in one of those fields. The observed production `voucher.redeemed` payload only included `id`, `package_id`, `batch_id`, `subscriber_id`, and `redeemed_at`; that is insufficient to post a finance entry. The Centipid event producer must add `data.amount` (a positive whole-shilling value) before the receiver can book it.
- Payment reference aliases: `transaction_id`, `transaction`, `reference`, `ref`, `receipt`, `receipt_number`, `payment_id`, `id`.
- `payment.*` records a Centipid sale; `voucher.redeemed` records a cash/voucher sale; `expense.*` records an expense. Failed, refund, cancel, expiry, reversal, decline, and pending events are ignored.
- Duplicate references are skipped. Response JSON uses `success` with `routed`, `duplicate`, `ignored` with `event`, `unauthorized`, or `error`. The Apps Script returns JSON responses with HTTP 200 for handled outcomes.
- Payment notes contain method, description, masked customer identifier, and reference. Expense records map category/account to configured lists with fallbacks.

## App compatibility adapter

The app adds `GET /centipid` health and `POST /centipid?token=...`. It accepts the captured body/event/field aliases and response shapes, including a `voutcher` event-name typo normalized to `voucher`, keeps the token as a hash, fails closed unless an owner has created an integration token, deduplicates references within the same event type (matching the existing `event:reference` contract), ignores unsafe event classes, masks contact details, and records audit history. Payment defaults to mobile money, voucher to cash, and expenses use the paid-from hint. Revenue/expense are stored in the app's authenticated workspace.

The required voucher delivery shape is `{ "event": "voucher.redeemed", "data": { "id": "<redemption-reference>", "package_id": "<package-id>", "amount": 1000, "redeemed_at": "<timestamp>" } }`, where `amount` is the actual charged UGX amount. Receipts without a positive amount are intentionally ignored and do not change Sales, Dashboard, or Reconcile. A corrected delivery with the same redemption ID and a valid amount can be retried; it is not treated as a duplicate of the earlier amount-less receipt.

Accepted payment and voucher events update the corresponding account balance and daily sales totals. Settings → Finance derives Centipid payment and voucher subtotals from the day's existing posted webhook entries, so events recorded before this view was deployed are included without a data backfill. The cash sales estimate is calculated as total daily sales minus posted mobile-money sales. It is a reconciliation estimate, not the actual cash account balance, which also reflects opening balances, expenses, and movements. The balance view is a Convex subscription and updates without a page reload; it refreshes the business date every 30 seconds and when the tab regains focus. When more than 1,000 entries exist for the day, the UI warns that entry-derived breakdowns may be incomplete.

The new endpoint is a **parallel adapter**, not a cutover: it does not change the Apps Script deployment or URL. Generate a token in app Settings → Data, test the same representative payment, voucher, expense, ignored, unauthorized, and duplicate deliveries against a staging deployment, compare response bodies and ledger results, then update Centipid to the new endpoint. Retain the old URL during a rollback window. Production cutover is not complete until that parity run and caller URL update have been performed.

The actual deployed URL, current Apps Script token, caller list, retry timings, and production test events are not available in this checkout. Never print the existing token. The Apps Script token is independent from the app-generated token.

## Google Form accountant submissions

The workbook's linked `MylesNet Entry Form` has an installed spreadsheet `on form submit` trigger named `onEntrySubmit`. Its current handler writes to the legacy Sheet tabs. This implementation adds a separate `POST /google-form?token=...` Convex route and a companion queued Apps Script source under `integrations/google-form/`; it does not replace or redirect `doPost`, `onEntrySubmit`, or the `/centipid` route.

The Google Form connection has a separate owner-generated token. The adapter identifies a submission using its response-sheet/sheet/row key, checks the collected respondent email against an active owner or cashier workspace membership without persisting that email, and makes delivery idempotent. Valid mapped Sales and Expense submissions post to the cashbook; other or incomplete sections receive a `needs_review` receipt and do not change balances. The companion Apps Script source is not installed or deployed to the live project. Follow `integrations/google-form/README.md` in a staging copy before any production activation.
