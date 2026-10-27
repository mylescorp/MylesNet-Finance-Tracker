# Webhook compatibility record

## Captured Apps Script contract

The local `/home/myles/Downloads/Code.gs` source was inspected. The current Apps Script endpoint remains untouched and continues to serve existing Centipid callers. Its `doPost` contract is:

- POST accepts JSON, JSON arrays (first element), or form-encoded fields. JSON may wrap fields in `data` or `payload`.
- The event name comes from `event`, `event_type`, or `topic`, with a nested event fallback; absent event defaults to `payment.received`.
- An optional shared token is read from `?token=...` (`WEBHOOK_TOKEN` in Apps Script properties).
- Amount aliases: `amount`, `price`, `value`, `total`, `paid_amount`, `amount_paid`.
- Payment reference aliases: `transaction_id`, `transaction`, `reference`, `ref`, `receipt`, `receipt_number`, `payment_id`, `id`.
- `payment.*` records a Centipid sale; `voucher.redeemed` records a cash/voucher sale; `expense.*` records an expense. Failed, refund, cancel, expiry, reversal, decline, and pending events are ignored.
- Duplicate references are skipped. Response JSON uses `success` with `routed`, `duplicate`, `ignored` with `event`, `unauthorized`, or `error`. The Apps Script returns JSON responses with HTTP 200 for handled outcomes.
- Payment notes contain method, description, masked customer identifier, and reference. Expense records map category/account to configured lists with fallbacks.

## App compatibility adapter

The app adds `GET /centipid` health and `POST /centipid?token=...`. It accepts the captured body/event/field aliases and response shapes, keeps the token as a hash, fails closed unless an owner has created an integration token, deduplicates event IDs, ignores unsafe event classes, masks contact details, and records audit history. Payment defaults to mobile money, voucher to cash, and expenses use the paid-from hint. Revenue/expense are stored in the app's authenticated workspace.

Accepted payment and voucher events update the corresponding account balance, daily sales totals, and the live reconciliation figures in Settings → Finance. Daily Centipid mobile payment and voucher totals are tracked separately; voiding the corresponding webhook entry reverses those daily figures. The cash sales estimate is calculated as total daily sales minus posted mobile-money sales. It is a reconciliation estimate, not the actual cash account balance, which also reflects opening balances, expenses, and movements. The balance view is a Convex subscription and updates without a page reload.

The new endpoint is a **parallel adapter**, not a cutover: it does not change the Apps Script deployment or URL. Generate a token in app Settings → Data, test the same representative payment, voucher, expense, ignored, unauthorized, and duplicate deliveries against a staging deployment, compare response bodies and ledger results, then update Centipid to the new endpoint. Retain the old URL during a rollback window. Production cutover is not complete until that parity run and caller URL update have been performed.

The actual deployed URL, current Apps Script token, caller list, retry timings, and production test events are not available in this checkout. Never print the existing token. The Apps Script token is independent from the app-generated token.
