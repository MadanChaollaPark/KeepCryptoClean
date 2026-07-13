# Tests

`tests/unit/` contains deterministic tests that do not need X, IPFS, Koii
testnet, a browser, or credentials.

```bash
yarn test
yarn test:ci
```

CI runs only offline tests. X responses and Koii wrapper behavior must be
injected or mocked when adding coverage. Network/browser scratch scripts from
the pre-3.0 prototype are unsupported and have no package command; they must be
removed rather than revived.

New behavior should cover:

- valid canonical ID-only proofs;
- missing/malformed/oversized API and IPFS data;
- wrong target User ID, round, node, and Post/User IDs;
- unknown proof fields, duplicates, and replay submissions;
- timeout, rate limit, authentication failure, and dependency outage;
- deterministic distribution including integer remainder behavior;
- identical `X_TARGET_USER_ID` across independent nodes; and
- proof that no X write method or credential is accepted.
