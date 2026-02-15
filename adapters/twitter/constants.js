// All shared constants for the Twitter adapter modules

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

// Browser args for the audit/verification browser (no --disable-dev-shm-usage)
const BROWSER_ARGS_AUDIT = [
  '--aggressive-cache-discard',
  '--disable-cache',
  '--disable-application-cache',
  '--disable-offline-load-stale-cache',
  '--disable-gpu-shader-disk-cache',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
];

// Cache directory names
const CACHE_DIR_SESSION = 'puppeteer_cache_AIC_twitter_archive';
const CACHE_DIR_AUDIT = 'puppeteer_cache_AIC_twitter_archive_audit';

// Viewport sizes
const VIEWPORT_DEFAULT = { width: 1920, height: 1080 };
const VIEWPORT_AUDIT = { width: 1024, height: 4000 };

// Selectors
const SELECTORS = {
  TWEET_ARTICLE: 'article[data-testid="tweet"]',
  TWEET_ARTICLE_LABELED: 'article[aria-labelledby]',
  TWEET_TEXT: 'div[data-testid="tweetText"]',
  TWEET_TEXTAREA: 'div[data-testid="tweetTextarea_0RichTextInputContainer"]',
  TWEET_BUTTON_INLINE: 'button[data-testid="tweetButtonInline"]',
  USER_NAME: 'div[data-testid="User-Name"]',
  ERROR_DETAIL: '[data-testid="error-detail"]',
  USERNAME_INPUT: 'input[name="text"]',
  PASSWORD_INPUT: 'input[name="password"]',
  VERIFY_INPUT: 'input[data-testid="ocfEnterTextTextInput"]',
  INPUT: 'input',
  USER_AVATAR_CONTAINER: '[data-testid^="UserAvatar-Container-"]',
  DIR_LTR: 'div[dir="ltr"]',
  TWEET_URL_ATTR: 'a[href*="/status/"]',
  TAB_INDEX_LINK: 'a[tabindex="-1"]',
  ROLE_LINK: 'a[role="link"]',
  DRAGGABLE_IMG: 'img[draggable="true"]',
  DIV_LANG: 'div[lang]',
  TIME: 'time',
  TIME_DATETIME: 'time[datetime]',
};

// URLs
const URLS = {
  LOGIN: 'https://x.com/i/flow/login',
  HOME: 'https://x.com/home',
  BASE: 'https://x.com',
  LOGIN_REDIRECT: 'https://x.com/i/flow/login?redirect_after_login=%2Fhome',
  LOGOUT_PREFIX: 'https://x.com/?logout=',
};

// Timeouts and delays (in milliseconds)
const DELAYS = {
  SHORT: 3000,
  MEDIUM: 5000,
  LONG: 6000,
  EXTRA_LONG: 8000,
  VERY_LONG: 10000,
  PAGE_LOAD: 60000,
  IN_BROWSER_WAIT: 10000, // used inside page.evaluate
  SESSION_CHECK_INTERVAL: 50000,
  SCROLL_WAIT: 5000,
  COMMENT_SCROLL_WAIT: 3000,
  BETWEEN_ITEMS: 1000,
  BETWEEN_ITEMS_LONG: 2000,
  RATE_LIMIT_WAIT: 120000,
};

// Typing simulation
const TYPING = {
  MIN_SPEED: 70,
  MAX_SPEED_RANGE: 200,
  THINKING_PROBABILITY: 0.1,
  THINKING_MIN_PAUSE: 300,
  THINKING_MAX_PAUSE_RANGE: 2000,
};

// Business logic
const MAX_ITEMS_PER_ROUND = 120;
const MAX_SCROLL_ITERATIONS = 4;
const SALT_ROUNDS = 10;
const COMMENT_HOURS_OPTIONS = [22, 24, 26];
const HOURS_IN_MS = 60 * 60 * 1000;
const TIME_DIFF_THRESHOLD_MS = 15 * 60 * 1000;
const MAX_CREATE_PAGE_RETRIES = 3;

// Email verification text
const EMAIL_VERIFICATION_TEXT =
  'Verify your identity by entering the email address associated with your X account.';

// Error messages
const ERROR_SOMETHING_WENT_WRONG = 'Something went wrong. Try reloading.';

module.exports = {
  USER_AGENT,
  BROWSER_ARGS,
  BROWSER_ARGS_AUDIT,
  CACHE_DIR_SESSION,
  CACHE_DIR_AUDIT,
  VIEWPORT_DEFAULT,
  VIEWPORT_AUDIT,
  SELECTORS,
  URLS,
  DELAYS,
  TYPING,
  MAX_ITEMS_PER_ROUND,
  MAX_SCROLL_ITERATIONS,
  SALT_ROUNDS,
  COMMENT_HOURS_OPTIONS,
  HOURS_IN_MS,
  TIME_DIFF_THRESHOLD_MS,
  MAX_CREATE_PAGE_RETRIES,
  EMAIL_VERIFICATION_TEXT,
  ERROR_SOMETHING_WENT_WRONG,
};
