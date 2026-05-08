# Architecture

This document zooms in on what the [README](../README.md) keeps short. It is meant for someone who has cloned the repo and wants a mental model of how a single round actually executes from event to on-chain reward.

## Bird's-eye view

```
                     ┌───────────────────────────────────────┐
                     │  Koii Network task runner (parent IPC)│
                     └──────────┬────────────────────────────┘
                                │ IPC messages: executeTask /
                                │ submitPayload / auditPayload /
                                │ generateAndSubmitDistributionList /
                                │ distributionListAudit
                                ▼
                          ┌───────────┐
                          │ index.js  │      <- entry point
                          │ (router)  │
                          └─────┬─────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ coreLogic.js     │  <- per-phase orchestrator
                       └─────┬──────┬─────┘
                             │      │
            constructs once  │      │ phases 2/3 reuse the same
            per round        │      │ TwitterTask instance
                             ▼      ▼
                     ┌───────────────────────┐
                     │ TwitterTask           │  twitter-task.js
                     │  - search term        │
                     │  - Twitter adapter    │
                     │  - per-task NeDBs     │
                     └─────┬─────────────────┘
                           │
                           ▼
                     ┌───────────────────────┐
                     │ Twitter adapter       │  adapters/twitter/*
                     │  session / crawler /  │
                     │  commenter / verifier │
                     └─────┬─────────────────┘
                           │
                           ▼
                       (X.com via Puppeteer)
```

## The four phases of a round

A round is `33,500` slots ≈ 3.8 h. The Koii runner ticks each node through four phases per round:

### 1. Execute (`coreLogic.task`)

- A new `TwitterTask` is constructed. Its constructor:
  - opens four NeDB databases (`db`, `proofs`, `cids`, `comment`),
  - asks the local middleware (`http://localhost:3000/keywords`) for a comment, with a fallback to `couch_comments.json`,
  - delegates to `Twitter.session.negotiateSession()` which prefers stored encrypted cookies and only logs in with username/password if needed,
  - kicks off `Twitter.search(...)` which runs the crawler.
- The crawler scrolls the target X profile (`crawler.js`), parses each tweet article, computes a bcrypt hash of `tweet_text + round`, opens a fresh page, posts a comment via `commenter.js`, and stores the resulting record in the `cids` database keyed by the tweet ID.
- A per-account cooldown lives in the `comment` database: `LAST_COMMENT_MADE` is checked before each post; the `~22-26h` randomised window is enforced by `checkCommentTimestamp` in `utils.js`.

### 2. Submit (`coreLogic.submitTask` → `TwitterTask.getRoundCID`)

- Reads everything in `cids` for the current round, writes it to `dataList.json` in the namespace base path, uploads it via `KoiiStorageClient.uploadFile`, and stores `proof:<round> -> cid` in the `proofs` database.
- `submitTask` waits until the end of the submission window (slot math = `roundBeginSlot + submission_window - currentSlot` × 408 ms) before calling `namespaceWrapper.checkSubmissionAndUpdateRound(submission, round)`.
- Uploads are retried via `lib/retry.withRetry`, which is exponential backoff with jitter and a `shouldRetry` predicate.

### 3. Audit (`coreLogic.auditTask` → `TwitterTask.validate`)

- The namespace wrapper hands each peer's submission CID to `validateNode`. Validation:
  1. Fetches the peer's `dataList.json` from IPFS (via `KoiiStorageClient.getFile`, retried).
  2. Bails out (`return false`) if empty.
  3. Counts duplicate tweet IDs and logs when above threshold.
  4. Picks `min(max(ceil(N * 0.05), 1), 5)` items at random and asks the verifier (`adapters/twitter/verifier.js`) to confirm each one against the live X page. Auditing is sequential with a 30 s sleep between checks.
  5. The submission passes only if every sampled item passes.
- Each verification:
  - Spins up a *fresh* Chromium profile so an audit doesn't interfere with the crawl session.
  - Logs in (cookies preferred, password fallback) and navigates to the comment URL.
  - Re-extracts the tweet + comment metadata and checks: tweet content match, bcrypt hash, comment ID, comment text, posting username, and timestamp within `TIMESTAMP_TOLERANCE_MINUTES` (15 min).

### 4. Distribute (`coreLogic.selectAndGenerateDistributionList` / `auditDistribution`)

- The namespace wrapper picks a *decider* node. If that's us, we run `submitDistributionList`:
  1. `generateDistributionList(round)` walks `taskAccountDataJSON.submissions[round]` and the audit triggers.
  2. For each candidate:
     - No audit → valid candidate.
     - Audit triggered, no votes → slashed (0).
     - Vote score `>0` → valid candidate.
     - Vote score `<0` → slashed (0).
  3. The bounty (`bounty_amount_per_round`) is floor-divided across the surviving candidates.
  4. The map is uploaded via `namespaceWrapper.uploadDistributionList` and submitted on-chain via `distributionListSubmissionOnChain`.
- Other nodes audit the distribution list using `validateDistribution` — they regenerate it locally and `shallowEqual` against what was submitted, voting valid iff it matches (or abstaining on errors to avoid slashing the decider unfairly).

## Data layout

### Local NeDB

| DB        | Keys                          | Purpose                                                         |
| --------- | ----------------------------- | --------------------------------------------------------------- |
| `db`      | `id` = arbitrary, plus `cookies` singleton | General lookups, encrypted Twitter session cookies. |
| `proofs`  | `id = proof:<round>`          | Maps each round to the CID we submitted, so we can re-fetch.    |
| `cids`    | `id = <tweetId>`              | Raw tweet+comment records for the current round; flushed to IPFS as `dataList.json`. |
| `comment` | `id = LAST_COMMENT_MADE`, plus per-comment id rows | Timestamps that drive the per-account ~24 h cooldown. |

### IPFS payload (`dataList.json`)

An array of records with the shape produced by `crawler.parseItem`:

```jsonc
{
  "user_name": "...",
  "round": 1234,
  "screen_name": "...",
  "user_url": "https://x.com/...",
  "user_img": "https://pbs.twimg.com/...",
  "tweets_id": "1700000000000000000",
  "tweets_content": "...",
  "time_post": 1700000000,
  "keyword": "JDVance",
  "hash": "$2a$10$...",         // bcrypt(tweets_content + round)
  "commentDetails": {
    "commentId": "1700000000000000001",
    "getComments": "<comment text>",
    "username": "<our volunteer account>",
    "postTime": 1700000000
  }
}
```

### On-chain task state

Configured in `config-task.yml`:

| Field                       | Value         | Notes                                                    |
| --------------------------- | ------------- | -------------------------------------------------------- |
| `round_time`                | 33,500 slots  | ≈ 3.8 hours at ~408 ms / slot                            |
| `audit_window`              | 11,500 slots  | Window during which audit votes are accepted             |
| `submission_window`         | 11,500 slots  | Window during which submissions are accepted             |
| `minimum_stake_amount`      | 1.9 KOII      | Stake required to participate                            |
| `bounty_amount_per_round`   | 10 KOII       | Reward pool split across valid submitters                |
| `allowed_failed_distributions` | 5          | Retry budget for the decider                             |
| `space`                     | 5 MB          | On-chain account allocation                              |
| `task_type`                 | `KPL`         | Token type on Koii                                       |

## Why so many sleeps?

The browser code is sprinkled with `randomDelay` and `sleep` calls. They are not paranoia — they are anti-detection guard-rails. Twitter aggressively flags anything with super-human typing speed or zero-latency clicks. The `TYPING_SPEED_MIN_MS`/`TYPING_SPEED_MAX_MS` and `THINKING_PAUSE_*` constants in `adapters/twitter/utils.js` are tuned conservatively. Tightening them is the fastest way to get the volunteer account suspended; loosen with care.

## Where to start when changing things

| You want to…                                   | Look at                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| Change which profile is targeted               | `twitter-task.js#fetchSearchTerms` (`search:`)  |
| Add or tweak the comment library               | `couch_comments.json` and the middleware        |
| Change how submissions are validated           | `twitter-task.js#validate` + `verifier.js`      |
| Change the slashing or reward math             | `coreLogic.js#generateDistributionList` or `lib/distribution.js` |
| React to an X UI change (selectors)            | `adapters/twitter/utils.js` `SELECTORS`          |
| Tune anti-detection timing                     | `adapters/twitter/utils.js` (timing constants)  |
| Change the IPFS upload retry policy            | `adapters/twitter/twitter.js#getSubmissionCID`   |
| Adjust round / window timing                   | `config-task.yml` (and re-deploy to Koii)        |
