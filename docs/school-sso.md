# Configure official school sign-in

An administrator must register this app with the school's official identity service. Never collect a school password in this application. The school provider displays its own sign-in page; this server receives an authorization result.

For Microsoft 365 / Teams school accounts, use [the Microsoft Entra guide](microsoft-365.md), including `OIDC_PROVIDER=microsoft`, the exact tenant GUID issuer, and `client_secret_post` token authentication. The settings below describe a generic OIDC provider.

## Information to request from school IT

1. Approval to run this application and store the intended student records.
2. A single, school-specific OIDC issuer with a discovery document and signing keys.
3. A confidential web client ID and client secret, delivered through a private channel.
4. Approval for authorization code flow, PKCE S256, and `openid profile` scopes.
5. An exact callback registration: `https://YOUR-APP-HOST/auth/callback/`.
6. An application assignment/group policy restricting sign-in to approved students.
7. The provider's supported token endpoint authentication method and secret rotation process.
8. Test accounts for at least two different students and the expected offboarding process.

Default token endpoint authentication is `client_secret_basic`. If IT specifies another supported method, set `OIDC_TOKEN_ENDPOINT_AUTH_METHOD` accordingly and test it. Do not put secrets in the repository, browser code, issue descriptions, or screenshots.

The generic profile deliberately requires provider metadata to advertise the `code` response type, PKCE `S256`, and an allowed asymmetric ID-token signing algorithm. The reviewed Microsoft public-cloud profile accommodates tenant metadata that omits PKCE advertisement while continuing to use S256. Other providers that omit it need a compatible school-approved broker or a separately reviewed compatibility change. Do not silently relax validation to make a provider work.

## Server settings

```dotenv
DEBUG=False
ALLOW_DEMO_LOGIN=False
APP_BASE_URL=https://grades.school.example
OIDC_PROVIDER=generic
OIDC_ISSUER_URL=https://identity.school.example/exact-school-issuer
OIDC_CLIENT_ID=<registered-client-id>
OIDC_CLIENT_SECRET=<registered-client-secret>
OIDC_REDIRECT_URI=https://grades.school.example/auth/callback/
OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic
```

`APP_BASE_URL` is the externally visible fixed origin, and `OIDC_REDIRECT_URI` must use that origin. The application does not build its callback from arbitrary request headers. Supply the exact issuer from the provider's metadata; do not replace it with a general login homepage or a multi-tenant endpoint.

Students are identified by the validated `(iss, sub)` pair. Changing issuer, broker, or subject identifiers can create new local accounts; plan a verified migration rather than linking by matching email addresses. The provider must enforce the allowed school tenant and application assignment. This app does not check student enrollment through a roster API.

## SAML-only schools

Direct SAML authentication is not implemented in this starter. The school can operate or approve an identity broker that accepts its SAML assertions and issues OIDC tokens to this app. Register the app at the broker, pin the broker's school-specific OIDC issuer, and restrict allowed upstream providers/tenants and student assignments there. The broker is part of the trust boundary and needs its own patching, key rotation, monitoring, and policy review.

If a direct SAML service provider is required, implement it as a separate reviewed change with maintained tooling, metadata/certificate management, audience/recipient validation, replay protection, and comprehensive integration tests.

## Verify before inviting students

- Start sign-in from the app, complete the official provider page, and confirm return to the exact callback.
- Confirm an unassigned/outside-school account is rejected by the provider.
- Sign in as student A, import synthetic grades, then sign in separately as student B and confirm A's records are absent.
- Confirm the callback rejects missing/incorrect state and tokens from another issuer or audience.
- Confirm local demo access is unavailable and sessions expire as configured.
- Confirm account offboarding behavior. Disabling an IdP account does not immediately revoke an already-issued local session; this starter has a one-hour session lifetime and no back-channel logout.

The app's sign-out only flushes its local session. A shared-device user should also follow the school's procedure for signing out of the school identity provider.

No live school provider can be verified without the school's registration and test accounts. The included tests exercise application behavior using controlled inputs; they do not replace provider testing.

Implementation background: [Authlib Django client documentation](https://docs.authlib.org/en/stable/oauth2/client/web/django.html), [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).
