# KeepCryptoClean

KeepCryptoClean is a Koii task for collecting and auditing one verifiable,
read-only X Post existence/author attestation per round through the official X
API. Its public proof contains only policy-permitted Post IDs, User IDs, and
Koii task metadata—never post text or a text-derived hash. The
original project automated replies through a browser. Version 3 removes that
campaign behavior from the production profile and defaults to observation with
no posting capability configured.

The repository is a production candidate, but it is deliberately configured as
a Koii `TEST` task until the testnet gates in [docs/RELEASE.md](docs/RELEASE.md)
are completed. No live task, bounty, or token deployment is implied by this
source tree.

## Project history and contributors

KeepCryptoClean continues the collaborative project developed in 2024. The
preserved Git history includes the earlier repository name **SecretProject**
in [merge commits](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/98f20f52d331c68387d34aa89a82068be2c47dbe)
and the README title **Asshole in Chief Project** in the
[August 2024 documentation](https://github.com/MadanChaollaPark/KeepCryptoClean/blob/e6c4dd6746c1b83aa24b3a02ad915e0d177e993e/README.md).
The [initial README](https://github.com/MadanChaollaPark/KeepCryptoClean/blob/d47610ea32738bc4c767eabb8f84d4f1fcb37019/README.md)
used the Koii Simple Crawler template name. These are earlier stages of the
same project, whose original browser-based reply automation has since been
replaced by the read-only API design described above.

The history records contributions from:

- **[Madan Chaolla Park](https://github.com/MadanChaollaPark):** project
  adaptation and documentation, followed by
  [modular refactoring and error handling](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/ca1c44e769eeaa184723646482304841c69e40ac)
  and the later
  [read-only X API adapter](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/a712f742d9e2c468b4ade47509f95c3b6ee66a75).
- **[Pranav Mahindru](https://github.com/pmahindru):** task integration,
  [submission and audit fixes, refactoring, and round/audit tests](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/1f6ef41144ec3707b1797bd98dab1129cb0c0d63),
  along with branch and pull-request integration.
- **[Laura Abro](https://github.com/labrocadabro):**
  [debugging tooling, build support, and audit-test changes](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/47fd4541da89884151e8d921efc681c5b0c28d8e),
  integrated through a
  [preserved pull-request merge](https://github.com/MadanChaollaPark/KeepCryptoClean/commit/db86441c412ecd1b2793c52824fa5fa4df66156f).

See the [full commit history](https://github.com/MadanChaollaPark/KeepCryptoClean/commits/main/)
for attribution and the [changelog](CHANGELOG.md) for subsequent changes.
Historical collaboration and the current candidate's release status are
separate: the current version still requires the validation described in
[the release checklist](docs/RELEASE.md).

## Safety model

- With no credentials, collection fails closed.
- Normal operation needs only `X_API_BEARER_TOKEN` for read-only API requests.
- The task contains no X write credential or posting/reply path.
- The runtime accepts only a read-only bearer token. The target User ID is
  embedded in the reviewed executable and cannot vary by node.
- Production dependencies and bundles exclude browser automation and the old
  campaign fallback corpus.
- Full X API responses are transient; public IPFS proofs contain only Post IDs,
  User IDs, and task metadata permitted for redistribution.
- The rewarded unit is exactly one live Post-ID/author binding. It does not
  claim timeline completeness, novelty, or wall-clock freshness; the same
  still-public Post may be observed again in a later round.
- A proof does not prove that its producer performed the timeline request. Any
  node that already knows a still-live target Post ID can construct a valid
  current-round envelope, and that same ID can earn again. Production requires
  an explicit product/economic decision that this liveness-only objective is
  worth rewarding, or a redesigned objective with independently verifiable
  work.
- Storage responses are streamed with hard byte/time limits, uploads are read
  back byte-for-byte, and only an exact pinned HTTPS trust set is used.

X currently prohibits non-API automation such as scripting its website. Review
the [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
and [X Developer Policy](https://docs.x.com/developer-terms/policy) before
operation. Before any deployment, an operator must obtain written X approval
that explicitly covers this rewarded, distributed Koii use case, public
recipients, immutable IPFS publication of Post/User IDs, X's downstream-
recipient terms, and deletion/modification obligations. The default public,
replicated IPFS model cannot guarantee deletion, so redistribution compliance
cannot be assumed from the code. If approval or policy changes, halt collection
before creating more immutable proofs. Because the task repeatedly observes one
account and requires independent nodes to authenticate to X, approval must also
resolve X's surveillance/tracking restrictions and its prohibition on making
end users register API applications for a service. A consented/owned target does
not by itself resolve the distributed-credential or immutable-data issues. See
[PRIVACY.md](PRIVACY.md).

> **Current upstream blocker (verified 2026-07-13):** the pinned Koii storage,
> testnet, and mainnet hostnames all resolved to the same parking address and
> failed TLS. Do not deploy until Koii restores independently verifiable network
> and storage endpoints and the full test lifecycle passes on at least two
> nodes.

## How a round works

```text
official X API -> transient validation -> ID-only IPFS proof -> Koii submission
                                                             |
Koii reward distribution <- live API audit and peer voting <-+
```

1. **Execute:** fetch a bounded public timeline response through the official
   API, validate it transiently, and freeze exactly one Post/User-ID attestation
   for the round.
2. **Submit:** upload the ID-only proof envelope to IPFS and submit its CID.
3. **Audit:** retrieve peer evidence and verify its schema, identity bindings,
   round, configured target User ID, permitted ID fields, live Post existence,
   and target-author binding through the official API.
4. **Distribute:** deterministically allocate the configured round bounty only
   among submissions that passed consensus.

The audit confirms live existence and authorship at audit time. It cannot prove
that the submitting node made the earlier timeline request.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries and data
flow.

## Requirements

- Node.js `>=22.22.0` and `<23`.
- Yarn `1.22.22`, pinned through the `packageManager` field.
- An official X API bearer token with the minimum read-only access required.
- One numeric `KCC_TARGET_USER_ID`, supplied only when building; changing this
  consensus input requires a new executable and reviewed task migration.
- A Koii test task/runner for lifecycle and consensus validation.

## Local setup

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
cp .env.sample .env
```

Set `X_API_BEARER_TOKEN` in `.env`. The build launcher deliberately does not
read `.env`; export the reviewed public target so source mode and the composite
test command use the same value and the build receives it explicitly:

```bash
export KCC_TARGET_USER_ID=1234567890  # replace with the reviewed target
yarn preflight:strict
yarn test:ci
yarn start
```

The namespace wrapper exposes a local status service on
`http://127.0.0.1:3000` by default. Do not publish it to the internet.

## Configuration

| Variable             | Default | Purpose                                                                        |
| -------------------- | ------- | ------------------------------------------------------------------------------ |
| `X_API_BEARER_TOKEN` | unset   | Read-only official X API access.                                               |
| `KCC_TARGET_USER_ID` | unset   | Build-only numeric User ID embedded in `dist/main.js`; not a runtime override. |
| `KCC_RELEASE_COMMIT` | unset   | Build-only 40-character source commit recorded in release notices.             |
| `LOG_LEVEL`          | `info`  | Pino log level.                                                                |

There are no write-mode variables. Never place secrets in `config-task.yml`, a
Docker image, logs, issues, or the task executable.

## Commands

| Command                                   | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `yarn test`                               | Run offline unit tests.                                                     |
| `yarn lint`                               | Lint the tracked JavaScript with zero warnings allowed.                     |
| `yarn build --public-target-user-id <id>` | Build `dist/main.js` with an explicit public consensus target.              |
| `yarn test:ci`                            | Preflight, lint, test, build, license/artifact smoke, and hygiene gates.    |
| `yarn verify:licenses`                    | Verify bundled copyleft notices and the exact permitted package/version.    |
| `yarn verify:licenses:release`            | Fail unless release provenance and every authoritative notice are complete. |
| `yarn audit:production`                   | Gate advisories against the reviewed, expiring exception register.          |
| `yarn audit:all`                          | Apply the same gate to the full build toolchain.                            |
| `yarn preflight`                          | Validate versions, metadata, URLs, and safe-mode configuration.             |
| `yarn preflight:strict`                   | Also require read-only API credentials.                                     |

## Docker

The local container builds the same executable, runs as the unprivileged
`node` user, drops Linux capabilities, mounts only a runtime volume, binds the
status port to localhost, and has a health check.

```bash
export KCC_TARGET_USER_ID=1234567890  # replace with the reviewed target
export KCC_RELEASE_COMMIT="$(git rev-parse HEAD)"
docker compose config --quiet
docker compose up --build
docker compose ps
```

This is a local smoke/observer environment. A Koii chain participant must run
the reviewed `dist/main.js` under the supported Koii task runner; do not treat
the Compose service as a replacement for testnet validation.

## Koii release

`config-task.yml` follows the current Koii task template shape and remains on
`environment: 'TEST'`. Build and inspect the artifact before any remote tool is
introduced:

```bash
export KCC_TARGET_USER_ID=1234567890  # replace with the reviewed target
export KCC_RELEASE_COMMIT="$(git rev-parse HEAD)"
yarn test:ci
yarn preflight:strict
yarn audit:all
yarn verify:licenses:release
```

The strict license command intentionally fails for the current candidate: the
three exact Koii packages listed in `THIRD_PARTY_NOTICES.md` do not contain
publisher-authenticated full license notices. Do not distribute the executable
until corrected upstream packages/notices or an explicit legal exception closes
that gate.

The repository intentionally does not bundle a deployment CLI: the previously
used CLI dependency brought unresolved high/critical build-tool advisories.
After completing [docs/RELEASE.md](docs/RELEASE.md), use the then-current
official Koii deployment surface in a separate, pinned, audited environment and
confirm funding, task ID, environment, and rollback ownership immediately
before the remote action. The code does not deploy itself.

Useful upstream references:

- [Koii task template](https://github.com/koii-network/task-template)
- [Koii developer documentation](https://www.koii.network/docs)
- [GitHub supply-chain security](https://docs.github.com/en/code-security/supply-chain-security)

## Security history

An earlier commit exposed Chromium profile artifacts in public Git history.
Deleting them in a later commit did not erase the old objects. Treat every
credential and session that ever entered the repository as compromised: rotate
credentials, revoke sessions, and coordinate a separately authorized history
rewrite. See [SECURITY.md](SECURITY.md). This repository intentionally does not
rewrite or force-push remote history as part of a code release.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE.md)
- [Dependency advisory register](docs/DEPENDENCY_EXCEPTIONS.md)
- [Third-party notices and relinking information](THIRD_PARTY_NOTICES.md)
- [Security policy](SECURITY.md)
- [Privacy policy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) — Copyright (c) 2024–2026 Madan C. Park, Pranav Mahindru, and
contributors.
