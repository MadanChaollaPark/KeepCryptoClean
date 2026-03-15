const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const logger = require('../../lib/logger');
const { getCommentDetails } = require('./commenter');
const { postComment } = require('./commenter');
const {
  sleep,
  randomDelay,
  convertToTimestamp,
  getCurrentTimestamp,
  checkCommentTimestamp,
  SELECTORS,
  MAX_ITEMS_PER_ROUND,
  MAX_SCROLL_ITERATIONS,
} = require('./utils');

/**
 * Parse a single tweet article HTML, post a comment, and return structured data.
 *
 * @param {string} itemHtml - outer HTML of the tweet article element
 * @param {string} profileUrl - URL of the profile being crawled (e.g. https://x.com/JDVance)
 * @param {object} page - Puppeteer page instance
 * @param {object} browser - Puppeteer browser instance
 * @param {object} opts
 * @param {string} opts.comment - comment text to post
 * @param {string} opts.username - logged-in username
 * @param {string} opts.searchTerm - the search term used
 * @param {Function} opts.checkSession - callback to revalidate session
 * @returns {object|null} - parsed tweet data with comment details, or null
 */
async function parseItem(itemHtml, profileUrl, page, browser, opts) {
  const { comment, username, searchTerm, checkSession } = opts;

  if (checkSession && !(await checkSession())) {
    logger.warn('Session invalid during parseItem');
  }

  try {
    const $ = cheerio.load(itemHtml);
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
    const tweet_text = $(el).find(SELECTORS.TWEET_TEXT).first().text();
    const timeRaw = $(el).find('time').attr('datetime');
    const time = convertToTimestamp(timeRaw);
    const tweets_content = tweet_text.replace(/\n/g, '<br>');

    // Hash tweet content with round number
    const round = namespaceWrapper.getRound();
    const originData = tweets_content + round;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(originData, salt);

    await sleep(randomDelay(4000));

    // Open comment page for this tweet
    let commentPage;
    const tweetPageUrl = `${profileUrl}/status/${tweetId}`;

    try {
      commentPage = await browser.newPage();
      await commentPage.goto(tweetPageUrl);
      await sleep(randomDelay(3000));
      await commentPage.evaluate(() => window.focus());
      await commentPage.bringToFront();
      await sleep(randomDelay(8000));

      // Check if we already commented on this tweet
      const existingComment = await getCommentDetails(tweetPageUrl, comment, browser, username);
      if (existingComment && Object.keys(existingComment).length > 0) {
        logger.debug({ tweetId }, 'Already commented on this tweet');
        await commentPage.close();
        return null;
      }

      // Post the comment
      const commentDetails = await postComment(commentPage, browser, tweetPageUrl, comment, username);

      await sleep(randomDelay(8000));
      await commentPage.close();

      if (!commentDetails || Object.keys(commentDetails).length === 0) {
        return null;
      }

      if (screen_name && tweet_text) {
        return {
          user_name,
          round,
          screen_name,
          user_url,
          user_img,
          tweets_id: tweetId,
          tweets_content,
          time_post: time,
          keyword: searchTerm,
          hash,
          commentDetails,
        };
      }

      return null;
    } finally {
      if (commentPage) {
        try { await commentPage.close(); } catch { /* already closed */ }
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'Error parsing tweet item; skipping');
    return null;
  }
}

/**
 * Scroll the page down by one viewport height.
 */
async function scrollPage(page) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await sleep(5000);
}

/**
 * Fetch and process tweets from a profile page.
 *
 * @param {object} page - Puppeteer page instance
 * @param {object} browser - Puppeteer browser instance
 * @param {object} opts
 * @param {string} opts.url - profile URL to crawl
 * @param {number} opts.round - current round number
 * @param {string} opts.comment - comment to post
 * @param {string} opts.username - logged-in username
 * @param {string} opts.searchTerm - search term
 * @param {object} opts.db - main data database
 * @param {object} opts.cids - CIDs database
 * @param {object} opts.commentsDB - comments timestamp database
 * @param {Function} opts.checkSession - session check callback
 * @param {number} opts.timeoutMs - max execution time in ms (default: 3 hours)
 */
async function fetchList(page, browser, opts) {
  const {
    url,
    round,
    comment,
    username,
    searchTerm,
    db,
    cids,
    commentsDB,
    checkSession,
    timeoutMs = 3 * 60 * 60 * 1000,
  } = opts;

  if (!username) {
    logger.error('fetchList aborted: username not set. Use your Twitter username, not email.');
    return;
  }

  const startTime = Date.now();

  try {
    logger.info({ url }, 'Starting tweet list fetch');
    await sleep(randomDelay(6000));

    const screenWidth = await page.evaluate(() => window.screen.width);
    const screenHeight = await page.evaluate(() => window.screen.height);
    await page.setViewport({ width: screenWidth, height: screenHeight });
    await page.goto(url);
    await sleep(randomDelay(8000));

    for (let iteration = 0; ; iteration++) {
      // Timeout guard
      if (Date.now() - startTime > timeoutMs) {
        logger.warn({ elapsedMs: Date.now() - startTime }, 'fetchList timed out');
        break;
      }

      // Check for Twitter error message
      const errorMessage = await page.evaluate(() => {
        const elements = document.querySelectorAll('div[dir="ltr"]');
        for (let element of elements) {
          if (element.textContent === 'Something went wrong. Try reloading.') {
            return true;
          }
        }
        return false;
      });

      if (errorMessage) {
        logger.warn('Twitter rate limit or error detected; stopping');
        break;
      }

      // Get tweet articles on the current page
      const items = await page.evaluate(() => {
        const elements = document.querySelectorAll('article[aria-labelledby]');
        return Array.from(elements).map(element => element.outerHTML);
      });

      await sleep(randomDelay(5000));
      logger.info({ count: items.length, iteration }, 'Found tweet items');

      // Process each tweet
      for (const item of items) {
        await sleep(1000);

        // Check rate limit cooldown
        const lastCommentTs = await commentsDB.getTimestamp('LAST_COMMENT_MADE');
        if (lastCommentTs) {
          const currentTs = getCurrentTimestamp();
          if (!checkCommentTimestamp(currentTs, lastCommentTs)) {
            logger.info('Comment cooldown active; stopping');
            return;
          }
        }

        await sleep(2000);

        try {
          const data = await parseItem(item, url, page, browser, {
            comment,
            username,
            searchTerm,
            checkSession,
          });

          if (data && data.tweets_id) {
            const existingItem = await db.getItem({ id: data.tweets_id });
            if (!existingItem) {
              await cids.create({
                id: data.tweets_id,
                round,
                data,
              });
              const currentTs = getCurrentTimestamp();
              await commentsDB.createTimestamp('LAST_COMMENT_MADE', currentTs);
            }
          }
        } catch (e) {
          logger.warn({ err: e }, 'Error processing tweet; continuing');
          const currentTs = getCurrentTimestamp();
          await commentsDB.createTimestamp('LAST_COMMENT_MADE', currentTs);
        }
      }

      // Check if we've hit limits
      const dataLength = (await cids.getList({ round })).length;
      if (dataLength >= MAX_ITEMS_PER_ROUND || iteration >= MAX_SCROLL_ITERATIONS) {
        logger.info(
          { dataLength, iteration },
          'Reached max items or scroll iterations; stopping',
        );
        break;
      }

      await scrollPage(page);
      await sleep(randomDelay(5000));

      // Re-evaluate after scroll
      await page.evaluate(() =>
        document.querySelectorAll('article[aria-labelledby]'),
      );
    }
  } catch (e) {
    logger.error({ err: e }, 'Error during fetchList');
  }
}

module.exports = {
  parseItem,
  scrollPage,
  fetchList,
};
