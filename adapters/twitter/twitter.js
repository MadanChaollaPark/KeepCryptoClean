// Twitter adapter — thin facade delegating to focused modules
const Adapter = require('../../model/adapter');
const Data = require('../../model/data');
const session = require('./session');
const { search } = require('./crawler');
const { verify } = require('./verifier');
const { getSubmissionCID } = require('./submission');
const { extractTweetData } = require('./tweet-parser');
const { postComment, getAndVerifyComment } = require('./comment-poster');
const { randomDelay } = require('./utils');

/**
 * Twitter
 * @class
 * @extends Adapter
 * @description
 * Provides a searcher interface for the data gatherer nodes to use to interact with Twitter.
 * All heavy lifting is delegated to sub-modules under adapters/twitter/.
 */
class Twitter extends Adapter {
  constructor(credentials, db, maxRetry) {
    super(credentials, maxRetry);
    this.credentials = credentials;
    this.db = new Data('db', []);
    this.db.initializeData();
    this.proofs = new Data('proofs', []);
    this.proofs.initializeData();
    this.cids = new Data('cids', []);
    this.cids.initializeData();
    this.commentsDB = new Data('comment', []);
    this.commentsDB.initializeData();
    this.searchTerm = [];
    this.lastSessionCheck = null;
    this.sessionValid = false;
    this.browser = null;
    this.round = null;
    this.maxRetry = maxRetry;
    this.comment = '';
    this.username = '';
  }

  checkSession = async () => {
    return session.checkSession(this);
  };

  negotiateSession = async () => {
    return session.negotiateSession(this);
  };

  /**
   * parseItem — parse a single tweet article, post a comment, and return data.
   * Kept as an instance method because tests call adapter.parseItem() directly.
   */
  parseItem = async (item, url, currentPage, currentBrowser) => {
    if (!this.sessionValid) {
      await this.negotiateSession();
    }

    try {
      const tweetData = await extractTweetData(item);
      if (!tweetData) return {};

      await currentPage.waitForTimeout(randomDelay(4000));

      const commentPage = await currentBrowser.newPage();
      const getNewPageUrl = `${url}/status/${tweetData.tweets_id}`;
      await commentPage.goto(getNewPageUrl);
      await commentPage.waitForTimeout(randomDelay(3000));
      await commentPage.evaluate(() => window.focus());
      await commentPage.bringToFront();
      await commentPage.waitForTimeout(randomDelay(8000));

      // Check if already commented
      const checkComments = await getAndVerifyComment(
        currentBrowser,
        getNewPageUrl,
        this.comment,
        this.username,
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
      await postComment(commentPage, this.comment);

      // Verify comment was posted
      const getCommentDetailsObject = await getAndVerifyComment(
        currentBrowser,
        getNewPageUrl,
        this.comment,
        this.username,
      );

      await commentPage.waitForTimeout(randomDelay(8000));
      await commentPage.close();
      await new Promise(resolve => setTimeout(resolve, randomDelay(8000)));

      if (
        !getCommentDetailsObject ||
        Object.keys(getCommentDetailsObject).length === 0
      ) {
        return {};
      }

      if (tweetData.screen_name && tweetData.tweets_content) {
        return {
          ...tweetData,
          keyword: this.searchTerm,
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
  };

  search = async query => {
    return search(this, query);
  };

  getSubmissionCID = async round => {
    return getSubmissionCID(this, round);
  };

  verify = async (inputItem, round) => {
    return verify(this, inputItem, round);
  };

  stop = async () => {
    if (this.browser) {
      await this.browser.close();
      console.log('Old browser closed');
    }
    return (this.break = true);
  };
}

module.exports = Twitter;
