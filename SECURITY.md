# Security policy

## Supported versions

Only the latest commit on `main` and the most recent tagged major release are
eligible for security fixes. The 1.x/2.x browser-posting design is unsupported
and must not be deployed.

## Reporting

Do not open a public issue for vulnerabilities, exposed credentials, wallet
material, or personal data. Use a
[private GitHub Security Advisory](https://github.com/MadanChaollaPark/KeepCryptoClean/security/advisories/new).
Include the affected commit/version, sanitized reproduction, impact, and a safe
way to contact you. Do not upload live tokens or profile databases as evidence.

## Security boundaries

The task processes untrusted network data, peer-supplied CIDs, IPFS files, and
Koii submissions. It may hold an X bearer token and Koii runtime state. The
production profile therefore follows these rules:

- official X API reads only by default;
- no browser profile, password, cookie, or user token in the image or bundle;
- build-embedded target User ID plus round, node, schema, field, and size
  validation;
- deterministic distribution calculations;
- bounded network requests and fail-closed error handling;
- localhost-only diagnostics;
- an unprivileged, capability-free, read-only container filesystem;
- no secrets in logs, evidence payloads, metadata, CI, or task configuration;
- no post text, text-derived hash, source timestamp, username, DM, protected
  content, or media in an IPFS proof.

The rewarded task has no X write path. Do not add reply, posting, like, repost,
follow, DM, user-token, password, cookie, or website-scripting capability.

## Secrets

Use a token with the least privilege and shortest practical lifetime. Keep it
in the Koii runner's secret/task-variable facility or a local `.env` excluded
from Git. Never bake it into `dist/main.js` or a container layer.

Before release:

```bash
yarn check:repository
yarn verify:artifact
```

The repository guard rejects tracked environment files, browser profiles,
cookies, login databases, runtime databases, wallet/key files, private-key
markers, and common token formats. It is defense in depth, not a replacement
for GitHub secret scanning and push protection. Enable both in repository
settings.

## Known historical exposure

Commit `67af152e39e710f05573bc3f69725b7be4204bb4` added Chromium profile
artifacts, including files named Cookies, Login Data, History, Web Data, and
Sessions. A later deletion did not remove those objects from public Git
history.

Required incident response:

1. Rotate every possibly reused X password, API token, encryption key, wallet,
   and other credential associated with those profiles.
2. Revoke X and browser sessions from the relevant account security pages.
3. Preserve an incident record containing affected commits and rotations, but
   not the secrets themselves.
4. Coordinate a repository-wide `git filter-repo` rewrite with every
   collaborator and fork owner, then force-push all affected refs.
5. Ask the Git host to purge cached sensitive objects if its documented process
   requires a support request.
6. Re-clone rather than continuing from an old clone after the rewrite.

A history rewrite is destructive coordination work and is **not** authorized by
installing or releasing this code. It needs explicit owner approval, a backup,
collaborator notice, and a verified rotation log. Until that happens, assume
the historical material remains retrievable.

## Dependency and release controls

- `yarn.lock` is committed and CI uses `--frozen-lockfile`.
- Exact-pinned Koii dependencies are patched during install: task-manager
  1.0.14 removes fail-open audit/distribution defaults, route rewriting/state
  disclosure, and unhandled concurrent IPC; namespace-wrapper 1.0.23 bounds
  and fails closed on Task-Node RPC; storage-task-sdk 1.2.8 streams bounded
  responses and restricts this task to its maintained HTTPS trust set. The
  build refuses any unpatched version.
- Dependabot covers npm, GitHub Actions, and Docker.
- CI runs offline unit tests, lint, a production bundle check, a high-level
  production and full-toolchain audit, a container build, dependency review,
  and CodeQL.
- Release artifacts must be rebuilt from a clean checkout and compared with CI.
- Do not suppress an advisory without a documented exploitability analysis,
  owner, expiry date, and compensating control.

Current lower-severity upstream findings are tracked in
[docs/DEPENDENCY_EXCEPTIONS.md](docs/DEPENDENCY_EXCEPTIONS.md).

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for rotation, backup, monitoring,
and rollback procedures.
