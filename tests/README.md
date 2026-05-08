# Tests

Two flavours live here:

- **End-to-end / smoke scripts** (top-level files) — drive the full task or the Twitter adapter against the real Twitter site. They need real credentials and a working browser, so they're slow, flaky, and not run in CI. Useful when poking at adapter behaviour by hand.
- **Unit tests** (`unit/`) — pure-function tests that don't touch the network or the browser. Cheap and deterministic.

## Running

```bash
# default smoke test (single round)
yarn test

# individual scripts (from the repo root)
node tests/test-one-round.js
node tests/test-several-rounds.js
node tests/twitter.js [search_term]   # default search term: "Web3"
node tests/test-validate-cid.js
node tests/testAudits.js
node tests/test-one-tweet.js
node tests/test_data.js
```

All E2E scripts read credentials from the project-root `.env` file (see `.env.sample`).

## Files

| File                     | What it exercises                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `test-one-round.js`      | Single round: execute + audit (referenced by `yarn test`).                                |
| `test-several-rounds.js` | Loops a `TwitterTask` through several rounds. Marked flaky in source.                     |
| `twitter.js`             | Boots the Twitter adapter directly with a CLI search-term arg; useful for crawler debugging. |
| `twitter-adapter.js`     | Older adapter integration scaffold (uses LevelDB and bearer-token credentials).           |
| `twitter-task-class.js`  | `TwitterTask` lifecycle smoke test — variant of `test-several-rounds.js`.                 |
| `test-one-tweet.js`      | Single-tweet smoke test against the Twitter adapter.                                      |
| `test-validate-cid.js`   | Validates that `TwitterTask` produces a parseable IPFS CID for a round.                   |
| `testAudits.js`          | Drives the audit/verification path against a known submission.                            |
| `test_data.js`           | Exercises `model/data.js` (Data class).                                                   |
| `test_item.js`           | Tiny `Item` value object used by `test_data.js`.                                          |
| `test_autoscroll.js`     | Manual visual test of the scrolling helper.                                               |
| `autoscroll.js`          | The scroll helper itself.                                                                 |
| `full.js`                | End-to-end walkthrough of `coreLogic` (task → submit → audit → distribute).               |
| `unit/`                  | Pure-function unit tests (validation, distribution, adapter, data).                       |
| `helpers/`               | Shared fixtures and helpers used by the unit tests.                                       |

## Required environment

| Variable             | Where it's used                                                |
| -------------------- | -------------------------------------------------------------- |
| `TWITTER_USERNAME`   | All scripts that log in.                                       |
| `TWITTER_PASSWORD`   | All scripts that log in.                                       |
| `TWITTER_PHONE`      | Login flow when X asks for verification.                       |
| `TWITTER_COMMENTS`   | `twitter.js`, `test-one-tweet.js` — the comment text to post.  |

## Caveats

- Several E2E scripts include a `// warning, this doesn't really work that well, but it's a start` comment from the original author. Treat them as scratch pads, not regression tests.
- Some files import paths that no longer exist (`../model/gatherer`, `../adapters/twitter` without `/twitter.js`); those scripts haven't been updated since the adapter split. Run with eyes open.
