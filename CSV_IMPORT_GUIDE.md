# CSV import guide

Cashbook imports and Centipid yearly analytics reports are handled separately in Settings → Data.

## Cashbook CSV

Use the downloadable `date,kind,category,account,amount,note` template or map columns from another CSV. Date accepts `YYYY-MM-DD` or `DD/MM/YYYY`; amount is a positive decimal in the workspace currency; kind is `sale` or `expense`; account is `cash` or `mobile_money`. The owner reviews the mapping and preview before importing. Each file is content-hashed, sent in bounded chunks, and row-keyed for idempotent retry. Reimporting the same file skips rows that were already saved. Rows are validated server-side, stored with source `import`, and included in the audit log.

## Centipid Analytics Report CSV

The report with the `Centipid Analytics Report` header is auto-detected. The import checks the required Summary, Payment methods, Daily revenue, Daily data usage, and Router breakdown sections. It verifies that daily revenue matches the report Revenue and payment-method total before writing anything.

- Positive daily revenue values become dated sale entries under `Unallocated · Centipid`. Since the report has no transaction IDs or daily account split, these rows do not change cash or mobile-money balances.
- Zero-revenue days stay in the retained report dataset rather than creating zero-value ledger entries.
- Summary values, all payment-method rows, the complete daily revenue and data-usage series, and router breakdown rows are preserved as report details on the import batch.
- Usage, router sessions/subscribers, overdue invoices, and service metrics are not turned into finance entries.
- The import history shows row counts and provides an owner-only view of retained report details.

Files are limited to 5 MB and 10,000 data rows. Importing creates new ledger entries and is not a destructive replacement. The source CSV is not uploaded or stored as a raw file.
