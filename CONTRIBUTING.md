# Contributing

Thanks for your interest in KeepCryptoClean. This is a small project with a few moving pieces (a browser automation, a Koii task lifecycle, an IPFS upload, and an audit/voting flow), so a short orientation pays for itself.

Start with the [README](./README.md), then `docs/ARCHITECTURE.md` for a deeper dive into the round lifecycle.

## Setup

```bash
git clone https://github.com/MadanChaollaPark/KeepCryptoClean.git
cd KeepCryptoClean
yarn install
cp .env.sample .env   # then edit with a *volunteer* Twitter account
```

Node 16+ and Yarn are the only system requirements for development. For end-to-end testing on a real Koii node you'll also need the [Koii Desktop Node](https://www.koii.network) installed and the task registered.

## Running locally

| Command            | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `yarn start`       | Run the task entrypoint (`index.js`) directly. No Koii runner around it. |
| `yarn test`        | Single-round end-to-end smoke test. Hits the real X site.                |
| `yarn test:unit`   | Pure unit tests (no network, no browser).                                |
| `yarn webpack`     | Build the bundled task in development mode.                              |
| `yarn webpack:prod`| Build the bundled task in production mode.                               |
| `yarn lint`        | ESLint over the repo.                                                    |
| `yarn prod-debug`  | Watch + rebuild + copy bundle into the local Desktop Node runtime.       |

The smoke tests need the `TWITTER_*` env vars from `.env` — see `tests/README.md`.

## Code style

- ESLint is configured (`.eslintrc.cjs` / `eslint.config.cjs`); run `yarn lint` before opening a PR.
- Prettier defaults: 2-space indent, single quotes, trailing commas — see `.prettierrc`.
- Prefer the structured logger (`require('./lib/logger')`) over `console.log` so log output stays JSON-parseable.
- Throw the typed errors from `lib/errors.js` (e.g. `TwitterAuthError`, `BrowserError`) when the call site might want to branch on the failure mode.
- Keep DOM selectors centralised in `adapters/twitter/utils.js` `SELECTORS` so X UI changes only have to be patched in one place.

## Commits

- Small, focused commits are easier to review and easier to revert.
- Imperative mood (`Add foo`, `Fix bar`), capitalised first word.
- Prefix conventions are loose; recent history uses `Refactor: …`, `Docs: …`, `Add …`, `Fix …`. Pick what fits.
- Reference issue numbers in the body when relevant.

## Pull requests

1. Fork and branch off `main`.
2. Keep the diff scoped — one concern per PR. If you find unrelated cleanup along the way, send it as a separate PR.
3. Make sure `yarn lint` and `yarn test:unit` pass.
4. Describe what changed, why, and how you tested it.
5. Flag anything you couldn't test (e.g. live Twitter login from the audit harness).

## Reporting bugs / requesting features

Open an issue on [GitHub](https://github.com/MadanChaollaPark/KeepCryptoClean/issues). For security-sensitive reports, see [SECURITY.md](./SECURITY.md) instead.

## License

By contributing you agree your contributions are licensed under the project's MIT license — see [LICENSE](./LICENSE).
