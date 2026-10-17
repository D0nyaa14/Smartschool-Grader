# Security policy and deployment boundaries

This project is a starter application. It has not undergone an independent penetration test, a school compliance review, or a live school-provider integration test. Security depends on the application, identity provider, database, hosting, and their operators.

## Reporting a vulnerability

Do not post student records, secrets, live session cookies, authorization codes, or exploit details in a public issue. If this repository has GitHub private vulnerability reporting enabled, use **Security → Report a vulnerability**. Otherwise contact the repository owner through a private channel. A maintainer must configure a real private contact before inviting production users; this starter does not invent a reporting address.

Use synthetic records in reproductions. Include the affected version, configuration conditions, expected behavior, and concise reproduction steps. Only the repository's maintained and patched revision should be used for deployment; there is no promise of maintenance for historical starter copies.

## School backend controls

- Official OIDC authorization code sign-in through one configured issuer, using state, nonce, PKCE, and validated signed ID tokens.
- Stable issuer/subject identity; no password login, self-registration, or email-based account linking.
- Grade reads and changes scoped to the authenticated owner on the server. Import files cannot supply an owner.
- CSRF-protected state-changing forms, server-side score validation, upload limits, template escaping, and security/privacy headers. The `strict-origin` referrer policy sends only the origin, excluding page paths and query strings, and suppresses referrers on HTTPS-to-HTTP downgrades.
- Database-backed sessions with a one-hour lifetime; secure cookies and HTTPS enforcement when `DEBUG=False`.
- Local demo mode requires explicit development flags and loopback access. Production configuration rejects demo mode.
- OIDC tokens are used transiently for sign-in rather than stored as a grade-API credential vault. School-specific API synchronization is not implemented.

Read the code and tests for the precise behavior. A shared URL is not an access credential; each student must authenticate. A malicious or mistaken hosting operator can access the database. Stored grades are not end-to-end encrypted, and the starter does not provide application-layer encryption of database records.

## Public branding and creator privacy

Public branding can use a project name and omit a personal creator credit. It cannot promise anonymity toward the school or infrastructure providers. Microsoft Entra sign-in logs associate users with applications; school administrators with the relevant permissions can inspect them. App registration and school approval may also require the operator's identity. See [Microsoft's monitoring documentation](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/overview-monitoring-health).

Keep the public brand separate from the private operator/support contact. Before publishing, review the repository profile, commit author name/email, documentation, screenshots, and domain/hosting settings for unintended personal details. Enable **GitHub Settings → Emails → Keep my email addresses private**. In the intended repository, configure `git config user.email` with the exact `noreply` address displayed by GitHub; do not guess its format. This changes future commit metadata only and does not make the account or existing history anonymous. See [GitHub's email privacy instructions](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).

School SSO and its server database do not provide anonymous use. The separate guest app needs no account and keeps grade data in the browser, but it also cannot promise anonymity from infrastructure providers or the network.

## Guest mode boundary

The standalone `guest-site/` and Django's `/guest/` page use browser data, separate from all school accounts. Guest grades stay in memory by default. The user can explicitly select **Remember grades on this browser** to save a local copy; this local storage is not encrypted, is not an account backup, and can be read by someone with access to the same browser profile. Leave the option off on shared computers. Browser extensions, compromised scripts/devices, and manual exports are outside this isolation boundary.

The supplied guest app has no analytics, advertisements, CDN dependencies, or backend grade requests. Serving its files still creates normal requests to the host, so the host/network can observe a visit. **Clear all guest data** clears its guest memory and known saved local data after confirmation. Browser cleanup/private browsing can also remove records. Signing into the school app does not automatically upload, merge, or transfer guest data; movement requires a deliberate CSV export/import.

Publish only `guest-site/` with the included manual Pages workflow. Never publish the repository root, backend configuration, database, or private records. A public repository can expose the creator's GitHub handle and commit metadata. A school may block the site under its normal web policy; no bypass is provided.

## Operator responsibilities

Before real data, arrange school approval, an appropriate privacy notice, the minimum required records, retention/deletion rules, and a private incident contact. Configure the school's allowed tenant and application assignment, enforce appropriate MFA there, and test with two different students.

Keep production secrets in the host's secret manager, use a fresh random `SECRET_KEY`, set `DEBUG=False` and `ALLOW_DEMO_LOGIN=False`, restrict hosts/origins, and require HTTPS. A trusted reverse proxy must strip and replace forwarded headers before `TRUST_PROXY_HEADERS=True` is enabled. Restrict direct access to the app server.

Rate-limit sign-in, callback, imports, and other expensive requests at the edge. The starter does not include a distributed rate limiter, WAF, audit-log service, intrusion detection, malware scanner, or automatic account offboarding sync. Monitor operational health with redacted events. Avoid query strings and request/response bodies in access logs, because OIDC callback URLs may contain authorization codes. Configure external error tools so they do not capture tokens, claims, grade contents, or exception locals.

Use least-privilege database credentials, encrypted storage/backups, secure network connections, and restore-tested backups. Restrict staff/host access. PostgreSQL is recommended for a shared school deployment; SQLite is provided for local use and small single-host evaluation. Multiple application replicas must not use separate SQLite files.

Review and apply security updates to Python, the base image, dependencies, the identity broker if used, and the host. The CI audit checks known package advisories; it cannot prove the application is free of vulnerabilities or cover all operating-system/image advisories.

## Data lifecycle

The dashboard can export the current student's grades and delete all their subjects and grades after confirmation. The local sign-in identity remains; complete account removal requires an operator process. The school/operator must document that process and backup retention and handle any required access/deletion requests. Copies already exported by a user are outside the app's control.

Students remain signed into an already-created local session until sign-out/expiry even if their school account is subsequently disabled. This starter has no back-channel logout. Sign-out ends only this application's session, so shared-device users must follow the school's provider sign-out procedure as well.

Run Django's expired-session cleanup regularly. Document incident response and secret rotation, and test restoration and identity revocation before launch. Review [the deployment guide](docs/deployment.md) and [Django's official checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/).
