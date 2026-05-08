# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project loosely follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are in `YYYY-MM-DD`.

## [Unreleased]

### Added
- `CONTRIBUTING.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, and `tests/README.md`.
- Per-method JSDoc across `coreLogic.js`, `twitter-task.js`, `model/data.js`, and the `lib/*` modules.
- File header on `index.js` documenting the IPC event → `coreLogic` method mapping.
- Annotated `.env.sample` with the optional `COOKIE_ENCRYPTION_KEY` and `LOG_LEVEL` variables.
- Expanded `adapters/twitter/README.md` with the module-split overview.

### Notes
- This release is documentation-only; no code paths changed.

## [2.0.0] — 2025-04-07

### Changed
- **Breaking refactor**: split the monolithic `adapters/twitter/twitter.js` into focused modules (`session.js`, `crawler.js`, `commenter.js`, `verifier.js`, `utils.js`). Public API on the `Twitter` class is unchanged.
- Switched ad-hoc `console.log` calls to a structured pino logger (`lib/logger.js`).
- Introduced typed error classes in `lib/errors.js` (`TwitterAuthError`, `RateLimitError`, `NetworkError`, `BrowserError`, `ValidationError`).
- Cookie storage now uses AES-256-GCM via `lib/crypto.js` with the `COOKIE_ENCRYPTION_KEY` env var. Legacy plaintext cookies are still readable for one boot.
- Retry behaviour centralised in `lib/retry.js` (`withRetry` with exponential backoff + jitter).

### Added
- `prod-debug.js` workflow (`yarn prod-debug`) — watches local changes, rebuilds, and copies the bundle into the Desktop Node runtime folder for live debugging.
- README expanded with overview, architecture, prerequisites, and key concepts.

## [1.x] — earlier history

Earlier work tracked the `@JDVance` target account, fixed audit/submission flows, and shipped the initial `update the task` series of changes. See the git log (`git log --before=2025-04-07 --oneline`) for details.

[Unreleased]: https://github.com/MadanChaollaPark/KeepCryptoClean/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/MadanChaollaPark/KeepCryptoClean/releases/tag/v2.0.0
