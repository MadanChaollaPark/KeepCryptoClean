const PCR = require('puppeteer-chromium-resolver');
const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const path = require('path');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const logger = require('../../lib/logger');
const { BrowserError } = require('../../lib/errors');
const SessionManager = require('./session');
const {
  sleep,
  randomDelay,
  cleanText,
  convertToTimestamp,
  SELECTORS,
  USER_AGENT,
  BROWSER_ARGS,
  TIMESTAMP_TOLERANCE_MINUTES,
} = require('./utils');

/**
 * Retrieve and verify a tweet and its comments from a verification page.
 *
 * @param {object} verifyPage - Puppeteer page navigated to the comment URL
 * @param {string} commentText - comment text to look for
 * @returns {object|null} - tweet data with matched comment details, or null
 */
async function retrieveItem(verifyPage, commentText) {
  try {
    const items = await verifyPage.evaluate(() => {
      const elements = document.querySelectorAll('article[aria-labelledby]');
      return Array.from(elements).map(element => element.outerHTML);
    });

    await sleep(randomDelay(4000));
    await verifyPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(randomDelay(4000));

    if (!items || items.length === 0) {
      logger.warn('No tweet articles found on verification page');
      return null;
    }

    const $ = cheerio.load(items[0]);
    const articles = $('article[data-testid="tweet"]').toArray();
    const el = articles[0];
    if (!el) return null;

    const tweetUrl = $('a[href*="/status/"]').attr('href');
    if (!tweetUrl) return null;
    const tweetId = tweetUrl.split('/').pop();

    const screen_name = $(el).find('a[tabindex="-1"]').text();
    const allText = $(el).find('a[role="link"]').text();
    const user_name = allText.split('@')[0];
    const user_url = 'https://x.com' + $(el).find('a[role="link"]').attr('href');
    const user_img = $(el).find('img[draggable="true"]').attr('src');
    const tweet_text = $(el).find('div[data-testid="tweetText"]').first().text();
    const timeRaw = $(el).find('time').attr('datetime');
    const time = convertToTimestamp(timeRaw);
    const tweets_content = tweet_text.replace(/\n/g, '<br>');

    const round = namespaceWrapper.getRound();
    const originData = tweets_content + round;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(originData, salt);

    await sleep(randomDelay(4000));
    await verifyPage.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
    );
    await sleep(randomDelay(4000));

    // Extract comment details
    const trimmedComment = cleanText(commentText);
    const commentDetails = await verifyPage.evaluate(
      async cleanTextStr => {
        const cleanTextFn = new Function('return ' + cleanTextStr)();
        const tweetElements = Array.from(
          document.querySelectorAll('article[data-testid="tweet"]'),
        );
        const details = [];

        await Promise.all(
          tweetElements.map(async tweetElement => {
            let commentId = null;
            let username = null;
            let postTime = null;

            const textElement = tweetElement.querySelector('div[lang]');
            let textContent = '';
            if (textElement && textElement.childNodes) {
              textElement.childNodes.forEach(node => {
                let content = '';
                if (node.nodeName === 'IMG') {
                  content = node.alt || '';
                } else {
                  content = node.innerText || node.textContent;
                }
                if (content) textContent += content;
              });
            }

            const timeElements = Array.from(
              tweetElement.querySelectorAll('time[datetime]'),
            );
            if (timeElements.length > 0) {
              timeElements.forEach(timeElement => {
                const anchorElement = timeElement.closest('a');
                if (anchorElement) {
                  const urlMatch = anchorElement.href.match(
                    /^https?:\/\/[^\/]+\/([^\/]+)\/status\/(\d+)$/,
                  );
                  username = urlMatch ? urlMatch[1] : null;
                  commentId = urlMatch ? urlMatch[2] : null;
                  postTime = timeElement.getAttribute('datetime');
                }
              });
            }

            await new Promise(resolve => setTimeout(resolve, 10000));

            if (textContent) {
              try {
                const getComments = await cleanTextFn(textContent);
                details.push({ commentId, getComments, username, postTime });
              } catch {
                // skip malformed comment
              }
            }
          }),
        );

        return details;
      },
      cleanText.toString(),
      trimmedComment,
    );

    // Convert post times
    for (const item of commentDetails) {
      item.postTime = convertToTimestamp(item.postTime);
    }

    const foundItem = commentDetails.find(item =>
      item.getComments.toLowerCase().includes(trimmedComment.toLowerCase()),
    );

    if (foundItem) {
      logger.info({ commentId: foundItem.commentId }, 'Audit: comment found');
      foundItem.getComments = commentText;
    } else {
      return null;
    }

    return {
      user_name,
      screen_name,
      user_url,
      user_img,
      tweets_id: tweetId,
      tweets_content,
      time_post: time,
      hash,
      commentDetails: foundItem,
    };
  } catch (e) {
    logger.error({ err: e }, 'Error retrieving item for verification');
    return null;
  }
}

/**
 * Verify a submitted item by opening a fresh browser, logging in,
 * and checking the tweet and comment against the submitted data.
 *
 * @param {object} inputItem - the submission data to verify
 * @param {number} round - current round number
 * @param {object} credentials - Twitter credentials
 * @param {object} db - database instance
 * @returns {boolean} - true if verification passes
 */
async function verify(inputItem, round, credentials, db) {
  logger.info({ tweetId: inputItem.tweets_id }, 'Starting verification');

  let auditBrowser = null;

  try {
    const stats = await PCR({});
    const userAuditDir = path.join(__dirname, 'puppeteer_cache_AIC_twitter_archive_audit');

    auditBrowser = await stats.puppeteer.launch({
      executablePath: stats.executablePath,
      userDataDir: userAuditDir,
      userAgent: USER_AGENT,
      args: BROWSER_ARGS,
    });

    const verifyPage = await auditBrowser.newPage();
    await verifyPage.setUserAgent(USER_AGENT);
    await sleep(randomDelay(3000));
    await verifyPage.setViewport({ width: 1024, height: 4000 });
    await sleep(randomDelay(3000));

    // Create a temporary session manager for verification login
    const session = new SessionManager(credentials, db);
    session.browser = auditBrowser;
    await session.twitterLogin(verifyPage, auditBrowser);

    // Navigate to the comment
    const url = `https://x.com/${inputItem.commentDetails.username}/status/${inputItem.commentDetails.commentId}`;
    await verifyPage.goto(url, { timeout: 60000 });
    await sleep(5000);

    // Check for tweet error
    const hasError = await verifyPage.evaluate(() => {
      return !!document.querySelector('[data-testid="error-detail"]');
    });

    if (hasError) {
      logger.warn('Tweet not found (error-detail element present)');
      return false;
    }

    logger.info({ url }, 'Retrieving item for verification');
    const result = await retrieveItem(verifyPage, inputItem.commentDetails.getComments);

    if (!result) {
      logger.warn('Verification failed: could not retrieve tweet data');
      return false;
    }

    // Verify tweet content matches
    if (result.tweets_content !== inputItem.tweets_content) {
      logger.warn(
        { expected: inputItem.tweets_content, got: result.tweets_content },
        'Content mismatch',
      );
      return false;
    }

    // Verify hash
    const dataToCompare = result.tweets_content + round;
    const hashCompare = bcrypt.compareSync(dataToCompare, inputItem.hash);
    if (!hashCompare) {
      logger.warn('Hash verification failed');
      return false;
    }

    // Verify comment ID
    if (result.commentDetails.commentId !== inputItem.commentDetails.commentId) {
      logger.warn(
        {
          expected: inputItem.commentDetails.commentId,
          got: result.commentDetails.commentId,
        },
        'Comment ID mismatch',
      );
      return false;
    }

    // Verify comment content
    const resultComment = cleanText(result.commentDetails.getComments);
    const inputComment = cleanText(inputItem.commentDetails.getComments);
    if (resultComment.trim().toLowerCase() !== inputComment.trim().toLowerCase()) {
      logger.warn(
        { expected: inputItem.commentDetails.getComments, got: result.commentDetails.getComments },
        'Comment text mismatch',
      );
      return false;
    }

    // Verify username
    if (result.commentDetails.username !== inputItem.commentDetails.username) {
      logger.warn(
        { expected: inputItem.commentDetails.username, got: result.commentDetails.username },
        'Username mismatch',
      );
      return false;
    }

    // Verify timestamp (within tolerance)
    const timeDiffMs =
      Math.abs(result.commentDetails.postTime - inputItem.commentDetails.postTime) * 1000;
    const toleranceMs = TIMESTAMP_TOLERANCE_MINUTES * 60 * 1000;

    if (timeDiffMs > toleranceMs) {
      logger.warn(
        {
          expected: inputItem.commentDetails.postTime,
          got: result.commentDetails.postTime,
          diffMinutes: timeDiffMs / 60000,
        },
        'Post time difference exceeds tolerance',
      );
      return false;
    }

    logger.info({ tweetId: inputItem.tweets_id }, 'Verification passed');
    return true;
  } catch (e) {
    logger.error({ err: e }, 'Verification error');
    return false;
  } finally {
    if (auditBrowser) {
      try {
        await auditBrowser.close();
      } catch {
        // browser already closed
      }
    }
  }
}

module.exports = { verify, retrieveItem };
