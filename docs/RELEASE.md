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
- [ ] `yarn audit:all` has no high/critical finding in development or release
      tooling.
- [ ] CodeQL and dependency review pass.
- [ ] GitHub secret scanning and push protection are enabled.
- [ ] `yarn verify:licenses` passes for the candidate and
      `yarn verify:licenses:release` passes for public distribution;
      `THIRD_PARTY_NOTICES.md` and embedded
      artifact notices match the exact lockfile, and the vendored LGPLv3/GPLv3
      texts match their pinned hashes.
- [ ] `KCC_RELEASE_COMMIT` is the lowercase 40-character reviewed commit and
      the embedded Complete Corresponding Source link resolves to it.
- [ ] Publisher-authenticated full license notices or corrected releases exist
      for `@_koii/namespace-wrapper@1.0.23`,
      `@_koii/storage-task-sdk@1.2.8`, and
      `@_koii/task-manager@1.0.14`; evidence placeholders under
      `LICENSES/unresolved/` do not satisfy this gate. Any exception is explicit,
      version/hash/patch-set bound, and approved in writing by legal counsel.
- [ ] An operator/legal reviewer confirms LGPL-3.0-only compliance for the
      bundled `rpc-websockets` code, relinking/source offer, and Koii/IPFS
      distribution channel.
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
- [ ] Every pinned Koii chain, Task Node, explorer, and storage endpoint has
      valid DNS/TLS, returns the expected protocol response, and is not a
      parked domain or shared parking address. Record the dated evidence.
- [ ] A unique test task ID, funding source, executable CID, and metadata CID
      are recorded.
- [ ] One numeric `KCC_TARGET_USER_ID` is frozen in `dist/main.js`; the target
      and artifact digest are recorded and identical on every node.
- [ ] At least two independently configured nodes complete execute, submit,
      audit, and distribute phases.
- [ ] Missing token/build target, API 401/403/429/5xx, timeout, malformed JSON, and
      oversized response all fail closed.
- [ ] Malformed CID/evidence, wrong schema, wrong round, wrong target User ID,
      wrong node, duplicates, and replay are rejected.
- [ ] A proof containing post text, text-derived hashes, source timestamps,
      usernames, media, DM data, protected content, or other unsupported fields
      is rejected.
- [ ] Valid evidence is accepted consistently by independent nodes.
- [ ] Every accepted proof contains exactly one live Post ID authored by the
      embedded target; no test or operator describes it as a complete, novel,
      or time-fresh timeline snapshot.
- [ ] Product and reward owners explicitly accept that producer work is not
      provable: a known still-live target Post can be wrapped for the current
      round and the same Post can earn repeatedly. Otherwise redesign the
      objective before funding it.
- [ ] Distribution maps are byte-for-byte deterministic and never exceed the
      configured bounty.
- [ ] Process restart and dependency outage do not create duplicate evidence or
      implicit approvals.
- [ ] No X write occurs with default deployment variables.
- [ ] `/taskState` returns 404; only `/healthz` and the non-sensitive `/readyz`
      are registered by the task.

## Promotion decision

- [ ] The exact read-only X API use has policy/legal/privacy review; no write
      credential, endpoint, or behavior exists.
- [ ] Written X approval explicitly permits repeated observation of the exact
      target/use under X's surveillance and user-tracking restrictions.
- [ ] Written X approval or an approved architecture resolves distributed-node
      authentication without sharing an app credential or requiring anonymous
      node operators to register overlapping X applications.
- [ ] The operator has written X approval explicitly covering this rewarded,
      distributed Koii use case, public recipients, and immutable IPFS
      publication of Post/User IDs; redistribution limits, downstream-recipient
      terms, and deletion/modification obligations are explicitly resolved.
- [ ] The official Koii deployment tool used for promotion is pinned and
      audited in an isolated environment; it is not added to this repository.
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
