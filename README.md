# KeepCryptoClean

KeepCryptoClean is a Koii task for collecting and auditing verifiable,
read-only public-interest observations from X through the official X API. Its
public proof contains only policy-permitted Post IDs, User IDs, and Koii task
metadata—never post text or a text-derived hash. The
original project automated replies through a browser. Version 3 removes that
campaign behavior from the production profile and defaults to observation with
no posting capability configured.

The repository is a production candidate, but it is deliberately configured as
a Koii `TEST` task until the testnet gates in [docs/RELEASE.md](docs/RELEASE.md)
are completed. No live task, bounty, or token deployment is implied by this
source tree.

## Safety model

- With no credentials, collection fails closed.
- Normal operation needs only `X_API_BEARER_TOKEN` for read-only API requests.
- The task contains no X write credential or posting/reply path.
- Docker and `config-task.yml` accept only a read-only bearer token and one
  immutable target User ID.
- Production dependencies and bundles exclude browser automation and the old
  campaign fallback corpus.
- Full X API responses are transient; public IPFS proofs contain only Post IDs,
  User IDs, and task metadata permitted for redistribution.

X currently prohibits non-API automation such as scripting its website. Review
the [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
and [X Developer Policy](https://docs.x.com/developer-terms/policy) before
operation. Before any deployment, an operator must obtain written X approval
that explicitly covers this rewarded, distributed Koii use case, public
recipients, and immutable IPFS publication of Post/User IDs; redistribution
compliance cannot be assumed from the code. If approval or policy changes, halt
collection before creating more immutable proofs. See
[PRIVACY.md](PRIVACY.md).

## How a round works

```text
official X API -> transient validation -> ID-only IPFS proof -> Koii submission
                                                             |
Koii reward distribution <- deterministic audit and voting <-+
```

1. **Execute:** fetch eligible public data through the official API, validate it
   transiently, and retain only permitted Post/User IDs for the round.
2. **Submit:** upload the ID-only proof envelope to IPFS and submit its CID.
3. **Audit:** retrieve peer evidence and verify its schema, identity bindings,
   round, configured target User ID, permitted ID fields, and fresh API source.
4. **Distribute:** deterministically allocate the configured round bounty only
   among submissions that passed consensus.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries and data
flow.

## Requirements

- Node.js `>=18.17.0`; Node 22 LTS is the production reference.
- Yarn `1.22.22`, pinned through the `packageManager` field.
- An official X API bearer token with the minimum read-only access required.
- One numeric `X_TARGET_USER_ID`, frozen identically across every node because
  it is a consensus input.
- A Koii test task/runner for lifecycle and consensus validation.

## Local setup

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
cp .env.sample .env
```

Set `X_API_BEARER_TOKEN` and `X_TARGET_USER_ID` in `.env`, then run:

```bash
yarn preflight:strict
yarn test:ci
yarn start
```

The namespace wrapper exposes a local status service on
`http://127.0.0.1:3000` by default. Do not publish it to the internet.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `X_API_BEARER_TOKEN` | unset | Read-only official X API access. |
| `X_TARGET_USER_ID` | unset | One numeric, consensus-critical User ID; identical on every node. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `EXPRESS_PORT` | `3000` | Local namespace-wrapper status port. |

There are no write-mode variables. Never place secrets in `config-task.yml`, a
Docker image, logs, issues, or the task executable.

## Commands

| Command | Purpose |
| --- | --- |
| `yarn test` | Run offline unit tests. |
| `yarn lint` | Lint the tracked JavaScript with zero warnings allowed. |
| `yarn build` | Build the single-file `dist/main.js` Koii executable. |
| `yarn test:ci` | Lint, unit test, build, verify the artifact, and check repository hygiene. |
| `yarn audit:production` | Fail on critical production dependency advisories. |
| `yarn preflight` | Validate versions, metadata, URLs, and safe-mode configuration. |
| `yarn preflight:strict` | Also require read-only API credentials. |

## Docker

The local container builds the same executable, runs as the unprivileged
`node` user, drops Linux capabilities, mounts only a runtime volume, binds the
status port to localhost, and has a health check.

```bash
docker compose config --quiet
docker compose up --build
docker compose ps
```

This is a local smoke/observer environment. A Koii chain participant must run
the reviewed `dist/main.js` under the supported Koii task runner; do not treat
the Compose service as a replacement for testnet validation.

## Koii release

`config-task.yml` follows the current Koii task template shape and remains on
`environment: 'TEST'`. Build and inspect the artifact before invoking the
create-task CLI:

```bash
yarn test:ci
yarn preflight:strict
yarn deploy
```

`yarn deploy` is interactive and can create or update remote Koii state. Run it
only after completing [docs/RELEASE.md](docs/RELEASE.md), confirming funding,
task ID, environment, and rollback ownership. The code does not deploy itself.

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
- [Security policy](SECURITY.md)
- [Privacy policy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) — Copyright (c) 2024–2026 Madan C. Park, Pranav Mahindru, and
contributors.
