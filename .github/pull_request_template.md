## What changed

<!-- Describe the behavior and why it is needed. -->

## Safety and compatibility

- [ ] Default operation remains read-only and fail-closed.
- [ ] No credentials, cookies, wallet files, runtime databases, or browser profiles are included.
- [ ] Submission evidence is bound to the target, round, and node identity.
- [ ] Any Koii configuration or dependency change has a migration note.

## Verification

- [ ] `yarn install --frozen-lockfile`
- [ ] `yarn test:ci`
- [ ] `yarn audit:production`
- [ ] `docker compose config --quiet` (when container/config files change)

<!-- List anything that could not be tested. Never paste secrets into logs. -->
