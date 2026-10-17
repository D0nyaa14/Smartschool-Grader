# Help test or improve Gradebook

Try the [live app](https://d0nyaa14.github.io/Smartschool-Grader/) and open the [GitHub repository](https://github.com/D0nyaa14/Smartschool-Grader) to see or change its code.

## Report a problem

Use the repository's **Issues** tab. Include your browser/device, the steps to reproduce the problem, what you expected, and what happened. A screenshot with fictional grades can help.

Use synthetic data only. Never post school passwords, tokens, real student records, or private exports in issues, screenshots, or pull requests. Report security problems privately as explained in [SECURITY.md](SECURITY.md).

## Change the actual code

1. Sign in to GitHub and choose **Fork** on the repository to make your own copy. You do not need direct collaborator access to propose a change.
2. Create a branch in your fork, such as `fix-export-label`. Edit the real project files there. The guest page is `guest-site/index.html`; its styling and behavior are in `guest-site/assets/`.
3. Test with fictional grades. From the project root, run the guest and Excel-export tests with Node.js:

```sh
node --test tests/guest.test.cjs tests/excel-report.test.js
```

4. Commit your changes and open a **pull request** from your branch to this repository's `main` branch. Explain what changed, why, and how you tested it. For backend changes, also run the checks in [README.md](README.md).

The maintainer reviews the pull request before merging it. A merged change reaches the live site only after the maintainer runs the manual Pages publishing workflow. See [GitHub's contribution guide](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project) for help with forks and pull requests.

## Direct collaborator access

Direct access requires the correct GitHub username and an invitation granted by the repository owner. This guide does not send an invitation or grant access. Until the owner confirms it, use a fork and pull request.
