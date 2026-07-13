# Architecture

## Objective

KeepCryptoClean turns a bounded official-API observation into an ID-only proof
that independent Koii nodes can validate deterministically. It is not a general
X client, content archive, campaign bot, or browser automation service.

## Components

```text
X API client ──> transient validation ──> ID-only proof ──> IPFS
     ^                   |                    |              |
     |                   v                    v              v
allowlisted target   fail-closed gate    local namespace   peer fetch
                                               |              |
                                               v              v
                                         Koii task manager -> audit/vote
                                                              |
                                                              v
                                                    deterministic rewards
```

- `index.js` registers the application callbacks with
  `@_koii/task-manager` and exposes only health/status routes.
- `coreLogic.js` owns round execution, evidence submission, peer audit, and
  distribution logic.
- `twitter-task.js` (retained name for compatibility) constructs and validates
  round evidence.
- `adapters/twitter/` contains only the official read-only X API client/policy.
- `model/data.js` wraps namespace-scoped persistence.
- `lib/` contains cryptography, errors, retries, and structured logging.
- `webpack.config.js` creates one self-contained `dist/main.js` executable.

The current Koii template separates developer callbacks from lifecycle plumbing
through `@_koii/task-manager`. A task callback must not install a second IPC
listener or independently submit the same phase.

## Modes

### Observer (default)

The adapter requires `X_API_BEARER_TOKEN` and `X_TARGET_USER_ID`, makes
read-only official X API requests, validates the response transiently, and
produces no write action. Only policy-permitted Post IDs and User IDs cross into
the proof builder. Missing configuration, a target mismatch, malformed data, or
an API error produces no valid proof.

The target User ID is a consensus input, not a per-node preference. Every node
must use the same frozen numeric ID. A configuration mismatch invalidates the
round; the task must never fall back to a username or another account.

The adapter exposes no X write method and accepts no user access token,
password, cookie, or browser session.

## Round lifecycle

### Execute

The task manager passes a numeric round. Execution resolves the configured
target, fetches bounded public data, validates it in memory, discards content
fields, and stores only permitted IDs plus Koii task metadata for that round. It
must await every asynchronous Koii value before serializing it.

### Submit

The task serializes a versioned envelope with a canonical field order, uploads
it to IPFS, and returns the CID to the task manager. The envelope is limited to
Post IDs, User IDs, and non-X task metadata such as schema version, Koii round,
and submitter identity. It must contain no post text, text-derived hash, source
timestamp, username, media, DM/protected data, credential, cookie, request
header, local path, or unbounded source payload.

### Audit

Peer CIDs and files are untrusted. Validation applies limits before parsing and
then checks, at minimum:

- supported schema and mode;
- expected Koii round and submitting node;
- exact configured target User ID and Post/User source identifiers;
- an allowlist of permitted proof fields (unknown fields are rejected);
- duplicate/replay rules; and
- fresh official-source agreement when external validation is required.

Timeout, unavailable source, malformed evidence, identity mismatch, and any
exception are invalid outcomes, never implicit approval.

### Distribution

Distribution uses only the Koii candidate set, configured bounty, round, and
final audit results. Integer allocation and remainder behavior are deterministic
so every honest node derives the same map. The task manager owns upload,
selection, on-chain submission, and distribution audit plumbing.

## Trust boundaries

| Boundary | Untrusted input | Required control |
| --- | --- | --- |
| X API | JSON, IDs, text, timestamps, rate-limit responses | Transient validation, timeout, size/schema limits, exact target check, discard content fields |
| IPFS | CID and ID-only proof bytes | CID syntax, byte limit before JSON parse, strict allowed fields, schema/version, identity and round binding |
| Koii peers | submissions, public keys, votes | Wrapper-provided identity, deterministic validation, fail closed |
| Environment | tokens, target, feature flags | Exact modes, least privilege, redaction, no serialization |
| Local state | prior rounds and pending evidence | Namespace isolation, unique keys, bounded retention, atomic updates |
| HTTP status | unauthenticated local request | Health only, localhost binding, no secrets/task internals |

## Build and container boundary

The production bundle is a single file because `task_audit_program` points to
`dist/main.js`. Dynamic imports are folded into that executable. Environment
files are never bundled. Browser engines and the deleted campaign corpus are
excluded from dependencies and production builds.

The runtime image contains the executable and healthcheck only, runs as user
`node`, writes only to `/app/runtime`, and binds diagnostics to localhost in
Compose. The Compose service is a smoke/observer harness, not proof of Koii
testnet correctness.

## Operational invariants

- One configured observation target per task deployment.
- No production website scripting.
- No X content fields or derivatives in immutable storage; only redistribution-
  permitted Post/User IDs and Koii task metadata.
- Operator approval/disclosure for the exact X API use case is a deployment
  prerequisite; halt if policy or approval changes.
- No approval on validation errors.
- No floating install during CI or release.
- No remote task update without an explicit task ID, environment, funding, and
  rollback decision.
- No promotion from `TEST` to `PRODUCTION` until every release gate passes.
