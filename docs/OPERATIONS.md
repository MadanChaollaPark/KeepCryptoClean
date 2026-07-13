# Operations runbook

## Before starting

1. Use a clean checkout at the reviewed commit.
2. Use Node 22 LTS and pinned Yarn 1.22.22.
3. Create a read-only X API token dedicated to this task.
4. Freeze one numeric target in `KCC_TARGET_USER_ID` before building. Verify it
   in the executable; do not provide a node-local target override.
5. Set `KCC_RELEASE_COMMIT` to the lowercase 40-character reviewed commit for a
   release-candidate build. The embedded notice must point to that exact source.
6. Store the token in the operator secret facility or local `.env`, never in
   Git, Docker build arguments, metadata, or shell history.
7. Run `yarn preflight:strict`, `yarn test:ci`, and
   `yarn audit:production`.
8. Verify every pinned Koii chain and storage hostname resolves to an
   organization-controlled endpoint with valid TLS and the expected protocol
   response. A parked domain, shared parking IP, or status-page claim without a
   successful direct probe is a hard stop.

## Local/Compose start

```bash
export KCC_TARGET_USER_ID=1234567890  # reviewed target, example only
export KCC_RELEASE_COMMIT="$(git rev-parse HEAD)"
docker compose config --quiet
docker compose up --build --detach
docker compose ps
curl --fail --silent http://127.0.0.1:${TASK_HTTP_PORT:-3000}/healthz
```

Expected state is `healthy`. The service must bind only to `127.0.0.1`. Inspect
sanitized logs with `docker compose logs --tail=200 observer`; never paste logs
without reviewing them for tokens and personal data.

## Koii test task

As of 2026-07-13, direct probes of the Koii mainnet, testnet, explorer, and the
three storage SDK hosts failed TLS after resolving to the same parking address.
Re-run and record DNS, TLS, and protocol-level checks before attempting any task
creation. Do not substitute an unreviewed public IPFS gateway at runtime.

1. Confirm `environment: 'TEST'` and an empty `task_id` for a new task.
2. Record the intended funding amount and owner approval.
3. Build `dist/main.js` in a clean checkout with the reviewed
   `KCC_TARGET_USER_ID`, then record its target and SHA-256 digest.
4. In a separate environment, pin and audit the then-current official Koii
   deployment tool/surface; do not add it to this repository's dependency
   graph. Run it interactively only after owner approval.
5. Record the resulting task ID, transaction, executable CID, metadata CID,
   config commit, and operator.
6. Test the complete execute/submit/audit/distribute lifecycle with at least two
   independent nodes as described in [RELEASE.md](RELEASE.md).

Never infer a task ID from an old config or update a remote task as a side effect
of a build.

## Monitoring

Monitor per round:

- process/container health and restart count;
- X API success, timeout, and rate-limit counts (without headers/tokens);
- proof count (exactly one ID for a submission) and bounded proof size;
- IPFS upload/fetch latency and failure rate;
- submissions accepted/rejected by reason;
- audit agreement and disagreement;
- distribution total versus configured bounty; and
- disk usage and stale namespace data.

Alert on repeated fail-closed rounds, divergent distribution maps, evidence
size growth, any unexpected non-read X request, token authentication errors,
or healthcheck failure.

## Credential rotation

1. Create a replacement least-privilege token.
2. Update the operator secret source without committing it.
3. Restart one test node and verify read-only observation.
4. Roll to remaining nodes.
5. Revoke the old token and record only its identifier/fingerprint and rotation
   time.

For suspected exposure, revoke first and investigate second. Follow the known
history incident steps in [SECURITY.md](../SECURITY.md).

## Backup and retention

ID-only proof envelopes are content-addressed on IPFS. The reference adapter
keeps at most 512 rounds of local observation/proof records and prunes older
rounds; its rolling quota keeps only the trailing 30-day reservations. Back up
only the minimum namespace state required by the Koii runner. Encrypt backups,
exclude secrets and browser data, and test restoration.

## Rollback

Code rollback and on-chain task migration are separate actions.

1. Stop promotion/new funding.
2. Disable or pause the affected remote task through the supported Koii control
   plane if owner authority exists.
3. Restore the last known-good reviewed executable/config; do not silently
   alter audit rules mid-round.
4. Verify its digest and run a test round.
5. Document impacted rounds, submissions, rewards, and operator actions.

Do not force-push Git history, rotate third-party credentials, update a remote
task, or move funds without explicit authority for that action.
