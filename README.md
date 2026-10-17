# Smartschool-Grader
This code wil make you're student life easier!

New to the project? Start with [START-HERE.md](START-HERE.md). The current version is free and has no ads or payments. [Verification details and remaining setup](docs/validation.md) are recorded separately.

A student grade dashboard with two choices: use the browser-only guest app without an account, or sign in through the school's official OpenID Connect (OIDC) provider to save private records in the Django app. Both modes support yearly subject averages, CSV/manual grades, and future-score predictions.

The app does not ask for school passwords, scrape portals, or assume access to a grade API. School SSO identifies a student; it does not grant access to their grades. CSV and manual entry work independently of an official integration.

| Mode | Sign-in | Where grades live | Hosting |
| --- | --- | --- | --- |
| Guest | None | Browser memory; browser storage only after explicit opt-in | Static `guest-site/`, including GitHub Pages, or the Django `/guest/` page |
| School | Official school SSO | Server database, scoped to the signed-in student | School-approved Python/Django host |

Guest and school records are separate. Signing in does not automatically transfer grades; use a deliberate CSV export/import to move them.

## What is included

- A school dashboard, filtered by the signed-in student and academic year.
- A guest dashboard with temporary browser data and optional explicit browser storage.
- Manual grade entry and CSV import/export, with server-side validation.
- A guest Excel progress report for the selected year, with formulas and native charts.
- Weighted subject percentages and a future-score simulator.
- School OIDC sign-in with one configured issuer and stable `(issuer, subject)` identities.
- A local-only demo with synthetic records, tests, GitHub Actions, and a Docker server image.
- A student's own grade-deletion flow and deployment/security documentation.

This is a usable starter, not a certified school records system. A school administrator still needs to approve the identity configuration, hosting, data policy, and any integration before real student records are used.

## Try or publish guest mode

The standalone guest app is in `guest-site/` and needs no build or school credentials. For a shared guest link, follow [the GitHub Pages instructions](docs/github-pages.md). The supplied publishing workflow runs only when you explicitly trigger it and publishes only that static folder.

For a local preview, run `python -m http.server 8000 --bind 127.0.0.1 --directory guest-site` from this project folder and open <http://127.0.0.1:8000>. The full Django app also offers **Continue as guest** at `/guest/`.

Guest grades are temporary by default. **Remember grades on this browser** opts into local browser storage; **Clear all guest data** removes the current and remembered guest records. Neither provides an account backup. Guest mode does not guarantee anonymity from the site host, network, or school.

Use **Download Excel report** for a readable `.xlsx` progress report of the selected school year. It includes recorded grades, excluding simulator predictions. The workbook opens with **Overview** and **Progress** sheets, subject averages, and native charts. Its score inputs and formulas let you explore changes in Excel after downloading, without an adjustable weight setting. Stored weights remain respected in its calculations. Edits stay in that workbook and do not synchronize back to the app.

Use **CSV backup** to move or restore grade records across all school years. CSV is a plain data format without workbook styling, formulas, or charts, and Excel's handling of its separators can depend on local settings. The app imports CSV; it does not import the Excel progress workbook.

## Run the local demo

Install Python 3.12 or 3.13. Open a terminal in this project's folder, where `manage.py` is located.

On Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

On macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` for local use:

```dotenv
DEBUG=True
ALLOW_DEMO_LOGIN=True
APP_BASE_URL=http://127.0.0.1:8000
ALLOWED_HOSTS=127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8000
```

Generate a fresh secret, then copy its output into `SECRET_KEY` in `.env`:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(64))"
```

Use `.venv/bin/python` instead of `.\.venv\Scripts\python.exe` in all following commands on macOS/Linux.

```powershell
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_demo
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

Open **<http://127.0.0.1:8000>**, then use the demo sign-in button. The demo needs both `DEBUG=True` and `ALLOW_DEMO_LOGIN=True` and a loopback connection. Keep the development server bound to `127.0.0.1`. Never put demo mode behind a public link or a tunnel.

The SQLite database is local to this installation. Stopping the server preserves it. Restart with the last command above. The demo is for synthetic data; do not import real student records into it.

## Add grades

In school mode, sign in and choose an academic year; in guest mode, continue without an account. Add grades manually or import a CSV.

New manual grades and new simulated assessments count equally. There is no weight option to fill in. Editing an existing grade preserves its saved weight, and CSV imports retain their supplied weights, keeping existing averages intact.

The included `sample-grades.csv` contains synthetic examples. The CSV header is exactly:

```csv
year,subject,title,earned,possible,weight,date
2026-2027,Mathematics,Algebra quiz,16,20,1,2026-10-01
2026-2027,Mathematics,Term exam,72,100,3,2026-12-10
```

Use UTF-8 text, `YYYY-YYYY` academic years, ISO `YYYY-MM-DD` dates, and decimal points for numbers. `possible` and `weight` must be positive; `earned` must be between zero and `possible`. School imports belong to the signed-in student; guest imports remain in that browser. There is no student ID or owner column.

School imports append validated rows and skip exact duplicates, so importing the same file twice does not silently double the average. The result reports imported and skipped counts. See [the CSV guide](docs/grades-and-csv.md) for details.

For each subject and year:

```text
percentage = 100 × sum((earned / possible) × weight) / sum(weight)
```

For new manual grades, each weight is `1`, so `16/20` and `72/100` average **76%**. Existing or imported records can retain other weights: those same scores with weights `1` and `3` give **74%**. The CSV `weight` column is retained for backup compatibility and authorized imports. The starter does not implement category weighting, grading curves, dropped assignments, or a school's special rounding rules. Predictions are estimates using the saved grades and equally counted new simulations.

## Connect official school sign-in

Ask the school's IT administrator to register an OIDC web application and assign the students who may use it. You cannot obtain this access from a student's password.

For school **Microsoft 365 / Teams accounts**, follow [the Microsoft Entra setup guide](docs/microsoft-365.md). It explains the school tenant registration, student assignment, minimal sign-in permissions, and private server configuration. No browser or Teams extension is needed.

Configure these server-side values in `.env` locally or your hosting platform's secret/configuration store:

```dotenv
DEBUG=False
ALLOW_DEMO_LOGIN=False
SECRET_KEY=<new-long-random-production-secret>
APP_BASE_URL=https://grades.school.example
ALLOWED_HOSTS=grades.school.example
CSRF_TRUSTED_ORIGINS=https://grades.school.example
OIDC_PROVIDER=generic
OIDC_ISSUER_URL=https://identity.school.example/exact-school-issuer
OIDC_CLIENT_ID=<registered-client-id>
OIDC_CLIENT_SECRET=<registered-client-secret>
OIDC_REDIRECT_URI=https://grades.school.example/auth/callback/
```

The domains above are examples. Replace them with the exact values provided by IT. Register the callback **exactly**, including the trailing slash. Use a school-specific tenant/issuer, never a multi-tenant or user-selected issuer. Application assignment at the identity provider controls which school accounts can enter; an email suffix is not an authorization rule.

The app uses authorization code sign-in, `openid profile` scopes, and a confidential server-side client. It stores a local student identity based on the validated issuer and subject, rather than matching accounts by email. Sign-out ends this app's session; the school identity provider may remain signed in.

If the school only offers SAML, IT can use an approved SAML-to-OIDC broker and configure this app against its OIDC issuer. A direct SAML service provider is not included. See [identity setup](docs/school-sso.md).

## Put the code on GitHub

Copy this project's contents into your chosen repository, preserving hidden files such as `.github/` and `.gitignore`. Review the changes before committing. Keep `.env`, databases, exports, credentials, and real grades out of Git.

The test workflow runs tests, migration checks, and a dependency audit on pushes and pull requests. A separate manual workflow can publish only the guest app. Enable branch protection and dependency updates to suit your repository.

GitHub stores and reviews the source code. [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and can run the standalone guest app. School sign-in and saved account records require the Django backend and a persistent database on an approved host; Pages cannot run that backend or keep SSO secrets.

For editing and checks in GitHub's browser editor, see [the Codespaces instructions](docs/codespaces.md). Guest mode can use a static preview. The seeded Django demo account is restricted to loopback; an online school-mode preview requires approved OIDC and production settings.

## Creator privacy

The public app can use a project name without displaying its creator's personal name. That does not guarantee anonymity from school IT, GitHub, the host, or the domain provider. School SSO is controlled by the school, and its administrators can inspect sign-in activity. The operator's identity and contact details may be needed privately for approval and support.

Before publishing commits, enable GitHub email privacy and use the exact GitHub-provided `noreply` address from your account settings. This protects your personal commit email in future commits; it does not hide the GitHub account or remove information in existing history. See [GitHub's commit-email instructions](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address) and [the privacy boundaries in SECURITY.md](SECURITY.md).

## Deploy a shared link

For a guest link, use [GitHub Pages](docs/github-pages.md). For school mode, follow [the deployment guide](docs/deployment.md) for the included Gunicorn Docker image, persistent storage, HTTPS, proxy settings, and production checks. Configure school SSO before inviting account users. The school app's shared link is its deployed HTTPS `APP_BASE_URL`, not the repository URL.

Use [Django's deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) and test with two school-approved test students before importing real records. Security controls in the app do not prevent a hosting/database administrator from accessing stored records. See [SECURITY.md](SECURITY.md) for boundaries and operational responsibilities.

## Check the project

The guest tests need Node.js (for development checks only): `node --test tests/guest.test.cjs`. The guest website itself needs only a browser.

With the local environment configured:

```powershell
.\.venv\Scripts\python.exe manage.py test
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py check
```

After configuring production settings, also run `manage.py check --deploy`. Passing these checks does not verify your school's provider, network, or legal/data-policy requirements.

## Official grade integration

No school-specific connector is included. If the school provides an authorized API, follow [the integration extension guide](docs/authorized-integration.md). Keep CSV/manual entry available until that integration is reviewed and tested. Do not add a portal password form, browser automation, arbitrary API-URL field, or token-paste box for students.

Licensed under the [MIT License](LICENSE).
