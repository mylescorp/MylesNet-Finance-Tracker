# MylesNet Finance Tracker — Settings product plan

This plan makes Settings the control center for the cashbook while preserving the approved brand imagery, design references, audit trail, and existing webhook contract.

## Product behavior

### General and regional settings

- Select a country or territory, the business timezone from its timezones or the full global timezone list, locale, date format, week start, and fiscal-year start month.
- Country selection suggests the country's currency and timezone. Owners may select another supported ISO currency and timezone.
- The cashbook currency may change only before the first opening balance or transaction. After that, it is locked so existing values and totals cannot be relabelled. A future currency migration must convert and audit historical values before unlocking it.
- Store monetary values as safe integer minor units, using the selected currency's ISO precision. UGX remains whole shillings; currencies with fractional units use their supported precision.
- Use timezone, week-start, fiscal-year, locale, and currency preferences in entry capture and reporting.

### Finance

- Configure income and expense categories used by the entry forms.
- Set cash and mobile-money opening balances before ledger activity; opening balances initialize account balances and stay distinct from sales and expenses.
- Configure sales targets and expense warnings for reporting.
- Keep the currently supported accounts explicit: cash and mobile money. Additional account types need a migration and reconciliation design before they are added.

### Rules

- Flag large expenses and low-sales days for human review.
- Warn on likely duplicate entries and negative account balances, with an explicit continue action.
- Optionally require a note on every new entry.
- Record rule overrides in the audit log. Rules never silently rewrite or delete transactions.

### Data and privacy

- Let owners export up to 5,000 cashbook rows as UTF-8 CSV, including voided rows for audit visibility.
- Preserve the existing webhook; its route, payload, authentication, and behavior remain outside this release until its live contract and staging parity are captured.
- Do not claim an off-platform backup, restore, or spreadsheet import until the source columns, retention target, and restore workflow are defined and validated.

### Access

- Let an owner invite a cashier or partner using a one-time, seven-day link bound to the invited email address.
- The owner shares the link manually; invitation creation does not claim to send email.
- Owners can change cashier/partner roles, deactivate memberships, revoke pending invitations, and review recent access changes.
- Owner transfer remains a verified support operation; a workspace cannot remove its only owner from this screen.
- Partner memberships are deliberately restricted while partner-specific statement views are unfinished; the Access screen warns owners before inviting one.

### Releases

- Show the running application version, environment, build identifier when supplied, and verified release notes.
- Deployments remain controlled by the connected Vercel project and reviewed Git releases.
- Rollback, restore, backup verification, and feature-flag controls stay informational until the needed infrastructure and credentials are configured.

## Delivery order

1. Persist validated workspace preferences and audit consequential changes.
2. Apply timezone, locale, date range, fiscal calendar, and currency precision to entry forms and reports.
3. Add categories, opening balances, sales targets, and review thresholds.
4. Add safe owner exports and workspace access management.
5. Publish release information and make unsupported backup/import/deployment operations visibly unavailable.
6. Review all Settings routes at desktop and mobile sizes, confirm role enforcement, preserve brand files, and verify webhook compatibility.
7. Create the review PR, fix all review findings, and require a current Greptile 5/5 before merging.

## Release boundaries

This Settings release does not add multi-currency conversion for a populated ledger, spreadsheet import, external backup/restore, automated invitation email, email/WhatsApp/calendar delivery, or in-app deployment rollback. Those need source/provider contracts, a migration plan, and a staging validation path.
