# MylesNet Finance Tracker

- Keep `design-reference/` as read-only source material. Do not edit, recompress, rename, or regenerate its boards, screenshots, tokens, or original brand assets.
- The supplied logo, banner, and design tokens are copied into `public/brand/` and `app/tokens.css`; keep those copies byte-for-byte aligned with their references.
- Keep finance calculations and authorization in Convex. Every public query and mutation that reads or changes business data must derive identity server-side and enforce membership/role access.
- Store UGX as whole-shilling safe integers. Keep ledger corrections auditable and use idempotency keys on transaction ingress.
- Before changing files in `convex/`, read `convex/_generated/ai/guidelines.md` and regenerate Convex types after schema/function changes.
- Do not modify or redirect the existing external webhook until its deployed contract is captured in `WEBHOOK_COMPATIBILITY.md` and staged parity is confirmed.
- Use development or staging data for local work; do not target the production Convex deployment from a local `.env` file.
