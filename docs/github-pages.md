# Publish the guest dashboard with GitHub Pages

GitHub Pages can host **the browser-only guest dashboard** in `guest-site/`. It cannot run the full Django school-sign-in backend. The included publishing workflow uploads only `guest-site/`, containing the HTML, CSS, and JavaScript; it does not publish the project root, Python backend, `.env`, or database.

No site has been published by preparing these files. You decide when to run the workflow. These steps use [GitHub's official Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) capabilities.

## Publish for the first time

1. Put the starter's contents in your GitHub repository. Keep `guest-site/` and `.github/workflows/deploy-guest-pages.yml` at the repository root. Include hidden project files, but never upload `.env`, private exports, real grades, passwords, or secrets. Review the files before committing to the default branch.
2. Open the repository's **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**. GitHub Free supports Pages from public repositories; publishing from a private repository requires a qualifying plan, such as Pro, Team, or Enterprise. Check [GitHub's Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) for your account. Do not change repository visibility automatically: a public repository exposes its code, GitHub handle, and commit metadata, and a Pages site may be public even when its source repository is private.
3. Open **Actions → Publish guest dashboard to GitHub Pages**. Choose **Run workflow**, select the intended branch, and confirm **Run workflow**. The workflow file must be present on the default branch for this manual button to appear.
4. Wait for the workflow to succeed. Open its deployment link, or return to **Settings → Pages** for the published address. A project site usually looks like `https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/`.
5. Open that link in a fresh browser profile. Add a synthetic grade, import/export a sample CSV, and try a prediction. Verify that the checkbox **Remember grades on this browser** is initially unchecked. Share the link after checking its behavior.

The workflow does not deploy on ordinary pushes or pull requests. To publish an update, review and commit the change, then run it again. Its token has only the repository read permission and Pages deployment permissions needed by the official actions. You do not need to create a personal access token or add any school/client secrets.

Keep the artifact path `guest-site`. Do not change it to `.` or the repository root: Pages serves the uploaded files publicly. Put no private information inside `guest-site/`. If you already use Pages for another site in the repository, this workflow would replace that site's deployment; review the destination before running it.

## Guest data behavior

Guest mode needs no school account. Grades stay in JavaScript memory by default and disappear when the page is reloaded or closed. **Remember grades on this browser** is an explicit opt-in to storing them in that browser's local storage. Leave it unchecked on a shared school/library computer. Anyone with access to that browser profile may see remembered records; this storage is not encrypted or an account backup. **Clear all guest data** clears the app's guest memory and its saved local copy after confirmation. Keep a private CSV export if you need a backup. Live guest grades are never committed to the repository by this app.

The supplied guest app makes no backend grade requests and includes no analytics, ads, or CDN dependencies. Hosting providers can still receive normal web requests and connection information. Public branding and guest mode do not guarantee anonymity from GitHub, a host, a network operator, or school IT. A school can block a site through its normal web policy; this project provides no bypass.

Guest records and school-account records are separate. Browser storage is also specific to the browser profile and site origin, so another device or a different site address will not show the same guest workspace. Signing in never automatically uploads, merges, or transfers guest data. To move grades deliberately, export a CSV from one mode and import it into the other. Review the file first.

## Optional school sign-in link

The standalone guest page initially has `data-school-login=""` on its `<body>`, which hides the school sign-in link. If a school-approved Django backend is actually deployed, set that attribute in `guest-site/index.html` to its fixed production HTTPS login address:

```html
<body data-school-login="https://grades.school.example/auth/login/">
```

Use the real trusted host and exact login route. Do not insert a client secret, issuer URL, token, or student-controlled redirect. The link opens the separate school application; GitHub Pages itself does not perform school SSO or synchronize records. Configure the backend through the [deployment](deployment.md) and [Microsoft 365](microsoft-365.md) guides.

## Troubleshooting

- **No Run workflow button:** commit the workflow file to the default branch and ensure Actions are permitted for the repository.
- **Pages deployment fails:** confirm Pages source is GitHub Actions and check any environment approval/branch rules. Follow the workflow's failure message without adding broad permissions or secrets.
- **The site is missing or shows the wrong files:** check the successful run's deployment link and confirm the artifact path is exactly `guest-site` with `index.html` directly inside it.
- **School sign-in is unavailable:** this is expected until a real backend is deployed and the optional trusted login link is configured.
- **Grades disappeared:** default guest storage is temporary; private browsing, browser cleanup, or clearing site data can also remove remembered records. Restore a CSV backup if you kept one.
