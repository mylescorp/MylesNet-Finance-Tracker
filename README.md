# MylesNet Finance Tracker

## Product updates

The signed-in workspace changelog is available from **What's new** at the bottom of the sidebar. Its unread badge counts changes since the last visit on this browser and clears when opened. For each distinct user-visible change, add a `.changeset/*.md` file following the [Changeset instructions](./.changeset/README.md). Pull requests that change application code must include a Changeset. Do not edit `CHANGELOG.md` for ordinary feature pull requests; the release workflow updates it when preparing a versioned release.

Responsive finance workspace built with Next.js App Router, Convex, Convex Auth (Google OAuth), and Vercel. The approved design package is preserved in [`design-reference/`](./design-reference/).

## Local setup

1. Install dependencies with `npm install`.
2. Run `npm run dev`. Convex will ask you to select or create a **development** deployment and will write its URL into the local environment file.
3. Configure Google OAuth for that deployment. The callback URL is `https://<your-deployment>.convex.site/api/auth/callback/google`; set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in the Convex deployment environment, not in browser variables.
4. For the first owner only, set a strong random `OWNER_SETUP_CODE` (at least 32 characters) in that Convex deployment. Sign in with Google and use the one-time workspace setup panel. Remove the environment value after the first owner is established.

Do not point local development at the supplied production deployment. Use a separate development or staging deployment and seed it with non-production data.

## Production target

The user-provided production Convex deployment is recorded in [`DEPLOYMENTS.md`](./DEPLOYMENTS.md). Production deployment requires a scoped Convex deploy key, Google OAuth credentials and callback setup, Vercel environment variables, the first-owner setup secret, and a recovery plan. No credentials are stored in this repository.

## Current implementation scope

- Google sign-in and protected application routes.
- Business membership checks in Convex and a one-time first-owner claim.
- Auditable cashbook entries for sales and expenses, whole-shilling UGX amounts, idempotency keys, daily totals, and owner-only voiding.
- Dashboard totals and recent entries from Convex records. Empty or pending states do not use sample financial figures.
- Account balances change with recorded cash/mobile-money sales and expenses. They currently start from zero and need opening balances/imports before they represent the real business balances.
- Partner users are denied business-wide totals and transaction details until partner-specific reporting is implemented.
- Responsive shared navigation, preserved brand images and design tokens.
- Remaining board routes are scaffolded and mapped to the original 18 board specifications; their workflows are not yet live.

## Webhook compatibility

See [`WEBHOOK_COMPATIBILITY.md`](./WEBHOOK_COMPATIBILITY.md). Existing webhook code was not included in the supplied project files and has not been changed or cut over. Capture its real contract before adding an adapter.
