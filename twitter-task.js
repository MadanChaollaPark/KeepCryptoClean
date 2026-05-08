/**
 * TwitterTask — per-round wrapper around the Twitter adapter.
 *
 * One instance is created at the start of each round in `coreLogic.task()`.
 * It owns:
 *   - the Twitter adapter (browser + login)
 *   - the local NeDB database used to stage submission data
 *   - the search term and comment for this round (fetched from the
 *     middleware service, with a fallback to `couch_comments.json`)
 *
 * After construction it kicks off the crawl asynchronously via `start()`.
 * Other phases later call `getRoundCID()` and `validate()` on the same
 * instance.
 */
const Twitter = require('./adapters/twitter/twitter.js');
const Data = require('./model/data');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const dotenv = require('dotenv');
const { CID } = require('multiformats/cid');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const { default: axios } = require('axios');
const logger = require('./lib/logger');
const { ValidationError } = require('./lib/errors');
const { withRetry } = require('./lib/retry');

dotenv.config();

/** True if `cid` parses as a valid IPFS Content Identifier. */
async function isValidCID(cid) {
  try {
    CID.parse(cid);
    return true;
  } catch {
    return false;
  }
}

class TwitterTask {
  constructor(round) {
    this.round = round;
    this.lastRoundCheck = Date.now();
    this.isRunning = false;
    this.searchTerm = [];
    this.adapter = null;
    this.comment = '';
    this.username = '';
    this.db = new Data('db', []);
    this.db.initializeData();
    this.initialize();

    this.setAdapter = async () => {
      const username = process.env.TWITTER_USERNAME;
      const password = process.env.TWITTER_PASSWORD;
      const phone = process.env.TWITTER_PHONE;

      if (!username || !password) {
        throw new Error(
          'Environment variables TWITTER_USERNAME and/or TWITTER_PASSWORD are not set',
        );
      }

      this.username = username;
      this.adapter = new Twitter({ username, password, phone }, this.db, 3);
      await this.adapter.negotiateSession();
    };

    this.start();
  }

  /**
   * Fetch this round's search term + comment, persist them to the local
   * database, and stash them on the instance.
   */
  async initialize() {
    try {
      logger.info('Initializing Twitter task');
      const { comment, search } = await this.fetchSearchTerms();
      this.comment = comment;
      this.searchTerm = search;

      logger.info(
        { searchTerm: this.searchTerm, round: this.round },
        'Crawler configured',
      );
      this.db.createSearchTerm(this.searchTerm, this.round, this.comment);
    } catch (error) {
      throw new Error('Failed to initialize Twitter task: ' + error.message);
    }
  }

  /**
   * Ask the local middleware (`http://localhost:3000/keywords`) for a comment
   * keyed off this node's submitter public key. Falls back to a random entry
   * from `couch_comments.json` when the middleware is unreachable.
   *
   * The search term is currently hard-coded to the target X handle.
   *
   * @returns {Promise<{ comment: string, search: string }>}
   */
  async fetchSearchTerms() {
    let keyword;
    try {
      const submitterAccountKeyPair = (
        await namespaceWrapper.getSubmitterAccount()
      ).publicKey;
      const key = submitterAccountKeyPair.toBase58();
      logger.info({ key }, 'Fetching keywords from middleware');

      const response = await axios.get('http://localhost:3000/keywords', {
        params: { key },
        timeout: 10000,
      });
      logger.info({ keywords: response.data }, 'Keywords received');
      keyword = response.data;
    } catch (error) {
      logger.warn({ err: error.message }, 'Middleware unavailable; using fallback comments');
      const wordsList = require('./couch_comments.json');
      const randomIndex = Math.floor(Math.random() * wordsList.length);
      keyword = wordsList[randomIndex];
    }

    return { comment: keyword, search: 'JDVance' };
  }

  /** Negotiate a Twitter session and kick off the profile crawl. */
  async start() {
    await this.setAdapter();
    this.isRunning = true;

    const query = {
      limit: 100,
      searchTerm: this.searchTerm,
      query: `https://x.com/${this.searchTerm}`,
      comment: `${this.comment}`,
      depth: 3,
      round: this.round,
      recursive: true,
      username: this.username,
    };

    this.adapter.search(query);
  }

  /** Tear the adapter down and mark the task as not running. */
  async stop() {
    this.isRunning = false;
    await this.adapter.stop();
  }

  /**
   * Bundle this round's collected data, upload it to IPFS, and return the
   * resulting CID. Delegates to `Twitter.getSubmissionCID`.
   */
  async getRoundCID(roundID) {
    logger.info({ round: roundID }, 'Preparing round submission');
    const result = await this.adapter.getSubmissionCID(roundID);
    logger.info({ cid: result, round: roundID }, 'Round CID ready');
    return result;
  }

  /** Fetch and parse the dataList.json blob behind a submission CID. */
  async getJSONofCID(cid) {
    return getJSONFromCID(cid, 'dataList.json');
  }

  /**
   * Validate another node's submission.
   *
   * Steps:
   *   1. Fetch their dataList.json from IPFS.
   *   2. Reject empty payloads.
   *   3. Count duplicate tweet IDs (logged when over threshold).
   *   4. Spot-check a small random sample (5% of items, capped at 5)
   *      against the live X page. The submission passes only when every
   *      sampled item verifies.
   *
   * Returns `false` on any error so we don't accidentally vote for invalid
   * data.
   *
   * @param {string} proofCid - the candidate's submission CID
   * @param {number} round
   * @returns {Promise<boolean>}
   */
  async validate(proofCid, round) {
    try {
      const data = await getJSONFromCID(proofCid, 'dataList.json');

      if (!data || data.length === 0) {
        logger.warn({ proofCid }, 'No data from proof CID');
        return false;
      }

      // Check for duplicate IDs
      const idSet = new Set();
      let duplicatedIDNumber = 0;
      for (const item of data) {
        if (idSet.has(item.id)) {
          duplicatedIDNumber += 1;
        }
        idSet.add(item.id);
      }

      if (duplicatedIDNumber > 10) {
        logger.warn(
          { duplicatedIDNumber },
          'High number of duplicate IDs detected',
        );
      } else {
        logger.info({ duplicatedIDNumber }, 'Duplicate ID check passed');
      }

      // Validate a sample of items
      const proofThreshold = Math.min(Math.max(Math.ceil(data.length * 0.05), 1), 5);
      let passedNumber = 0;

      for (let i = 0; i < proofThreshold; i++) {
        const randomIndex = Math.floor(Math.random() * data.length);
        const item = data[randomIndex];

        logger.info({ index: i, itemId: item.id }, 'Checking item');

        if (!item.id) {
          logger.warn({ itemId: item.id }, 'Invalid item ID');
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, 30000));
        const result = await this.adapter.verify(item.data, round);
        logger.info({ result, itemId: item.id }, 'Verification result');

        if (result) {
          passedNumber += 1;
        }
      }

      const passed = passedNumber >= proofThreshold;
      logger.info(
        { passedNumber, proofThreshold, passed },
        'Validation complete',
      );
      return passed;
    } catch (e) {
      logger.error({ err: e }, 'Error in validation');
      return false;
    }
  }
}

module.exports = TwitterTask;

/**
 * Download `fileName` from the IPFS object identified by `cid` and parse it
 * as JSON. Retries up to `retries` times with exponential backoff.
 *
 * @param {string} cid       IPFS Content Identifier
 * @param {string} fileName  file inside the IPFS object (e.g. "dataList.json")
 * @param {number} [retries] retry budget passed to lib/retry
 */
const getJSONFromCID = async (cid, fileName, retries = 3) => {
  const validateCID = await isValidCID(cid);
  if (!validateCID) {
    logger.warn({ cid }, 'Invalid CID');
    return null;
  }

  return withRetry(
    async () => {
      const client = new KoiiStorageClient(undefined, undefined, false);
      const blob = await client.getFile(cid, fileName);
      const text = await blob.text();
      return JSON.parse(text);
    },
    {
      maxRetries: retries,
      baseDelayMs: 3000,
      label: 'getJSONFromCID',
    },
  );
};
