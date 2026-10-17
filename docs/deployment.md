# Deploy a shared HTTPS dashboard

This guide deploys **school mode**, whose shared link is the HTTPS address of a running Django server. GitHub can hold the project and run checks; GitHub Pages cannot run this backend. The standalone guest app can be published separately with [the GitHub Pages guide](github-pages.md). For school mode, choose approved hosting with Python/container support, a persistent database, secret storage, HTTPS, backups, and an operational owner.

Use synthetic data until school IT has approved and tested the identity configuration and storage policy. This guide is a deployment template, not a claim that a particular school/provider has been connected.

## 1. Prepare production configuration

Create an untracked `.env` from `.env.example`, or use the host's secret/configuration store. Set the following to real registered values:

```dotenv
DEBUG=False
ALLOW_DEMO_LOGIN=False
SECRET_KEY=<fresh-random-secret-at-least-50-characters>
APP_BASE_URL=https://grades.school.example
ALLOWED_HOSTS=grades.school.example
CSRF_TRUSTED_ORIGINS=https://grades.school.example
OIDC_PROVIDER=generic
OIDC_ISSUER_URL=https://identity.school.example/exact-school-issuer
OIDC_CLIENT_ID=<registered-web-client-id>
OIDC_CLIENT_SECRET=<registered-web-client-secret>
OIDC_REDIRECT_URI=https://grades.school.example/auth/callback/
OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic
DATABASE_URL=postgresql://grades:<url-encoded-password>@database.example:5432/grades?sslmode=require
TRUST_PROXY_HEADERS=False
```

Generate a secret locally with `python -c "import secrets; print(secrets.token_urlsafe(64))"`. Never use the displayed placeholder or a CI/build secret. Do not reuse development secrets. Keep the file readable only by the relevant operator and application process.

Register the exact callback with school IT, and use a single school-specific issuer and approved student application assignments. See [school SSO setup](school-sso.md). Configure TLS for the database as required by your provider; use certificate verification where the provider supports it. Do not expose the database to the public internet.

For Microsoft 365 school accounts, replace the generic provider values with [the Entra configuration](microsoft-365.md). That guide also explains Microsoft's production credential recommendation and the starter's current client-secret limitation.

Use PostgreSQL for a shared school deployment. The Compose file falls back to SQLite in a named volume if `DATABASE_URL` is omitted; this is a small single-host evaluation option and is not suitable for multiple app replicas. Do not use an ephemeral container filesystem for records.

## 2. Build and migrate explicitly

Install Docker Engine/Desktop and Docker Compose, then run from the project root:

```sh
docker compose build
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py check --deploy
docker compose up -d
```

The image runs Gunicorn as a non-root user and collects public static files at build time. The service has a read-only root filesystem, a writable temporary directory, and a persistent `/app/data` volume for the SQLite fallback. It publishes port 8000 only on the host's loopback interface. The supplied `.dockerignore` excludes local secrets, databases, export folders, and CSVs except the synthetic sample. Review the build context to ensure it contains only project source and synthetic fixtures.

Migrations are an explicit release step so several workers do not race during startup. Back up existing records before deploying changes. Do not run `seed_demo` in production. For managed platforms, use an equivalent release command, supply environment variables through the platform, and use a persistent external database.

`check --deploy` may report warnings for HSTS subdomains and preload: the starter deliberately does not assume you control every subdomain or want browser preload registration. Review every warning in your actual environment rather than suppressing it globally. CI checks production configuration with placeholder values and fails on errors; it does not contact a real identity provider.

## 3. Put HTTPS in front

Expose only an HTTPS reverse proxy/load balancer to the internet. Keep direct Gunicorn access private. The proxy must validate the expected host, terminate TLS, reject unexpected hosts, and strip/replace any client-provided forwarded protocol header.

For example, if Caddy runs directly on the same host as the supplied Compose service and the domain resolves to that host, a minimal Caddy site can be:

```caddyfile
grades.school.example {
    reverse_proxy 127.0.0.1:8000 {
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Replace the example domain and configure Caddy/your firewall for certificate issuance and HTTPS. A proxy inside another container needs an appropriate private network/backend address instead of host loopback. Refer to your proxy's current official documentation when adapting this example.

After verifying that the app can only receive traffic from that trusted proxy and the proxy replaces `X-Forwarded-Proto`, set `TRUST_PROXY_HEADERS=True` and restart the web service. Leaving it false behind a TLS-terminating proxy can cause HTTPS redirect loops. Enabling it with an untrusted path allows clients to lie about connection security.

Apply sensible request size limits, request/connection timeouts, and rate limits to sign-in, callbacks, imports, and other expensive routes at the edge. The app's upload validation is not a substitute for network limits. Avoid access logging of query strings and bodies; OAuth callback URLs contain short-lived authorization codes. Do not enable raw Gunicorn access logs or let external error tools capture credentials, tokens, claims, or grade contents.

## 4. Verify the real deployment

1. Confirm HTTP redirects to the expected HTTPS origin and unrecognized hosts fail.
2. Run `manage.py check --deploy` with actual production configuration; resolve or document each warning.
3. Use two school-approved test students. Import different synthetic grades and verify separation through the dashboard, manual changes, imports, exports, simulator, and deletion.
4. Verify outside-school/unassigned accounts are denied by the identity provider and demo sign-in is unavailable.
5. Test CSRF rejection, session expiry, local sign-out, privacy headers, static assets, and the exact callback.
6. Verify database persistence across service replacement, encrypted backup storage, and a complete restore into a test environment.
7. Confirm no records, secrets, or authorization codes appear in logs or monitoring.
8. Publish an accurate privacy/retention notice and a private support/security contact before inviting students.

The app has no unauthenticated health endpoint. If your host needs a liveness probe, use a TCP probe or a reviewed minimal endpoint that discloses no records or configuration. A database-ready probe and alerts should be designed for your hosting environment.

## 5. Operate and update

Regularly patch dependencies and the base image, review CI dependency advisories, rebuild, run tests, back up, apply migrations, and roll out a reviewed release. Maintain a rollback plan that considers schema changes. Do not treat restoring an old image as automatically safe after a destructive migration.

Run expired-session cleanup on a host-managed schedule:

```sh
docker compose run --rm web python manage.py clearsessions
```

Set the frequency and retention policy according to your operational needs. This project does not create a scheduler automatically.

Restrict database and host access, rotate secrets, and monitor redacted operational errors and availability. Document how to disable a student's access and revoke existing sessions when necessary. The starter's local sessions last up to one hour and do not receive back-channel account-disable events.

The student's deletion flow removes live subjects and grades but keeps their local sign-in identity. Establish an operator process for complete account removal; backups remain subject to the retention rules. Never use `docker compose down --volumes` as a routine restart because it deletes the SQLite named volume. Use `docker compose stop`/`start` or `up -d` for ordinary service operations.

Official references: [Django 5.2 deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/), [Gunicorn deployment](https://docs.gunicorn.org/en/stable/deploy.html), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
