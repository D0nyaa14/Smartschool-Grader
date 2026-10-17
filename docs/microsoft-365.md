# School Microsoft 365 / Teams sign-in

School Microsoft 365 accounts use Microsoft Entra ID for identity. This app can use that official sign-in service when school IT approves and registers it. A browser extension, Teams add-in, or a student's password cannot grant this permission. Teams sign-in does not automatically provide grades; this starter still uses CSV/manual records.

This setup targets the Microsoft public cloud and one approved school tenant. It does not implement a live Teams/Graph grade connector or sovereign-cloud identity configuration.

## 1. School IT registers the web app

In the school's tenant, open **Microsoft Entra admin center → Entra ID → App registrations → New registration**. Choose **Accounts in this organizational directory only / Single tenant**. Record the Directory (tenant) ID and Application (client) ID. The tenant ID must be the school's approved GUID, not a tenant inferred from an email address. See [Microsoft's registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

Under **Authentication**, add a **Web** platform with the exact callback:

```text
https://YOUR-APP-HOST/auth/callback/
```

Use the actual deployed HTTPS host and keep the trailing slash. This server is a confidential web client: do not select SPA, enable public-client flows, or enable implicit/hybrid access-token or ID-token issuance. It uses authorization code flow with PKCE S256 and receives the ID token during the server-side code exchange. See [redirect URI configuration](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri) and [Microsoft's authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## 2. Restrict who may enter

Open the corresponding **Enterprise application → Properties** and set **Assignment required? → Yes**. Under **Users and groups**, assign only approved students or an approved student group. Confirm the tenant's consent policy and have an authorized school administrator grant the necessary consent; required-assignment apps need administrator consent. Group assignment depends on the school's licensing, and nested groups do not inherit assignment. See [access controls](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management) and [user/group assignment](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal).

A single-tenant issuer alone does not prove student enrollment: a school's tenant can contain teachers and guests. Assignment is the access rule. Do not rely on an email suffix, the presence of a Teams account, or a student's claim that they attend the school.

## 3. Keep sign-in permissions minimal

The app requests only **`openid profile`** for authentication. Review the registration's API permissions and remove unneeded defaults such as `User.Read`. Do not add mail, files, calendar, education/grades, application permissions, or `offline_access` for this starter. OIDC permissions can appear under Microsoft Graph in the portal; they do not mean this app calls the Graph data APIs. Any future grade API access needs a separate approved integration. See [Microsoft's OIDC documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [permissions/consent overview](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview).

## 4. Configure the server privately

For a school-approved test/pilot, IT can create a client secret under **Certificates & secrets → Client secrets**. Put its **Value**, not its secret ID, directly in the host's private secret store. Do not paste it into chat, a GitHub file, an issue, or browser code. Record its expiry and rotate it before expiry: add the replacement, update the host, verify sign-in, then revoke the old credential.

Microsoft recommends certificate or federated credentials for production and advises against production client secrets. This starter currently supports client-secret authentication; certificate/`private_key_jwt` support requires a reviewed extension before meeting that recommendation. A school must approve its credential approach. See [Microsoft credential guidance](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).

Supply these environment values along with the database and proxy configuration in the [deployment guide](deployment.md):

```dotenv
DEBUG=False
ALLOW_DEMO_LOGIN=False
SECRET_KEY=<fresh-random-application-secret>
APP_BASE_URL=https://grades.school.example
ALLOWED_HOSTS=grades.school.example
CSRF_TRUSTED_ORIGINS=https://grades.school.example
OIDC_PROVIDER=microsoft
OIDC_ISSUER_URL=https://login.microsoftonline.com/TENANT_ID/v2.0
OIDC_CLIENT_ID=<school-registered-application-client-id>
OIDC_CLIENT_SECRET=<private-client-secret-value>
OIDC_REDIRECT_URI=https://grades.school.example/auth/callback/
OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_post
```

Replace `TENANT_ID` with the approved tenant GUID. Never use `common`, `organizations`, `consumers`, a wildcard, or a student-supplied issuer. The app pins the exact issuer. The reviewed `microsoft` provider profile accommodates Microsoft's tenant discovery metadata when it omits PKCE advertisement; the actual authorization/code exchange still uses S256. Generic providers use `OIDC_PROVIDER=generic` and must advertise S256. The Microsoft profile is not a switch for arbitrary providers.

## 5. Test before sharing

Use two assigned test students with synthetic grades, plus an unassigned account. Confirm assigned students see only their own records, unassigned users cannot enter, the exact HTTPS callback succeeds, and demo access is unavailable. Test outside-tenant and guest cases according to the school's assignment policy. Check credential rotation and account-removal procedures.

Local sign-out ends this app's session; it does not sign the browser out of Microsoft 365. Existing local sessions can remain valid until expiry after an assignment/account change. No live school tenant has been verified merely by configuring this starter.
