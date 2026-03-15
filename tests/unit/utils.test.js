const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanText,
  convertToTimestamp,
  getCurrentTimestamp,
  checkCommentTimestamp,
  randomDelay,
  sleep,
  COMMENT_COOLDOWN_HOURS_OPTIONS,
  MAX_ITEMS_PER_ROUND,
  MAX_SCROLL_ITERATIONS,
  TIMESTAMP_TOLERANCE_MINUTES,
  SELECTORS,
  USER_AGENT,
  BROWSER_ARGS,
} = require('../../adapters/twitter/utils');

describe('cleanText', () => {
  it('should remove whitespace and trim', () => {
    assert.equal(cleanText('  hello   world  '), 'helloworld');
  });

  it('should handle tabs and newlines', () => {
    assert.equal(cleanText('hello\n\tworld'), 'helloworld');
  });

  it('should handle empty string', () => {
    assert.equal(cleanText(''), '');
  });

  it('should handle string with only whitespace', () => {
    assert.equal(cleanText('   \n\t  '), '');
  });
});

describe('convertToTimestamp', () => {
  it('should convert ISO date string to unix timestamp', () => {
    const ts = convertToTimestamp('2024-01-01T00:00:00.000Z');
    assert.equal(ts, 1704067200);
  });

  it('should handle datetime with timezone', () => {
    const ts = convertToTimestamp('2024-06-15T12:30:00+00:00');
    assert.equal(typeof ts, 'number');
    assert.ok(ts > 0);
  });
});

describe('getCurrentTimestamp', () => {
  it('should return current time as unix timestamp in seconds', () => {
    const ts = getCurrentTimestamp();
    const now = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(ts - now) <= 1);
  });
});

describe('checkCommentTimestamp', () => {
  it('should return false if timestamp is within cooldown period', () => {
    const now = Date.now();
    const oneHourAgo = now - 1 * 60 * 60 * 1000;
    // Should always be false since min cooldown is 22 hours
    assert.equal(checkCommentTimestamp(now, oneHourAgo), false);
  });

  it('should return true if timestamp exceeds max cooldown period', () => {
    const now = Date.now();
    const thirtyHoursAgo = now - 30 * 60 * 60 * 1000;
    // Should always be true since max cooldown is 26 hours
    assert.equal(checkCommentTimestamp(now, thirtyHoursAgo), true);
  });
});

describe('randomDelay', () => {
  it('should return a number within expected range', () => {
    const delay = randomDelay(5000);
    assert.ok(delay >= 3000, `delay ${delay} should be >= 3000`);
    assert.ok(delay <= 5000, `delay ${delay} should be <= 5000`);
  });

  it('should handle small delay times', () => {
    const delay = randomDelay(3000);
    assert.ok(delay >= 1000);
    assert.ok(delay <= 3000);
  });
});

describe('sleep', () => {
  it('should resolve after the specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `elapsed ${elapsed}ms should be >= 40ms`);
  });
});

describe('constants', () => {
  it('should export valid cooldown hours', () => {
    assert.ok(Array.isArray(COMMENT_COOLDOWN_HOURS_OPTIONS));
    assert.ok(COMMENT_COOLDOWN_HOURS_OPTIONS.every(h => h > 0));
  });

  it('should export valid limits', () => {
    assert.equal(MAX_ITEMS_PER_ROUND, 120);
    assert.equal(MAX_SCROLL_ITERATIONS, 4);
    assert.equal(TIMESTAMP_TOLERANCE_MINUTES, 15);
  });

  it('should export required selectors', () => {
    assert.ok(SELECTORS.TWEET_ARTICLE);
    assert.ok(SELECTORS.TWEET_TESTID);
    assert.ok(SELECTORS.COMMENT_INPUT);
    assert.ok(SELECTORS.COMMENT_BUTTON);
    assert.ok(SELECTORS.USERNAME_INPUT);
    assert.ok(SELECTORS.PASSWORD_INPUT);
  });

  it('should export browser config', () => {
    assert.ok(USER_AGENT.includes('Chrome'));
    assert.ok(Array.isArray(BROWSER_ARGS));
    assert.ok(BROWSER_ARGS.includes('--no-sandbox'));
  });
});
