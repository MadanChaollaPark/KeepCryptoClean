// Comment posting and verification logic
// Extracted from parseItem in twitter.js

const { SELECTORS, DELAYS } = require('./constants');
const { randomDelay, humanType } = require('./utils');
const {
  extractCommentsFromPage,
  findComment,
  convertCommentTimestamps,
} = require('./comment-extractor');

/**
 * Post a comment on a tweet page
 * @param {object} page - Puppeteer page (already navigated to tweet)
 * @param {string} comment - comment text to post
 * @returns {Promise<void>}
 */
async function postComment(page, comment) {
  await page.waitForTimeout(randomDelay(DELAYS.SHORT));
  const writeSelector = SELECTORS.TWEET_TEXTAREA;
  await page.waitForTimeout(randomDelay(DELAYS.SHORT));

  await page.evaluate(sel => {
    const element = document.querySelector(sel);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, writeSelector);

  await page.waitForTimeout(randomDelay(DELAYS.SHORT));
  await page.click(writeSelector);
  await page.waitForTimeout(randomDelay(DELAYS.LONG));
  await humanType(page, writeSelector, comment);
  await page.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));

  // Click the reply/post button
  await page.evaluate(async () => {
    const button = document.querySelector(
      'button[data-testid="tweetButtonInline"]',
    );
    if (button && !button.disabled) {
      await button.click();
    } else {
      console.log('cant click the button');
    }
  });
  await page.waitForTimeout(randomDelay(DELAYS.LONG));
}

/**
 * Check if a comment exists on a tweet page (with scrolling)
 * @param {object} browser - Puppeteer browser
 * @param {string} url - tweet URL
 * @param {string} commentText - the comment text to look for
 * @param {string} username - the expected commenter username
 * @returns {Promise<object>} found comment details or empty object
 */
async function getAndVerifyComment(browser, url, commentText, username) {
  const commentPage = await browser.newPage();
  await commentPage.goto(url);
  await commentPage.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));

  let hasMoreComments = true;

  while (hasMoreComments) {
    await commentPage.waitForTimeout(randomDelay(DELAYS.SHORT));

    const commentDetails = await extractCommentsFromPage(commentPage);
    const foundItem = findComment(commentDetails, commentText, username);

    if (foundItem) {
      console.log('Comment found.');
      const { convertToTimestamp } = require('./utils');
      foundItem.postTime = convertToTimestamp(foundItem.postTime);
      foundItem.getComments = commentText;
      await commentPage.waitForTimeout(randomDelay(DELAYS.SHORT));
      await commentPage.close();
      return foundItem;
    }

    // Scroll down to load more comments
    const previousScrollHeight = await commentPage.evaluate(
      () => document.body.scrollHeight,
    );
    await commentPage.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight),
    );
    await commentPage.waitForTimeout(randomDelay(DELAYS.SHORT));

    const currentScrollHeight = await commentPage.evaluate(
      () => document.body.scrollHeight,
    );
    hasMoreComments = currentScrollHeight > previousScrollHeight;
  }

  console.log('Comment does not exist.');
  await commentPage.waitForTimeout(randomDelay(DELAYS.SHORT));
  await commentPage.close();
  return {};
}

module.exports = { postComment, getAndVerifyComment };
