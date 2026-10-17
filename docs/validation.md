# Verification at handoff

Verified locally on 17 October 2026 with Python 3.12, Django 5.2.18, Authlib 1.9.1, and Node.js:

- 46 Django tests pass. These cover student ownership for reads/writes/exports/deletion, CSRF, HTML escaping, CSV validation/atomicity/replay, weighted calculations, simulations, production guards, and guest/account separation.
- Authentication tests use a simulated school provider with real cryptographically signed ID tokens. They exercise PKCE S256, signature/issuer/audience/expiry/nonce validation, invalid state/replay, stable subject identity, and the Microsoft tenant configuration.
- 17 dependency-free Node tests pass for the guest calculations, CSV parser/export, saved-data validation, cancellation races, storage-failure privacy messages, and the in-app tutorial.
- The locked runtime dependencies passed `pip-audit` with no known vulnerabilities at the time of this check. This is a point-in-time advisory check, not a security guarantee.
- Migration consistency and Django configuration checks pass. Production deployment checks report only the intentional HSTS subdomain/preload warnings described in the deployment guide.
- Browser checks covered local-demo sign-in, the account dashboard, account predictions, guest manual entry, guest predictions, guest CSV import, optional browser saving, and temporary data clearing on reload. Mobile layout was checked as well. Both dashboards include a short guide that students can close and reopen.

No real school credentials, tokens, or student records were used. All demonstration records are synthetic. The source archive excludes databases, secrets, generated static output, and temporary files.

## Limits

No live school tenant or school grade API has been connected or tested. The Docker image could not be built in this environment because Docker is unavailable. GitHub Actions and hosted deployment are prepared. Repository checks run after the source is pushed. Adding the source files does not publish a website; school sign-in still requires approved provider configuration.

Run the included checks in your repository and perform the deployment guide's school-approved test-account checks before using the backend with real students. The guest site can be evaluated independently with synthetic data.
