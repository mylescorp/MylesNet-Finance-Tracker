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

## External facts still required for full integrations

The repository does not include the original workbook export, webhook endpoint/call samples, messaging/calendar provider contracts, or backup/archive credentials. Preserve compatibility and make the corresponding views explain their not-configured state until those inputs are supplied. Do not invent sample figures as production data or change the webhook as a substitute for discovery.
