// Verification/audit logic: verify and retrieveItem
// Extracted from twitter.js

const bcrypt = require('bcryptjs');
const { createBrowser } = require('./browser-factory');
const { twitterLogin } = require('./session');
const { extractTweetData } = require('./tweet-parser');
const {
  extractCommentsFromPage,
  findComment,
  convertCommentTimestamps,
} = require('./comment-extractor');
const {
  CACHE_DIR_AUDIT,
  VIEWPORT_AUDIT,
  SELECTORS,
  DELAYS,
  TIME_DIFF_THRESHOLD_MS,
} = require('./constants');
const { randomDelay, cleanText } = require('./utils');

/**
 * Verify a submitted item by re-fetching the tweet and checking comment
 * @param {object} ctx - the Twitter instance
 * @param {object} inputItem - the item to verify
 * @param {number} round - current round
 * @returns {Promise<boolean>}
 */
async function verify(ctx, inputItem, round) {
  console.log('----Input Item Below -----');
  console.log(inputItem);
  console.log('----Input Item Above -----');

  let auditBrowser;
  try {
    const result = await createBrowser(CACHE_DIR_AUDIT, VIEWPORT_AUDIT);
    auditBrowser = result.browser;
    const verify_page = result.page;

    await twitterLogin(ctx, verify_page, auditBrowser);

    const url = `https://x.com/${inputItem.commentDetails.username}/status/${inputItem.commentDetails.commentId}`;
    await verify_page.goto(url, { timeout: DELAYS.PAGE_LOAD });
    await new Promise(resolve => setTimeout(resolve, DELAYS.MEDIUM));

    const confirmed_no_tweet = await verify_page.evaluate(() => {
      return !!document.querySelector('[data-testid="error-detail"]');
    });

    if (confirmed_no_tweet) {
      auditBrowser.close();
      return false;
    }

    console.log('Retrieve item for', url);
    const retrievedData = await retrieveItem(
      ctx,
      verify_page,
      inputItem.commentDetails.getComments,
    );

    if (!retrievedData) {
      console.log('Result does not exist. ');
      auditBrowser.close();
      return false;
    }

    if (retrievedData.tweets_content !== inputItem.tweets_content) {
      console.log(
        'Content not match',
        retrievedData.tweets_content,
        inputItem.tweets_content,
      );
      auditBrowser.close();
      return false;
    }

    const dataToCompare = retrievedData.tweets_content + round;
    console.log({
      result: dataToCompare,
      input: inputItem.tweets_content + inputItem.round,
    });
    const hashCompare = bcrypt.compareSync(dataToCompare, inputItem.hash);
    if (!hashCompare) {
      console.log(
        'Hash Verification Failed',
        dataToCompare,
        inputItem.hash,
      );
      auditBrowser.close();
      return false;
    }

    // Check comment details
    if (
      retrievedData.commentDetails.commentId !==
      inputItem.commentDetails.commentId
    ) {
      console.log(
        'Comment Not Found',
        retrievedData.commentDetails.commentId,
        inputItem.commentDetails.commentId,
      );
      auditBrowser.close();
      return false;
    }

    const resultGetComments = cleanText(
      retrievedData.commentDetails.getComments,
    );
    const inputItemGetComments = cleanText(
      inputItem.commentDetails.getComments,
    );
    if (
      resultGetComments.trim().toLowerCase() !==
      inputItemGetComments.trim().toLowerCase()
    ) {
      console.log(
        'Comments are not the same',
        retrievedData.commentDetails.getComments,
        inputItem.commentDetails.getComments,
      );
      auditBrowser.close();
      return false;
    }

    if (
      retrievedData.commentDetails.username !==
      inputItem.commentDetails.username
    ) {
      console.log(
        'username is not matched',
        retrievedData.commentDetails.username,
        inputItem.commentDetails.username,
      );
      auditBrowser.close();
      return false;
    }

    const timeDifference =
      Math.abs(
        retrievedData.commentDetails.postTime -
          inputItem.commentDetails.postTime,
      ) * 1000;
    if (timeDifference > TIME_DIFF_THRESHOLD_MS) {
      console.log(
        'Post times differ by more than 15 minutes.',
        retrievedData.commentDetails.postTime,
        inputItem.commentDetails.postTime,
      );
      auditBrowser.close();
      return false;
    }

    auditBrowser.close();
    return true;
  } catch (e) {
    console.log('Error fetching single item', e);
    if (auditBrowser) auditBrowser.close();
    return false;
  }
}

/**
 * Retrieve and parse a tweet item from a verification page
 * @param {object} ctx - the Twitter instance
 * @param {object} verify_page - Puppeteer page
 * @param {string} comment - the comment text to find
 * @returns {Promise<object|null>}
 */
async function retrieveItem(ctx, verify_page, comment) {
  try {
    const items = await verify_page.evaluate(() => {
      const elements = document.querySelectorAll('article[aria-labelledby]');
      return Array.from(elements).map(element => element.outerHTML);
    });

    await verify_page.waitForTimeout(randomDelay(4000));
    await verify_page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await verify_page.waitForTimeout(randomDelay(4000));

    if (!items || items.length === 0) return null;

    const tweetData = await extractTweetData(items[0]);
    if (!tweetData) return null;

    await verify_page.waitForTimeout(randomDelay(4000));
    await verify_page.evaluate(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
      });
    });
    await verify_page.waitForTimeout(randomDelay(4000));

    // Extract comments
    const commentDetails = await extractCommentsFromPage(verify_page);
    await convertCommentTimestamps(commentDetails);

    const foundItem = findComment(commentDetails, comment);

    if (foundItem) {
      console.log('AUDITS :::: Comment found. ');
      foundItem.getComments = comment;
    } else {
      return null;
    }

    return {
      user_name: tweetData.user_name,
      screen_name: tweetData.screen_name,
      user_url: tweetData.user_url,
      user_img: tweetData.user_img,
      tweets_id: tweetData.tweets_id,
      tweets_content: tweetData.tweets_content,
      time_post: tweetData.time_post,
      hash: tweetData.hash,
      commentDetails: foundItem,
    };
  } catch (e) {
    console.log('Last round fetching list stop', e);
    return null;
  }
}

module.exports = { verify, retrieveItem };
