# Webhook compatibility record

## Current status

The supplied workspace did not include the webhook source, URL, sample payloads, caller list, authentication details, or retry/response examples. The current webhook has **not** been modified, disabled, redirected, or replaced by this app implementation.

Convex's current `convex/http.ts` registers the Convex Auth routes only. It does not add a webhook route. Existing callers should continue using their existing endpoint until a compatibility adapter has been specified and validated.

## Required capture before migration

- Deployed URL and current owner/operator.
- Callers and trigger conditions.
- HTTP method, headers, authentication/signature scheme, and representative request bodies.
- Required success and error status codes and response bodies.
- Retry, timeout, duplicate-delivery, and replay behavior.
- Side effects and any spreadsheet tabs or fields changed.
- A staging or shadow comparison plus a rollback period and named cutover owner.

Once captured, preserve the current URL and wire format through an idempotent Convex HTTP Action or a stable adapter. Keep service-to-service authentication separate from Google OAuth, validate request data, and avoid logging secrets or finance payloads.
