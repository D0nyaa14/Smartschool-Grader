# Verification at handoff

Verified locally on 17 October 2026 with Python 3.12, Django 5.2.18, Authlib 1.9.1, and Node.js:

- 47 Django tests pass. These cover student ownership for reads/writes/exports/deletion, CSRF, HTML escaping, CSV validation/atomicity/replay, calculations, equal-count manual entry and predictions, preservation of existing imported weights during edits, production guards, and guest/account separation.
- Authentication tests use a simulated school provider with real cryptographically signed ID tokens. They exercise PKCE S256, signature/issuer/audience/expiry/nonce validation, invalid state/replay, stable subject identity, and the Microsoft tenant configuration.
- 36 dependency-free Node tests pass for guest calculations, CSV parser/export, saved-data validation, cancellation races, storage-failure privacy messages, the tutorial, Excel report scope/downloads, ZIP checksums, spreadsheet formulas, chart references, safe text handling, and the winter-blue report palette.
- The locked runtime dependencies passed `pip-audit` with no known vulnerabilities at the time of this check. This is a point-in-time advisory check, not a security guarantee.
- Migration consistency and Django configuration checks pass. Production deployment checks report only the intentional HSTS subdomain/preload warnings described in the deployment guide.
- Browser checks covered local-demo sign-in, the account dashboard, account predictions, guest manual entry, guest predictions, guest CSV import, optional browser saving, and temporary data clearing on reload. Mobile layout was checked as well. Both dashboards include a short guide that students can close and reopen.

No real school credentials, tokens, or student records were used. All demonstration records are synthetic. The source archive excludes databases, secrets, generated static output, and temporary files.

## Published guest app

Commit [970b003](https://github.com/d0nyaa14/Smartschool-Grader/commit/970b00394b291e8aaffd850ea66e4f55ce66ad51) was pushed to `main`. [GitHub CI run 39036706412](https://github.com/d0nyaa14/Smartschool-Grader/actions/runs/39036706412) and [Pages deployment 39037326570](https://github.com/d0nyaa14/Smartschool-Grader/actions/runs/39037326570) succeeded.

The guest app is available at [Smartschool Grader](https://d0nyaa14.github.io/Smartschool-Grader/). Live browser checks verified a recorded `18/20` grade gives **90%**, and a hypothetical `16/20` assessment with weight `2` produces **83.33%** when combined with that grade at weight `1`. Only guest mode is published; school SSO and server account records are not hosted by Pages.

## Excel progress export

The guest export now distinguishes **Download Excel report** from **CSV backup**. The `.xlsx` report covers recorded grades for the selected school year, excluding simulator predictions, with **Overview** and **Progress** sheets, formula-based weighted subject averages, and native charts. Editing grade inputs affects that downloaded workbook only. CSV retains records across all school years and remains the supported import/restore format; XLSX edits are not synchronized or imported into the app.

The generated XLSX was independently opened with a spreadsheet reader, and every XML part and ZIP checksum was checked. Both sheets were imported into the bundled spreadsheet engine, recalculated, and rendered for visual inspection. A representative point change updated the linked subject average from 80% to 45%; date labels, percentage units, and chart positions were reviewed. A browser-generated download was also opened and checked. The app exports locally without sending grades to a server. Native desktop Excel UI validation has not been performed.

## Limits

No live school tenant or school grade API has been connected or tested. The Docker image could not be built in this environment because Docker is unavailable. The published guest deployment does not verify the school backend.

Re-run the included checks for new changes, and perform the deployment guide's school-approved test-account checks before using the backend with real students. The guest site can be evaluated independently with synthetic data.
