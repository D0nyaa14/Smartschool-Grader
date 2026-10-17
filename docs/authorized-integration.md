# Add an officially authorized grade integration

No grade API connector is implemented in this starter. SSO provides identity, not permission to read school records. The existing CSV/manual workflows remain usable without any API access.

Before writing a connector, obtain the school's approval, the provider's official API documentation, an app registration, narrowly scoped permissions, and synthetic/test records. Agree who may retrieve which records and how long the app may retain them. Never reverse-engineer a student portal, automate password entry, or ask students to paste passwords, browser cookies, or tokens.

## Recommended extension boundary

1. Add a provider-specific server-side adapter using the provider's official supported authentication flow. Keep endpoints on a reviewed server configuration allowlist; do not accept URLs from students.
2. Identify the current student from the authenticated session. Map the provider's immutable student identifier to the verified local OIDC `(issuer, subject)` identity through an approved mapping process. A name or email match alone is insufficient.
3. Ask the official API only for that student's permitted records. Check the API response belongs to that exact student before any write. A successful API request is not proof of ownership.
4. Normalize the provider's year, subject, score, maximum, and weight semantics. If its official calculation differs, implement and test it explicitly rather than presenting this starter's formula as equivalent.
5. Store a provider/source identifier and unique external grade ID in a reviewed schema migration. Make sync idempotent. Define how updates, deletions, manual overrides, conflicts, and resits work.
6. Use bounded timeouts, response limits, rate limits, and retry rules. Treat provider strings as untrusted display content. Do not log record bodies, tokens, or secrets.
7. If refresh/access tokens must be stored, use a suitable encrypted secret store, least-privilege access, rotation, expiry, and a revocation/deletion process. This starter's sign-in path does not provide a token vault.
8. Add provenance and a visible last successful synchronization time. Show useful stale/error states without revealing another student's information.

## Required integration tests

- Two students cannot request, sync, view, export, overwrite, or delete each other's records, even if IDs or client request fields are changed.
- Wrong issuer/tenant, wrong student response, missing scope, revoked consent, and expired credentials fail closed.
- Duplicate syncs do not duplicate grades; corrections and deletions follow the agreed rules.
- Malformed/oversized responses and provider outages do not corrupt saved data.
- Secrets and grade contents do not appear in logs or error reporting.
- The displayed average matches test cases from the school's official calculation policy.

Release a connector only after school IT has reviewed the deployment and the API provider's authorization requirements. Do not describe an untested connector as a live school integration.
