# MylesNet Finance Tracker

- Keep `design-reference/` as read-only source material. Do not edit, recompress, rename, or regenerate its boards, screenshots, tokens, or original brand assets.
- The supplied logo, banner, and design tokens are copied into `public/brand/` and `app/tokens.css`; keep those copies byte-for-byte aligned with their references.
- Keep finance calculations and authorization in Convex. Every public query and mutation that reads or changes business data must derive identity server-side and enforce membership/role access.
- Store UGX as whole-shilling safe integers. Keep ledger corrections auditable and use idempotency keys on transaction ingress.
- Before changing files in `convex/`, read `convex/_generated/ai/guidelines.md` and regenerate Convex types after schema/function changes.
- Do not modify or redirect the existing external webhook until its deployed contract is captured in `WEBHOOK_COMPATIBILITY.md` and staged parity is confirmed.
- Use development or staging data for local work; do not target the production Convex deployment from a local `.env` file.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
