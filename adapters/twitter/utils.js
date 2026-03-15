/**
 * Shared utility functions and constants for the Twitter adapter.
 */

// --- Timing Constants ---
const COMMENT_COOLDOWN_HOURS_OPTIONS = [22, 24, 26];
const MAX_ITEMS_PER_ROUND = 120;
const MAX_SCROLL_ITERATIONS = 4;
const TIMESTAMP_TOLERANCE_MINUTES = 15;
const TYPING_SPEED_MIN_MS = 70;
const TYPING_SPEED_MAX_MS = 200;
const THINKING_PAUSE_PROBABILITY = 0.1;
const THINKING_PAUSE_MIN_MS = 300;
const THINKING_PAUSE_MAX_MS = 2000;

// --- Selectors ---
const SELECTORS = {
  TWEET_ARTICLE: 'article[aria-labelledby]',
  TWEET_TESTID: 'article[data-testid="tweet"]',
  TWEET_TEXT: 'div[data-testid="tweetText"]',
  COMMENT_INPUT: 'div[data-testid="tweetTextarea_0RichTextInputContainer"]',
  COMMENT_BUTTON: 'button[data-testid="tweetButtonInline"]',
  USERNAME_INPUT: 'input[name="text"]',
  PASSWORD_INPUT: 'input[name="password"]',
  VERIFY_INPUT: 'input[data-testid="ocfEnterTextTextInput"]',
  USER_AVATAR: '[data-testid^="UserAvatar-Container-"]',
  USER_NAME: 'div[data-testid="User-Name"]',
  ERROR_DETAIL: '[data-testid="error-detail"]',
};

// --- Browser Config ---
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const BROWSER_ARGS = [
  '--aggressive-cache-discard',
  '--disable-cache',
  '--disable-application-cache',
  '--disable-offline-load-stale-cache',
  '--disable-gpu-shader-disk-cache',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
];

// --- Utility Functions ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(delayTime) {
  const min = Math.max(delayTime - 2000, 1000);
  return Math.floor(Math.random() * (delayTime - min + 1)) + min;
}

function cleanText(text) {
  return text.replace(/\s+/g, '').trim();
}

function convertToTimestamp(dateString) {
  const date = new Date(dateString);
  return Math.floor(date.getTime() / 1000);
}

function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function checkCommentTimestamp(currentTimestamp, lastTimestamp) {
  const randomHours =
    COMMENT_COOLDOWN_HOURS_OPTIONS[
      Math.floor(Math.random() * COMMENT_COOLDOWN_HOURS_OPTIONS.length)
    ];
  const cooldownMs = randomHours * 60 * 60 * 1000;

  return currentTimestamp - lastTimestamp >= cooldownMs;
}

module.exports = {
  // Constants
  COMMENT_COOLDOWN_HOURS_OPTIONS,
  MAX_ITEMS_PER_ROUND,
  MAX_SCROLL_ITERATIONS,
  TIMESTAMP_TOLERANCE_MINUTES,
  TYPING_SPEED_MIN_MS,
  TYPING_SPEED_MAX_MS,
  THINKING_PAUSE_PROBABILITY,
  THINKING_PAUSE_MIN_MS,
  THINKING_PAUSE_MAX_MS,
  SELECTORS,
  USER_AGENT,
  BROWSER_ARGS,
  // Functions
  sleep,
  randomDelay,
  cleanText,
  convertToTimestamp,
  getCurrentTimestamp,
  checkCommentTimestamp,
};
