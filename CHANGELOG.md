# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Remote history remediation and credential/session rotation remain an operator
  action; see `SECURITY.md`.
- Promotion from Koii `TEST` to `PRODUCTION` remains gated by the release
  checklist and a separate reviewed configuration change.

## [3.0.0] - 2026-07-13

### Changed

- Reframed the task as a safe-by-default, official-X-API observation task.
- Removed all X write behavior and credentials; the rewarded task is strictly
  read-only.
- Removed legacy browser automation and browser tooling from the production
  dependency/runtime profile.
- Aligned lifecycle plumbing with `@_koii/task-manager` 1.0.14,
  `@_koii/namespace-wrapper` 1.0.23, and the current Koii template contract.
- Bound evidence validation to schema, target, source, round, and node identity;
  hardened size/time/replay checks and deterministic distribution handling.
- Updated canonical repository URLs, author, MIT license, task name, metadata,
  KOII bounty configuration, and Koii `TEST` environment.

### Added

- Node 22 reference runtime, pinned Yarn 1.22.22, frozen lockfile install, and a
  verified single-file production bundle.
- Patched transitive resolutions that remove all high/critical production audit
  findings, plus a time-bounded register for remaining upstream findings.
- Offline unit/validation coverage, strict preflight, artifact verification,
  and repository hygiene/secret guards.
- GitHub Actions CI, CodeQL, dependency review, Dependabot, issue forms, and a
  pull-request checklist.
- Multi-stage non-root Docker image, localhost-only Compose service, dropped
  capabilities, read-only filesystem, and `/healthz` probe.
- Architecture, operations, release, security, and contribution runbooks.

### Removed

- The campaign/insult fallback corpus and its production build path.
- Stale Redis/Koii container wiring, missing bind mounts, obsolete direct
  dependencies, and scripts that installed floating CLI versions.
- Browser credentials as production task requirements.

## [2.0.0] - 2025-04-07

### Changed

- Split the monolithic browser adapter into session, crawler, commenter,
  verifier, and utility modules.
- Introduced structured logging, typed errors, retry helpers, and encrypted
  legacy cookie storage.

## [1.x] - 2024

- Initial browser-posting Koii prototype and campaign variants.

[Unreleased]: https://github.com/MadanChaollaPark/KeepCryptoClean/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/MadanChaollaPark/KeepCryptoClean/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/MadanChaollaPark/KeepCryptoClean/releases/tag/v2.0.0
