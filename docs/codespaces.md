# Use the project in GitHub Codespaces

You can edit the code and run its checks in a browser with GitHub Codespaces. No Python browser extension, Live Server extension, or Teams extension is required. The guest app uses static HTML/CSS/JavaScript; school SSO and account records require the Python backend.

## Open and check the project

Open the repository on GitHub, choose **Code → Codespaces → Create codespace** for the intended branch, and open its terminal. Work in the folder containing `manage.py`. Then run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/python manage.py test
```

The copied example is a local-development configuration. These commands do not expose a web server. Keep real records and credentials out of the repository. If you only want to try the synthetic dashboard, use the [README's local demo instructions](../README.md) on your own computer.

## Preview guest mode

From the project root, start a static server that exposes only the guest folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory guest-site
```

Open port 8000 from the Codespaces **Ports** panel and keep its visibility private. This is the separate guest app: it needs no school credentials or backend database and does not use the seeded demo account. Its grades stay in the browser. Stop the server when finished. For a shared guest link, follow [the manual GitHub Pages guide](github-pages.md).

## Why the demo button does not work at a forwarded URL

A Codespaces browser preview uses a remote address such as `https://YOUR-CODESPACE-8000.app.github.dev`. The Django starter's seeded demo account deliberately accepts only loopback hosts and loopback connections. It will reject that forwarded address even when `ALLOW_DEMO_LOGIN=True`. This restriction does not apply to the separate browser-only guest app above.

Do not remove the loopback check, use wildcard hosts, expose `DEBUG=True`, or enable password-free demo access to make the forwarded URL work. Keep preview ports private. A private forwarded port still uses an internet URL protected by GitHub authentication; that protection does not replace the app's school SSO or record ownership rules. See [GitHub's port forwarding guide](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace) and [Codespaces security](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces).

## School-approved browser preview

For an online preview, use the production configuration and official school OIDC with synthetic test records. A normal school-approved staging host following the [deployment guide](deployment.md) is preferable for a shared preview because a codespace stops and its URL can change when recreated.

If school IT explicitly approves a Codespaces preview:

1. Obtain the exact HTTPS forwarded origin from the **Ports** panel. Register that origin's `/auth/callback/` as a **Web** callback in a separate school-approved preview app registration. Never register a wildcard callback.
2. Set `DEBUG=False`, `ALLOW_DEMO_LOGIN=False`, the fixed `APP_BASE_URL`, exact `ALLOWED_HOSTS`, matching `CSRF_TRUSTED_ORIGINS`, and exact `OIDC_REDIRECT_URI`. Add the approved provider settings; for Microsoft 365 follow [the Entra guide](microsoft-365.md).
3. Store `SECRET_KEY` and `OIDC_CLIENT_SECRET` as restricted **Codespaces development environment secrets**, with access only to the intended repository. These differ from Actions secrets. Restart the codespace after adding them, and never print their values. See [GitHub's Codespaces secret instructions](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces).
4. Review HTTPS forwarding and the trusted-proxy boundary with the operator. Enable `TRUST_PROXY_HEADERS` only after verifying that the forwarding path strips/replaces the protocol header and direct untrusted access is blocked. Do not bypass an HTTPS redirect loop by enabling debug mode.
5. With those production settings in place, migrate, collect static files, and start the application server:

```sh
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py check --deploy
.venv/bin/gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 30
```

Keep the port private and use the exact registered HTTPS URL. Use only authorized test students. Do not run `seed_demo` in this configuration. Stop the preview and remove obsolete redirect registrations when finished. If the codespace URL changes, IT must approve/register the new callback and the environment values must be updated together.

This project does not automatically configure GitHub forwarding, an Entra registration, or a safe proxy boundary. If the approved preview conditions cannot be met, run the loopback demo locally or use a reviewed staging deployment.
