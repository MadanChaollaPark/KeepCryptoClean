// Crawl orchestration: search and fetchList
// Extracted from twitter.js

const { SELECTORS, DELAYS, MAX_ITEMS_PER_ROUND, MAX_SCROLL_ITERATIONS, ERROR_SOMETHING_WENT_WRONG } = require('./constants');
const { randomDelay, getCurrentTimestamp, checkCommentTimestamp, scrollPage } = require('./utils');
const { extractTweetData } = require('./tweet-parser');
const { postComment, getAndVerifyComment } = require('./comment-poster');

/**
 * search — entry point for crawling
 * @param {object} ctx - the Twitter instance
 * @param {object} query - search query object
 */
async function search(ctx, query) {
  console.log('valid? ', ctx.sessionValid);
  if (ctx.sessionValid === true) {
    ctx.searchTerm = query.searchTerm;
    ctx.round = query.round;
    ctx.comment = query.comment;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const checkEmail = emailRegex.test(query.username);

    if (checkEmail) {
      await ctx.page.waitForTimeout(randomDelay(DELAYS.LONG));
      await ctx.page.goto('https://x.com/home');
      await ctx.page.waitForTimeout(randomDelay(DELAYS.LONG));

      const loggedInUsername = await ctx.page.evaluate(() => {
        const elements = document.querySelectorAll(
          '[data-testid^="UserAvatar-Container-"]',
        );
        const extractUsername = element => {
          const dataTestId = element.getAttribute('data-testid');
          if (dataTestId) {
            const username = dataTestId.split('-').pop();
            return username && username.trim() ? username : null;
          }
          return null;
        };
        let username =
          elements.length > 0 ? extractUsername(elements[0]) : null;
        if (!username && elements.length > 1) {
          username = extractUsername(elements[1]);
        }
        return username ? username : 'No username found';
      });

      await ctx.page.waitForTimeout(randomDelay(DELAYS.LONG));
      if (loggedInUsername && loggedInUsername !== 'No username found') {
        ctx.username = loggedInUsername;
        await fetchList(ctx, query.query, query.round);
      }
      console.log('Failed to retrieve a valid username.');
    } else {
      ctx.username = query.username;
      await fetchList(ctx, query.query, query.round);
    }
  } else {
    const { negotiateSession } = require('./session');
    await negotiateSession(ctx);
  }
}

/**
 * fetchList — scrape tweets from a URL, post comments, and store data
 * @param {object} ctx - the Twitter instance
 * @param {string} url - URL to scrape
 * @param {number} round - current round
 */
async function fetchList(ctx, url, round) {
  try {
    if (!ctx.username) {
      console.log(
        'fetching list stopped: Please replace TWITTER_USERNAME with your Twitter username, not your Email Address.',
      );
      return;
    }

    console.log('fetching list for ', url);
    await ctx.page.waitForTimeout(randomDelay(DELAYS.LONG));
    const screenWidth = await ctx.page.evaluate(() => window.screen.width);
    const screenHeight = await ctx.page.evaluate(() => window.screen.height);
    await ctx.page.setViewport({ width: screenWidth, height: screenHeight });
    await ctx.page.goto(url);
    await ctx.page.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));

    let i = 0;
    while (true) {
      i++;

      const errorMessage = await ctx.page.evaluate(() => {
        const elements = document.querySelectorAll('div[dir="ltr"]');
        for (let element of elements) {
          if (
            element.textContent === 'Something went wrong. Try reloading.'
          ) {
            return true;
          }
        }
        return false;
      });

      const items = await ctx.page.evaluate(() => {
        const elements = document.querySelectorAll(
          'article[aria-labelledby]',
        );
        return Array.from(elements).map(element => element.outerHTML);
      });

      await ctx.page.waitForTimeout(randomDelay(DELAYS.MEDIUM));
      console.log('items :: ', items.length);

      for (const item of items) {
        await new Promise(resolve => setTimeout(resolve, DELAYS.BETWEEN_ITEMS));

        const getCommentTimeStamp = await ctx.commentsDB.getTimestamp(
          'LAST_COMMENT_MADE',
        );
        console.log('getCommentTimeStamp :: ', getCommentTimeStamp);
        if (getCommentTimeStamp) {
          const currentTimeStamp = getCurrentTimestamp();
          const getCommentBool = checkCommentTimestamp(
            currentTimeStamp,
            getCommentTimeStamp,
          );
          if (!getCommentBool) {
            return;
          }
        }

        await new Promise(resolve =>
          setTimeout(resolve, DELAYS.BETWEEN_ITEMS_LONG),
        );

        try {
          let data = await parseItemForCrawl(
            ctx,
            item,
            url,
            ctx.page,
            ctx.browser,
          );
          if (data && data.tweets_id) {
            const existingItem = await ctx.db.getItem({ id: data.tweets_id });
            if (!existingItem) {
              ctx.cids.create({
                id: data.tweets_id,
                round: round,
                data: data,
              });
              const currentTimeStamp = getCurrentTimestamp();
              ctx.commentsDB.createTimestamp(
                'LAST_COMMENT_MADE',
                currentTimeStamp,
              );
            }
          }
        } catch (e) {
          console.log(
            'Filtering advertisement tweets; continuing to the next item.',
            e,
          );
          const currentTimeStamp = getCurrentTimestamp();
          ctx.commentsDB.createTimestamp('LAST_COMMENT_MADE', currentTimeStamp);
        }
      }

      try {
        let dataLength = (await ctx.cids.getList({ round: round })).length;
        if (dataLength > MAX_ITEMS_PER_ROUND || i > MAX_SCROLL_ITERATIONS) {
          console.log('reach maximum data per round. Closed old browser');
          ctx.browser.close();
          break;
        }
        await scrollPage(ctx.page);
        await ctx.page.waitForTimeout(randomDelay(DELAYS.MEDIUM));
        await ctx.page.evaluate(() => {
          return document.querySelectorAll('article[aria-labelledby]');
        });
      } catch (e) {
        console.log('round check error', e);
      }

      if (errorMessage) {
        console.log('Rate limit reach, waiting for next round...');
        ctx.browser.close();
        break;
      }
    }
  } catch (e) {
    console.log('Last round fetching list stop', e);
  }
}

/**
 * parseItem for crawling — extracts tweet data, posts comment, verifies
 * @param {object} ctx - the Twitter instance
 * @param {string} item - HTML of the article element
 * @param {string} url - base URL being crawled
 * @param {object} currentPage - Puppeteer page
 * @param {object} currentBrowser - Puppeteer browser
 * @returns {Promise<object>}
 */
async function parseItemForCrawl(ctx, item, url, currentPage, currentBrowser) {
  if (!ctx.sessionValid) {
    const { negotiateSession } = require('./session');
    await negotiateSession(ctx);
  }

  try {
    const tweetData = await extractTweetData(item);
    if (!tweetData) return {};

    await currentPage.waitForTimeout(randomDelay(4000));

    // Open comment page
    const commentPage = await currentBrowser.newPage();
    const getNewPageUrl = `${url}/status/${tweetData.tweets_id}`;
    await commentPage.goto(getNewPageUrl);
    await commentPage.waitForTimeout(randomDelay(DELAYS.SHORT));
    await commentPage.evaluate(() => window.focus());
    await commentPage.bringToFront();
    await commentPage.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));

    // Check if already commented
    const checkComments = await getAndVerifyComment(
      currentBrowser,
      getNewPageUrl,
      ctx.comment,
      ctx.username,
    );

    if (
      checkComments &&
      typeof checkComments === 'object' &&
      Object.keys(checkComments).length > 0
    ) {
      await commentPage.close();
      return {};
    }

    // Post comment
    await postComment(commentPage, ctx.comment);

    // Verify comment was posted
    const getCommentDetailsObject = await getAndVerifyComment(
      currentBrowser,
      getNewPageUrl,
      ctx.comment,
      ctx.username,
    );

    await commentPage.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));
    await commentPage.close();
    await new Promise(resolve =>
      setTimeout(resolve, randomDelay(DELAYS.EXTRA_LONG)),
    );

    if (
      !getCommentDetailsObject ||
      Object.keys(getCommentDetailsObject).length === 0
    ) {
      return {};
    }

    if (tweetData.screen_name && tweetData.tweets_content) {
      return {
        ...tweetData,
        keyword: ctx.searchTerm,
        commentDetails: getCommentDetailsObject,
      };
    }
    return {};
  } catch (e) {
    console.log(
      'Filtering advertisement tweets; continuing to the next item :: ',
      e,
    );
  }
}

module.exports = { search, fetchList };
