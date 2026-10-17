# Start here

This project has **two free modes**. There are no ads, payments, trackers, or school passwords in it.

## The quickest version to share: guest mode

Guest mode needs no school approval for sign-in because it has no accounts. Students enter grades or import their own CSV and use the score simulator. A school's usual website restrictions can still apply.

1. Put this project's files in your GitHub repository, including `.github/`.
2. Follow [Publish guest mode](docs/github-pages.md).
3. Share the published website link with students. They do not need GitHub accounts or an extension.

Guest grades stay in the current tab unless the student explicitly chooses browser saving. Export a CSV to keep a backup. Saving on a shared computer is unsuitable because other people using that browser can see the records.

To try it before publishing, open a terminal in `guest-site/`, run `python -m http.server 8080 --bind 127.0.0.1`, and open <http://127.0.0.1:8080>. No Python packages are needed for this guest preview. Stop it with Ctrl+C.

## School sign-in and saved accounts

The full app adds a private server database and official school sign-in. Follow the [README](README.md) to try the local demo. School IT must supply the approved Microsoft tenant/app registration and access rules for real school accounts. See [Microsoft 365 setup](docs/microsoft-365.md).

The full backend needs Python hosting and a persistent database; GitHub Pages hosts only guest mode. Once the backend is deployed, the guest page can link to its sign-in page. Guest grades never upload automatically: moving them between modes requires deliberate CSV export/import.

## What is ready, and what is still needed

The source and setup guides are ready. The project has been tested locally; it has not been published, connected to a real school tenant, or connected to a grade API. See [verification details](docs/validation.md).

Your public app can use a project name, but the project cannot guarantee anonymity from the school, GitHub, or hosting providers. Keep your dad involved in decisions about hosting and real student data.
