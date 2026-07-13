# Release checklist

This checklist gates code release and Koii promotion. A green local build alone
does not prove production readiness.

## Source and supply chain

- [ ] Release commit is reviewed and the worktree is clean.
- [ ] Canonical repository URLs, MIT license, package version, metadata, and
      changelog agree.
- [ ] `yarn install --frozen-lockfile` succeeds on Node 22 LTS.
- [ ] `yarn test:ci` succeeds from a clean checkout.
- [ ] `yarn audit:production` has no high/critical finding; every lower
      unresolved advisory has an owner and written exploitability decision.
- [ ] CodeQL and dependency review pass.
- [ ] GitHub secret scanning and push protection are enabled.
- [ ] The historical Chromium-profile incident has a rotation status and an
      explicitly scheduled or completed history-remediation decision.

## Artifact and container

- [ ] `dist/main.js` is the only JavaScript executable in `dist`.
- [ ] Artifact SHA-256 is recorded and matches CI output.
- [ ] Artifact contains no value from any local credential variable.
- [ ] Production artifact does not contain Puppeteer/Chromium runtime code or
      the deleted campaign corpus.
- [ ] `docker compose config --quiet` and the runtime image build pass.
- [ ] Container runs as `node`, with dropped capabilities and a read-only root.
- [ ] `/healthz` returns 200 without exposing task state or secrets.

## Functional test task

- [ ] `config-task.yml` is still `environment: 'TEST'`.
- [ ] A unique test task ID, funding source, executable CID, and metadata CID
      are recorded.
- [ ] One numeric `X_TARGET_USER_ID` is frozen in the test-task record and
      verified identical on every participating node.
- [ ] At least two independently configured nodes complete execute, submit,
      audit, and distribute phases.
- [ ] Missing token/target, API 401/403/429/5xx, timeout, malformed JSON, and
      oversized response all fail closed.
- [ ] Malformed CID/evidence, wrong schema, wrong round, wrong target User ID,
      wrong node, duplicates, and replay are rejected.
- [ ] A proof containing post text, text-derived hashes, source timestamps,
      usernames, media, DM data, protected content, or other unsupported fields
      is rejected.
- [ ] Valid evidence is accepted consistently by independent nodes.
- [ ] Distribution maps are byte-for-byte deterministic and never exceed the
      configured bounty.
- [ ] Process restart and dependency outage do not create duplicate evidence or
      implicit approvals.
- [ ] No X write occurs with default deployment variables.

## Promotion decision

- [ ] The exact read-only X API use has policy/legal/privacy review; no write
      credential, endpoint, or behavior exists.
- [ ] The operator has written X approval explicitly covering this rewarded,
      distributed Koii use case, public recipients, and immutable IPFS
      publication of Post/User IDs; redistribution limits are recorded.
- [ ] An operator-specific privacy policy and direct request contact are public.
- [ ] Production target, operators, monitoring, incident owner, and rollback
      owner are named.
- [ ] Stake, total bounty, per-round bounty, token type, and funding are approved.
- [ ] The exact remote action (new task or update), task ID, and environment are
      confirmed immediately before execution.
- [ ] Promotion is performed by an authorized operator and independently
      verified.

Only after all gates pass should a separate reviewed change switch
`environment` from `TEST` to `PRODUCTION`. Do not combine that change with
unrelated code changes.
