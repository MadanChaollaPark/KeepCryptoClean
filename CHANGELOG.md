# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Remote history remediation and credential/session rotation remain an operator
  action; see `SECURITY.md`.
- Promotion from Koii `TEST` to `PRODUCTION` remains gated by the release
  checklist and a separate reviewed configuration change.
- Live Koii chain/storage viability, distributed X authentication, X
  tracking/surveillance approval, immutable redistribution, and historical
  credential rotation remain external release blockers.

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
- Embedded the consensus target into the executable and bound each proof CID
  to the Koii submitter key supplied by the audit callback.
- Patched task-manager 1.0.14 fail-open audit/distribution defaults, removed its
  state disclosure route, and serialized/caught lifecycle dispatch.
- Defined the rewarded unit as exactly one live Post-ID/target-author
  attestation, without a timeline completeness, novelty, or freshness claim.
- Bounded and fail-closed Task-Node/storage RPCs, restricted storage to the SDK
  HTTPS trust set, verified uploads by byte-for-byte read-back, and froze each
  round's payload/quota digest.
- Removed the unsupported KPL/WASM decoder from the KOII-only executable so no
  runtime path depends on missing binary sidecars.
- Updated canonical repository URLs, author, MIT license, task name, metadata,
  KOII bounty configuration, and Koii `TEST` environment.

### Added

- Node 22 reference runtime, pinned Yarn 1.22.22, frozen lockfile install, and a
  verified single-file production bundle.
- Patched transitive resolutions that remove all high/critical production audit
  findings, plus a time-bounded register for remaining upstream findings.
- Offline unit/validation coverage, strict preflight, artifact verification,
  repository hygiene/secret guards, and full-toolchain advisory gating.
- GitHub Actions CI, CodeQL, dependency review, Dependabot, issue forms, and a
  pull-request checklist.
- Multi-stage non-root Docker image, localhost-only Compose service, dropped
  capabilities, read-only filesystem, and `/healthz` probe.
- Architecture, operations, release, security, and contribution runbooks.
- Bundled LGPL notice, full LGPLv3/GPLv3 texts, hash verification, and artifact
  attribution.
- Exact final-chunk license inventory, executable-payload digest binding, and a
  clean-source deterministic public-release rebuild gate.

### Removed

- The campaign/insult fallback corpus and its production build path.
- All dormant browser-writing source, credential/session helpers, and obsolete
  live-browser scratch tests.
- Stale Redis/Koii container wiring, missing bind mounts, obsolete direct
  dependencies, and scripts that installed floating CLI versions.
- Browser credentials as production task requirements.
- The vulnerable deployment CLI dependency; deployment is a separately pinned
  and audited operator action.

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
