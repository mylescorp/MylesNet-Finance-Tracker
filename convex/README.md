# Convex backend

This directory is the authoritative backend for the MylesNet Finance Tracker. Follow [`_generated/ai/guidelines.md`](./_generated/ai/guidelines.md) before changing backend functions.

- `schema.ts` defines business membership, cashbook entries, operational finance records, daily totals, and the audit log.
- `workspace.ts` contains authenticated cashbook entry and dashboard functions.
- `operations.ts` contains authenticated movement, savings, loan, bill, partner, and reconciliation functions. Event treatment is documented in [`../CASHBOOK_RULES.md`](../CASHBOOK_RULES.md).
- `auth.ts` configures Google OAuth through Convex Auth.
- `http.ts` registers Convex Auth routes plus a parallel Centipid compatibility endpoint. The existing Apps Script webhook remains untouched until staging parity and caller cutover are approved.

All finance queries must authorize the current user server-side, be bounded/index-backed, and avoid returning data from another business. Financial amounts are whole UGX integers.
