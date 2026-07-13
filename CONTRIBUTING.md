# Contributing

KeepCryptoClean handles adversarial network data and consensus-visible output.
Small behavioral changes can affect rewards, slashing, API policy, or operator
credentials. Keep pull requests narrow and explain the trust-boundary impact.

## Setup

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
cp .env.sample .env
yarn test:ci
```

Node 22 LTS is the reference runtime; the package minimum remains Node 18.17 to
match the supported Koii template contract. Unit tests and CI must not need
network access or secrets.

## Required checks

```bash
yarn lint
yarn test:unit
yarn build
yarn verify:artifact
yarn check:repository
yarn audit:production
docker compose config --quiet
```

`yarn test:ci` combines the first five checks. Do not weaken, skip, or mark a
check `continue-on-error` merely to merge a change.

## Design rules

- Preserve the strictly read-only design; an X write path is out of scope.
- Parse untrusted data into a strict bounded schema before using it.
- Bind evidence to the expected target, round, node identity, and source ID.
- Use deterministic inputs for consensus and distribution logic.
- Return invalid on validation uncertainty; never approve because a dependency
  or network call failed.
- Use the structured logger and redact tokens, passwords, cookies, wallet data,
  request headers, and raw personal data.
- Add unit tests for success, malformed input, timeouts, replay, duplicates, and
  dependency failure.
- Do not add browser automation, X user access tokens, or any X write method.
- Never add a fallback corpus that can post campaign or harassment text.

## Network tests

Normal tests are offline. X integration tests must use the official read-only
API in an isolated test task, with a mocked transport in automated CI. No test
may post, reply, like, repost, follow, or send a DM.

## Koii changes

Changes to `config-task.yml`, lifecycle callbacks, audit rules, distribution
math, staking, bounty values, or package versions require:

1. an entry in `CHANGELOG.md`;
2. migration and rollback notes;
3. a Koii test-task run covering at least the release checklist; and
4. explicit confirmation of the task ID, environment, funding source, and
   operator before any remote update.

## Pull requests

Use the pull-request template. Include the reason, user-visible behavior,
threat-model change, test evidence, and anything not verified. Security reports
belong in a private advisory, as described in [SECURITY.md](SECURITY.md).

Contributions are licensed under the repository's [MIT license](LICENSE).
