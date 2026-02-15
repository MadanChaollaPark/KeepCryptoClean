// Unified Cheerio-based tweet data extraction
// Deduplicates logic previously in parseItem and retrieveItem

const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const { SELECTORS, SALT_ROUNDS } = require('./constants');
const { convertToTimestamp } = require('./utils');

/**
 * Extract structured tweet data from raw HTML using Cheerio
 * @param {string} html - outer HTML of the article element
 * @param {number} [round] - optional round override; defaults to namespaceWrapper.getRound()
 * @returns {Promise<object>} parsed tweet data
 */
async function extractTweetData(html, round) {
  const $ = cheerio.load(html);
  const articles = $(SELECTORS.TWEET_ARTICLE).toArray();
  const el = articles[0];
  if (!el) return null;

  const tweetUrl = $('a[href*="/status/"]').attr('href');
  if (!tweetUrl) return null;
  const tweetId = tweetUrl.split('/').pop();

  const screen_name = $(el).find(SELECTORS.TAB_INDEX_LINK).text();
  const allText = $(el).find(SELECTORS.ROLE_LINK).text();
  const user_name = allText.split('@')[0];
  const user_url = 'https://x.com' + $(el).find(SELECTORS.ROLE_LINK).attr('href');
  const user_img = $(el).find(SELECTORS.DRAGGABLE_IMG).attr('src');
  const tweet_text = $(el).find(SELECTORS.TWEET_TEXT).first().text();
  const timeRaw = $(el).find(SELECTORS.TIME).attr('datetime');
  const time = convertToTimestamp(timeRaw);

  const tweets_content = tweet_text.replace(/\n/g, '<br>');
  const currentRound = round !== undefined ? round : namespaceWrapper.getRound();
  const originData = tweets_content + currentRound;
  const salt = bcrypt.genSaltSync(SALT_ROUNDS);
  const hash = bcrypt.hashSync(originData, salt);

  return {
    user_name,
    screen_name,
    user_url,
    user_img,
    tweets_id: tweetId,
    tweets_content,
    time_post: time,
    hash,
    round: currentRound,
  };
}

module.exports = { extractTweetData };
