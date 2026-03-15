const Adapter = require('../../model/adapter');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const Data = require('../../model/data');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const fs = require('fs');
const logger = require('../../lib/logger');
const { withRetry } = require('../../lib/retry');
const { NetworkError } = require('../../lib/errors');
const SessionManager = require('./session');
const { fetchList } = require('./crawler');
const { verify: verifyItem } = require('./verifier');

/**
 * Twitter adapter - thin orchestrator that delegates to focused modules.
 *
 * Modules:
 *   session.js   - browser lifecycle, login, cookie management
 *   crawler.js   - tweet fetching, scrolling, parsing
 *   commenter.js - comment posting, human-like typing
 *   verifier.js  - audit verification of posted comments
 *   utils.js     - shared helpers, constants, selectors
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

    this.session = new SessionManager(credentials, this.db, maxRetry);
    this.searchTerm = [];
    this.round = null;
    this.comment = '';
    this.username = '';
  }

  checkSession = async () => {
    return this.session.checkSession();
  };

  negotiateSession = async () => {
    return this.session.negotiateSession();
  };

  /**
   * Main entry point: search a profile and post comments on tweets.
   */
  search = async query => {
    logger.info({ sessionValid: this.session.sessionValid }, 'Starting search');

    if (!this.session.sessionValid) {
      await this.session.negotiateSession();
    }

    this.searchTerm = query.searchTerm;
    this.round = query.round;
    this.comment = query.comment;

    // Resolve username if login was via email
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (emailRegex.test(query.username)) {
      this.username = await this._resolveUsername();
      if (!this.username) {
        logger.error('Failed to resolve username from email login');
        return;
      }
    } else {
      this.username = query.username;
    }

    await fetchList(this.session.page, this.session.browser, {
      url: query.query,
      round: query.round,
      comment: query.comment,
      username: this.username,
      searchTerm: query.searchTerm,
      db: this.db,
      cids: this.cids,
      commentsDB: this.commentsDB,
      checkSession: () => this.session.checkSession(),
    });
  };

  /**
   * Resolve the logged-in username when authenticated via email.
   */
  async _resolveUsername() {
    const page = this.session.page;
    const { randomDelay, sleep } = require('./utils');

    await sleep(randomDelay(6000));
    await page.goto('https://x.com/home');
    await sleep(randomDelay(6000));

    const loggedInUsername = await page.evaluate(() => {
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
      let username = elements.length > 0 ? extractUsername(elements[0]) : null;
      if (!username && elements.length > 1) {
        username = extractUsername(elements[1]);
      }
      return username || null;
    });

    await sleep(randomDelay(6000));
    return loggedInUsername;
  }

  /**
   * Upload round data to IPFS and return the CID.
   */
  getSubmissionCID = async round => {
    if (!this.proofs) {
      throw new Error('No proofs database provided');
    }

    const data = await this.cids.getList({ round });
    logger.info({ round, itemCount: data?.length || 0 }, 'Preparing submission');

    if (!data || data.length === 0) {
      logger.warn({ round }, 'No data found for round');
      return null;
    }

    const basePath = await namespaceWrapper.getBasePath();
    const filePath = `${basePath}/dataList.json`;
    fs.writeFileSync(filePath, JSON.stringify(data));

    return withRetry(
      async () => {
        const client = new KoiiStorageClient(undefined, undefined, false);
        const userStaking = await namespaceWrapper.getSubmitterAccount();
        logger.info({ filePath }, 'Uploading to IPFS');

        const fileUploadResponse = await client.uploadFile(filePath, userStaking);
        const cid = fileUploadResponse.cid;

        await this.proofs.create({
          id: 'proof:' + round,
          proof_round: round,
          proof_cid: cid,
        });

        logger.info({ cid, round }, 'Submission CID ready');
        return cid;
      },
      {
        maxRetries: 3,
        baseDelayMs: 3000,
        label: 'IPFS upload',
        shouldRetry: err => !(err.message === 'Invalid Task ID'),
      },
    );
  };

  /**
   * Verify another node's submission item.
   */
  verify = async (inputItem, round) => {
    return verifyItem(inputItem, round, this.credentials, this.db);
  };

  stop = async () => {
    await this.session.close();
    return true;
  };
}

module.exports = Twitter;
