// Pure utility functions for the Twitter adapter

const {
  DELAYS,
  TYPING,
  COMMENT_HOURS_OPTIONS,
  HOURS_IN_MS,
} = require('./constants');

/**
 * Returns a randomized delay value near the given target
 * @param {number} delayTime - target delay in ms
 * @returns {number}
 */
function randomDelay(delayTime) {
  return Math.floor(Math.random() * (delayTime - 2000 + 1)) + (delayTime - 2000);
}

/**
 * Remove all whitespace and trim
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  return text.replace(/\s+/g, '').trim();
}

/**
 * Convert an ISO date string to a Unix timestamp (seconds)
 * @param {string} dateString
 * @returns {number}
 */
function convertToTimestamp(dateString) {
  const date = new Date(dateString);
  return Math.floor(date.getTime() / 1000);
}

/**
 * Get current Unix timestamp in milliseconds
 * @returns {number}
 */
function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Check if enough time has passed since the last comment
 * @param {number} currentTimeStamp - current time in ms
 * @param {number} timestamp - last comment time in ms
 * @returns {boolean} true if enough time has passed (OK to comment again)
 */
function checkCommentTimestamp(currentTimeStamp, timestamp) {
  try {
    const randomHours =
      COMMENT_HOURS_OPTIONS[
        Math.floor(Math.random() * COMMENT_HOURS_OPTIONS.length)
      ];
    const rangeInMilliseconds = randomHours * HOURS_IN_MS;

    if (currentTimeStamp - timestamp < rangeInMilliseconds) {
      console.log(`Timestamp is less than ${randomHours} hours old`);
      return false;
    }
    return true;
  } catch (error) {
    console.log('Some error in the checkCommentTimestamp :: ', error);
    return false;
  }
}

/**
 * Type text character by character with human-like delays
 * @param {object} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {string} text - text to type
 */
async function humanType(page, selector, text) {
  for (const char of text) {
    await page.type(selector, char);
    const typingSpeed = Math.random() * TYPING.MAX_SPEED_RANGE + TYPING.MIN_SPEED;
    await page.waitForTimeout(typingSpeed);

    if (Math.random() < TYPING.THINKING_PROBABILITY) {
      const thinkingPause =
        Math.random() * TYPING.THINKING_MAX_PAUSE_RANGE + TYPING.THINKING_MIN_PAUSE;
      await page.waitForTimeout(thinkingPause);
    }
  }
  console.log('Finished typing. Waiting for additional delay');
}

/**
 * Scroll the page down by one viewport height
 * @param {object} page - Puppeteer page
 */
async function scrollPage(page) {
  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight);
  });
  await page.waitForTimeout(DELAYS.SCROLL_WAIT);
}

module.exports = {
  randomDelay,
  cleanText,
  convertToTimestamp,
  getCurrentTimestamp,
  checkCommentTimestamp,
  humanType,
  scrollPage,
};
