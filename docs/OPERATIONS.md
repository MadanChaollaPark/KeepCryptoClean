# Operations runbook

## Before starting

1. Use a clean checkout at the reviewed commit.
2. Use Node 22 LTS and pinned Yarn 1.22.22.
3. Create a read-only X API token dedicated to this task.
4. Freeze one numeric target in `X_TARGET_USER_ID`; configure the exact same ID
   on every node in the task deployment.
5. Store the token in the operator secret facility or local `.env`, never in
   Git, Docker build arguments, metadata, or shell history.
6. Run `yarn preflight:strict`, `yarn test:ci`, and
   `yarn audit:production`.

## Local/Compose start

```bash
docker compose config --quiet
docker compose up --build --detach
docker compose ps
curl --fail --silent http://127.0.0.1:${TASK_HTTP_PORT:-3000}/healthz
```

Expected state is `healthy`. The service must bind only to `127.0.0.1`. Inspect
sanitized logs with `docker compose logs --tail=200 observer`; never paste logs
without reviewing them for tokens and personal data.

## Koii test task

1. Confirm `environment: 'TEST'` and an empty `task_id` for a new task.
2. Record the intended funding amount and owner approval.
3. Build `dist/main.js` in a clean checkout and record its SHA-256 digest.
4. Run the current Koii create-task CLI interactively.
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
- permitted Post/User ID count and bounded proof size;
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

ID-only proof envelopes are content-addressed on IPFS; local runtime state is disposable except
where needed to prevent duplicate/replay submissions. Back up only the minimum
namespace state required by the Koii runner. Encrypt backups, exclude secrets
and browser data, test restoration, and define a short retention period.

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
