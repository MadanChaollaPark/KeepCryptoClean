# X read adapter

The directory name is retained for compatibility. Production behavior uses the
official X API and is strictly read-only; it does not script the website or
contain any post/reply/like/repost/follow/DM method.

## Contract

- `X_API_BEARER_TOKEN` authorizes the minimum read-only requests.
- `X_TARGET_USER_ID` is one numeric, consensus-critical User ID and must be
  identical across every node in a deployment.
- API responses are bounded and validated transiently.
- Only redistribution-permitted Post IDs/User IDs cross into the proof builder.
- A missing token/target, mismatch, malformed response, timeout, or API error
  yields no valid proof.
- Tokens, headers, post text/derivatives, usernames, source timestamps, media,
  DMs, protected content, and browser state are never proof fields.

Do not add an X user access token, write endpoint, browser package, campaign
corpus, or fallback content source. Review the
[X Developer Policy](https://docs.x.com/developer-terms/policy) and
[privacy policy](../../PRIVACY.md) before operating or extending the adapter.
