# Twitter Adapter

Puppeteer-based automation that logs into X (Twitter), crawls a target profile, posts a comment on each tweet, and verifies submissions during audits.

## Module Layout

The adapter is split into focused modules so each concern can be tested and maintained on its own:

| File           | Responsibility                                                              |
| -------------- | --------------------------------------------------------------------------- |
| `twitter.js`   | Thin orchestrator — wires the modules together and exposes the public API. |
| `session.js`   | Browser lifecycle, login flow (cookie reuse + credential fallback), encrypted cookie storage. |
| `crawler.js`   | Profile crawling: scrolling, tweet article parsing, hashing, dispatching to the commenter. |
| `commenter.js` | Comment posting with human-like typing delays, plus comment lookup/verification. |
| `verifier.js`  | Audit-side verification — opens a fresh browser, fetches the live tweet, and re-checks every field of a submission. |
| `utils.js`     | Shared constants (selectors, timing knobs, browser args) and small helpers (`sleep`, `randomDelay`, `cleanText`, timestamp helpers). |

## Standalone Use (development)

The adapter can be exercised outside the Koii task runner via the test harness:

```bash
# from the repo root
node tests/twitter.js              # uses the default search term ("Web3")
node tests/twitter.js JDVance      # pass a single-word search term to override
```

Environment variables (`TWITTER_USERNAME`, `TWITTER_PASSWORD`, `TWITTER_PHONE`) must be set in a `.env` file at the repo root — see `.env.sample`.

## Notes

- **Session caching**: cookies are persisted to the local NeDB database, encrypted with AES-256-GCM (see `lib/crypto.js`). On startup the session manager tries the stored cookies first and only falls back to a full username/password login if they're rejected.
- **Anti-detection**: timing constants in `utils.js` (`TYPING_SPEED_*`, `THINKING_PAUSE_*`, `randomDelay`) are intentionally varied to look human. Tune carefully — overly fast input will get the account flagged.
- **Selectors live in one place**: every X DOM selector is in `utils.js` `SELECTORS`. When X ships a UI change, that's the single file to update.
