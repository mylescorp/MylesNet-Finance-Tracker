# Convex backend

This directory is the authoritative backend for the MylesNet Finance Tracker. Follow [`_generated/ai/guidelines.md`](./_generated/ai/guidelines.md) before changing backend functions.

- `schema.ts` defines business membership, cashbook entries, daily totals, and the audit log.
- `workspace.ts` contains authenticated queries and audited entry mutations.
- `auth.ts` configures Google OAuth through Convex Auth.
- `http.ts` currently registers Convex Auth HTTP endpoints only. The existing external webhook remains untouched pending its contract inventory.

All finance queries must authorize the current user server-side, be bounded/index-backed, and avoid returning data from another business. Financial amounts are whole UGX integers.
