# Deployment configuration

## User-provided production Convex project

- Cloud URL: `https://benevolent-swordfish-900.convex.cloud`
- HTTP Actions URL: `https://benevolent-swordfish-900.convex.site`
- Region shown in the dashboard: US East (N. Virginia)
- The dashboard showed “Never deployed” and “No backup yet” when supplied.

This project configuration is documentation only. Do not use production as the local development backend. The app must first be deployed to an isolated development or staging deployment and the compatibility and recovery steps completed.

## Environments

| Environment | Convex deployment | Vercel environment | OAuth callback |
|---|---|---|---|
| Local | Convex dev deployment | Local | `https://<dev-deployment>.convex.site/api/auth/callback/google` |
| Preview | Stable staging or isolated preview deployment | Preview | `https://<staging-deployment>.convex.site/api/auth/callback/google` |
| Production | `benevolent-swordfish-900` | Production | `https://benevolent-swordfish-900.convex.site/api/auth/callback/google` |

Keep `NEXT_PUBLIC_CONVEX_URL` aligned with the environment’s Convex cloud URL. Keep Convex deploy keys, `AUTH_GOOGLE_SECRET`, and `OWNER_SETUP_CODE` in the relevant server/deployment environment only. Never add them to Git or any `NEXT_PUBLIC_*` variable.

## Production readiness items

- Create and configure the Google OAuth client, including the exact production callback.
- Back up or confirm the production database is empty before the initial schema deployment.
- Set up the Vercel project to deploy from this app root and add an environment-scoped Convex production deploy key.
- Confirm the app’s webhook contract and decide whether it remains external or is migrated through a compatibility adapter.
- Set the one-time owner setup code in Convex, establish the owner, then remove the setup code.
- Configure monitoring, backups, restore instructions, and a rollback target before any live data migration.
