# Security

## Threat model

KeepCryptoClean automates a real Twitter/X account. That means the task node holds long-lived credentials (or at least a session) and can post on the user's behalf. Treat the running task with the same care you would any credential-bearing daemon.

## Credential handling

- **Use a dedicated volunteer account.** Never feed your primary X account into the task. If automation gets the account suspended — and X regularly suspends automated accounts — you should not lose anything you care about.
- **Credentials live only in `.env`.** They are loaded via `dotenv` at process start; they are not written to logs, the database, or any submission payload. Audit any change that adds a new log line near `process.env.TWITTER_*`.
- **Cookies are encrypted at rest.** After a successful login, the session cookies are encrypted with AES-256-GCM (`lib/crypto.js`) before being written to the local NeDB store. The key is read from `COOKIE_ENCRYPTION_KEY` (64 hex chars / 32 bytes). If the env var is missing the task generates an ephemeral key — stored cookies become unreadable across restarts and a fresh login is required each boot. For long-running deployments, set a stable key.

  ```bash
  # generate a key
  openssl rand -hex 32
  ```

- **Don't commit `.env`.** It's in `.gitignore`. If you ever do commit it by accident, rotate the credentials immediately.

## Network exposure

- The task starts an Express endpoint at `GET /taskState` (registered by the namespace wrapper in `index.js`). It returns the current task state and is intended for local diagnostics. **Do not expose this port to the public internet** — bind to localhost or behind authenticated reverse-proxy when running on a VPS.
- The task talks to a local middleware service at `http://localhost:3000/keywords` for the comment library. If unreachable it falls back to `couch_comments.json` in-tree. The middleware itself is out of scope for this repo.

## Reporting a vulnerability

Please **don't** open public GitHub issues for security-sensitive reports. Email the maintainer at the address listed on the GitHub profile of [@MadanChaollaPark](https://github.com/MadanChaollaPark), or open a private GitHub Security Advisory on this repo if available.

When reporting, please include:

- A description of the issue and the affected version / commit.
- Reproduction steps or proof-of-concept.
- Your assessment of impact (data exposure, account takeover, slashing, etc.).

You can expect an acknowledgement within a few business days.

## Dependency hygiene

- Run `yarn audit` periodically; the project pulls in puppeteer + chromium, so the dependency surface is non-trivial.
- Major version bumps for `@_koii/*` packages should be reviewed against the [Koii Network changelog](https://www.koii.network/docs) — task-runner contracts change occasionally.
