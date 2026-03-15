const logger = require('../../lib/logger');
const {
  sleep,
  randomDelay,
  cleanText,
  convertToTimestamp,
  SELECTORS,
  TYPING_SPEED_MIN_MS,
  TYPING_SPEED_MAX_MS,
  THINKING_PAUSE_PROBABILITY,
  THINKING_PAUSE_MIN_MS,
  THINKING_PAUSE_MAX_MS,
} = require('./utils');

/**
 * Type text character-by-character with human-like delays.
 */
async function humanType(page, selector, text) {
  for (const char of text) {
    await page.type(selector, char);
    const typingSpeed = Math.random() * (TYPING_SPEED_MAX_MS - TYPING_SPEED_MIN_MS) + TYPING_SPEED_MIN_MS;
    await sleep(typingSpeed);

    if (Math.random() < THINKING_PAUSE_PROBABILITY) {
      const pause = Math.random() * (THINKING_PAUSE_MAX_MS - THINKING_PAUSE_MIN_MS) + THINKING_PAUSE_MIN_MS;
      await sleep(pause);
    }
  }
  logger.debug('Finished typing comment');
}

/**
 * Post a comment on a tweet and verify it was posted.
 *
 * @param {object} commentPage - Puppeteer page navigated to the tweet
 * @param {object} browser - Puppeteer browser instance
 * @param {string} tweetUrl - Full URL of the tweet
 * @param {string} comment - Comment text to post
 * @param {string} username - The logged-in username (for verification)
 * @returns {object|null} - Comment details or null if failed
 */
async function postComment(commentPage, browser, tweetUrl, comment, username) {
  try {
    // Scroll to comment input and click
    await sleep(randomDelay(3000));
    const writeSelector = SELECTORS.COMMENT_INPUT;
    await commentPage.evaluate(sel => {
      const element = document.querySelector(sel);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, writeSelector);

    await sleep(randomDelay(3000));
    await commentPage.click(writeSelector);
    await sleep(randomDelay(6000));

    // Type comment
    await humanType(commentPage, writeSelector, comment);
    await sleep(randomDelay(8000));

    // Click post button
    await commentPage.evaluate(async () => {
      const button = document.querySelector('button[data-testid="tweetButtonInline"]');
      if (button && !button.disabled) {
        await button.click();
      } else {
        console.log('Comment button not clickable');
      }
    });
    await sleep(randomDelay(6000));

    // Verify comment was posted
    const details = await getCommentDetails(tweetUrl, comment, browser, username);
    return details;
  } catch (e) {
    logger.error({ err: e, tweetUrl }, 'Failed to post comment');
    return null;
  }
}

/**
 * Extract comment details from a tweet page by scrolling through comments.
 *
 * @param {string} url - Tweet URL
 * @param {string} commentText - Comment text to search for
 * @param {object} browser - Puppeteer browser instance
 * @param {string} username - Username who posted the comment
 * @returns {object} - Comment details { commentId, getComments, username, postTime } or {}
 */
async function getCommentDetails(url, commentText, browser, username) {
  let commentPage;
  try {
    commentPage = await browser.newPage();
    await commentPage.goto(url);
    await sleep(randomDelay(8000));

    let hasMoreComments = true;
    const trimmedComment = cleanText(commentText);

    while (hasMoreComments) {
      await sleep(randomDelay(3000));

      const commentDetails = await commentPage.evaluate(
        async cleanTextStr => {
          const cleanTextFn = new Function('return ' + cleanTextStr)();
          const tweetElements = Array.from(
            document.querySelectorAll('article[data-testid="tweet"]'),
          );

          const details = [];
          await Promise.all(
            tweetElements.map(async tweetElement => {
              let commentId = null;
              let tweetUsername = null;
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

              const anchorElements = tweetElement.querySelectorAll(
                'div[data-testid="User-Name"]',
              );
              anchorElements.forEach(anchorElement => {
                const getAnchorTags = anchorElement.querySelectorAll('a');
                for (let index = 0; index < getAnchorTags.length; index++) {
                  const element = getAnchorTags[getAnchorTags.length - 1];
                  const urlMatch = element.href.match(
                    /^https?:\/\/[^\/]+\/([^\/]+)\/status\/(\d+)$/,
                  );
                  tweetUsername = urlMatch ? urlMatch[1] : null;
                  commentId = urlMatch ? urlMatch[2] : null;
                  const timeElement = element.querySelector('time');
                  postTime = timeElement ? timeElement.getAttribute('datetime') : null;
                  break;
                }
              });

              await new Promise(resolve => setTimeout(resolve, 10000));

              if (textContent) {
                try {
                  const getComments = await cleanTextFn(textContent);
                  details.push({ commentId, getComments, username: tweetUsername, postTime });
                } catch (error) {
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

      const foundItem = commentDetails.find(
        item =>
          item.getComments.toLowerCase().includes(trimmedComment.toLowerCase()) &&
          item.username === username,
      );

      if (foundItem) {
        logger.debug({ commentId: foundItem.commentId }, 'Comment found');
        foundItem.postTime = convertToTimestamp(foundItem.postTime);
        foundItem.getComments = commentText;
        await sleep(randomDelay(3000));
        await commentPage.close();
        return foundItem;
      }

      // Scroll to load more comments
      const previousScrollHeight = await commentPage.evaluate(
        () => document.body.scrollHeight,
      );
      await commentPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(randomDelay(3000));

      const currentScrollHeight = await commentPage.evaluate(
        () => document.body.scrollHeight,
      );
      hasMoreComments = currentScrollHeight > previousScrollHeight;
    }

    logger.debug('Comment not found after scrolling all comments');
    await commentPage.close();
    return {};
  } catch (e) {
    logger.error({ err: e }, 'Error in getCommentDetails');
    if (commentPage) {
      try { await commentPage.close(); } catch { /* already closed */ }
    }
    return {};
  }
}

module.exports = {
  humanType,
  postComment,
  getCommentDetails,
};
