// Shared page.evaluate logic for extracting comments from the DOM
// Deduplicates logic from getTheCommentDetails and retrieveItem

const { SELECTORS, DELAYS } = require('./constants');
const { cleanText, randomDelay, convertToTimestamp } = require('./utils');

/**
 * The function body that runs inside page.evaluate to extract comment details.
 * Serialized as a string and passed to the browser context.
 * @returns {string} function source for page.evaluate
 */
function getCleanTextFnString() {
  return cleanText.toString();
}

/**
 * Extract comment details from the current page's DOM via page.evaluate
 * @param {object} page - Puppeteer page
 * @returns {Promise<Array<{commentId: string|null, getComments: string, username: string|null, postTime: string|null}>>}
 */
async function extractCommentsFromPage(page) {
  const details = await page.evaluate(async cleanTextStr => {
    const cleanText = new Function('return ' + cleanTextStr)();

    const tweetElements = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]'),
    );
    const results = [];

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
            if (content) {
              textContent += content;
            }
          });
        }

        // Try User-Name anchor approach (used in getTheCommentDetails)
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
            username = urlMatch ? urlMatch[1] : null;
            commentId = urlMatch ? urlMatch[2] : null;
            const timeElement = element.querySelector('time');
            postTime = timeElement
              ? timeElement.getAttribute('datetime')
              : null;
            break;
          }
        });

        // Fallback: try time[datetime] approach (used in retrieveItem)
        if (!commentId) {
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
        }

        await new Promise(resolve => setTimeout(resolve, 10000));

        if (textContent) {
          try {
            const getComments = await cleanText(textContent);
            results.push({ commentId, getComments, username, postTime });
          } catch (error) {
            console.error('Error processing comment:', error);
          }
        }
      }),
    );

    return results;
  }, getCleanTextFnString());

  return details;
}

/**
 * Find a specific comment in extracted details by text match
 * @param {Array} commentDetails - array from extractCommentsFromPage
 * @param {string} commentText - the comment text to find (already cleaned)
 * @param {string} [username] - optional username to match
 * @returns {object|null} matching comment or null
 */
function findComment(commentDetails, commentText, username) {
  const trimmed = cleanText(commentText);
  return (
    commentDetails.find(item => {
      const textMatch = item.getComments
        .toLowerCase()
        .includes(trimmed.toLowerCase());
      if (username) {
        return textMatch && item.username === username;
      }
      return textMatch;
    }) || null
  );
}

/**
 * Convert postTime fields in comment details from ISO strings to timestamps
 * @param {Array} commentDetails
 * @returns {Promise<Array>}
 */
async function convertCommentTimestamps(commentDetails) {
  for (const item of commentDetails) {
    if (item.postTime) {
      item.postTime = convertToTimestamp(item.postTime);
    }
  }
  return commentDetails;
}

module.exports = {
  extractCommentsFromPage,
  findComment,
  convertCommentTimestamps,
  getCleanTextFnString,
};
