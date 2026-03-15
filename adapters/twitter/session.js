const PCR = require('puppeteer-chromium-resolver');
const path = require('path');
const fs = require('fs');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const logger = require('../../lib/logger');
const { TwitterAuthError, BrowserError } = require('../../lib/errors');
const { withRetry } = require('../../lib/retry');
const { encrypt, decrypt } = require('../../lib/crypto');
const { sleep, randomDelay, SELECTORS, USER_AGENT, BROWSER_ARGS } = require('./utils');

class SessionManager {
  constructor(credentials, db, maxRetry = 3) {
    this.credentials = credentials;
    this.db = db;
    this.maxRetry = maxRetry;
    this.browser = null;
    this.page = null;
    this.sessionValid = false;
    this.lastSessionCheck = null;
  }

  async checkSession() {
    if (this.sessionValid) {
      return true;
    }
    if (this.lastSessionCheck && Date.now() - this.lastSessionCheck > 50000) {
      await this.negotiateSession();
      return true;
    }
    return false;
  }

  async negotiateSession() {
    try {
      await this.closeBrowser();

      const stats = await PCR({});
      logger.info('Launching browser via Puppeteer Chromium Resolver');

      const userDataDir = path.join(__dirname, 'puppeteer_cache_AIC_twitter_archive');
      this.browser = await stats.puppeteer.launch({
        executablePath: stats.executablePath,
        userDataDir,
        userAgent: USER_AGENT,
        args: BROWSER_ARGS,
      });

      this.page = await this.browser.newPage();
      await this.page.setUserAgent(USER_AGENT);
      await sleep(randomDelay(3000));
      await this.page.setViewport({ width: 1920, height: 1080 });
      await sleep(randomDelay(3000));
      await this.twitterLogin(this.page, this.browser);
      return true;
    } catch (e) {
      logger.error({ err: e }, 'Failed to negotiate session');
      throw new BrowserError('Failed to negotiate session', { cause: e });
    }
  }

  async twitterLogin(currentPage, currentBrowser) {
    const cookieLoginSuccess = await this.tryLoginWithCookies(currentPage);
    if (cookieLoginSuccess) {
      this.sessionValid = true;
      return true;
    }

    for (let attempt = 0; attempt < this.maxRetry; attempt++) {
      try {
        logger.info({ attempt: attempt + 1, maxRetry: this.maxRetry }, 'Attempting Twitter login');

        await currentPage.goto('https://x.com/i/flow/login', {
          timeout: randomDelay(60000),
          waitUntil: 'networkidle0',
        });

        let basePath = await namespaceWrapper.getBasePath();
        const bodyHTML = await currentPage.evaluate(() => document.body.outerHTML);
        fs.writeFileSync(`${basePath}/bodyHTML.html`, bodyHTML);

        await currentPage.waitForSelector('input', { timeout: randomDelay(60000) });
        const usernameHTML = await currentPage.$eval('input', el => el.outerHTML);
        fs.writeFileSync(`${basePath}/usernameHTML.html`, usernameHTML);

        await currentPage.waitForSelector(SELECTORS.USERNAME_INPUT, {
          timeout: randomDelay(60000),
        });

        logger.info('Entering username');
        await currentPage.type(SELECTORS.USERNAME_INPUT, this.credentials.username);
        await currentPage.keyboard.press('Enter');
        await sleep(8000);

        // Handle phone verification if needed
        const twitterVerify = await currentPage
          .waitForSelector(SELECTORS.VERIFY_INPUT, {
            timeout: randomDelay(5000),
            visible: true,
          })
          .then(() => true)
          .catch(() => false);

        if (twitterVerify) {
          logger.info('Phone verification required');
          await currentPage.type(SELECTORS.VERIFY_INPUT, this.credentials.phone);
          await currentPage.keyboard.press('Enter');
          await sleep(3000);
        }

        const passwordHTML = await currentPage.$$eval('input', elements =>
          elements.map(el => el.outerHTML).join('\n'),
        );
        fs.writeFileSync(`${basePath}/passwordHTML.html`, passwordHTML);

        await currentPage.waitForSelector(SELECTORS.PASSWORD_INPUT);
        logger.info('Entering password');
        await currentPage.type(SELECTORS.PASSWORD_INPUT, this.credentials.password);
        await currentPage.keyboard.press('Enter');
        await sleep(randomDelay(8000));

        if (!(await this._checkLogin(currentBrowser))) {
          logger.warn('Login check failed: incorrect password or email verification needed');
          await sleep(randomDelay(5000));
          this.sessionValid = false;
          throw new TwitterAuthError('Login failed: incorrect credentials or verification needed');
        }

        if (await this._isEmailVerificationRequired(currentPage)) {
          logger.warn('Email verification required');
          this.sessionValid = false;
          throw new TwitterAuthError('Email verification required');
        }

        logger.info('Login successful');
        currentPage.waitForNavigation({ waitUntil: 'load' }).catch(() => {});
        await sleep(randomDelay(10000));

        this.sessionValid = true;
        this.lastSessionCheck = Date.now();

        const cookies = await currentPage.cookies();
        await this._saveCookiesToDB(cookies);

        return true;
      } catch (e) {
        if (e instanceof TwitterAuthError) {
          throw e;
        }
        logger.error(
          { attempt: attempt + 1, maxRetry: this.maxRetry, err: e },
          'Login attempt failed',
        );
        if (attempt === this.maxRetry - 1) {
          throw new TwitterAuthError(`Login failed after ${this.maxRetry} attempts`, { cause: e });
        }
      }
    }
  }

  async tryLoginWithCookies(currentPage) {
    try {
      const cookieRecord = await this.db.getItem({ id: 'cookies' });
      if (!cookieRecord || !cookieRecord[0]) {
        logger.info('No stored cookies found');
        return false;
      }

      let cookieData = cookieRecord[0].data || cookieRecord.data;
      if (!cookieData || cookieData.length === 0) {
        logger.info('Empty cookie data');
        return false;
      }

      // Attempt decryption (support both encrypted and legacy plaintext cookies)
      if (typeof cookieData === 'string') {
        try {
          cookieData = decrypt(cookieData);
        } catch {
          logger.warn('Cookie decryption failed; treating as legacy plaintext');
        }
      }

      await currentPage.setCookie(...cookieData);
      await currentPage.goto('https://x.com/home');
      await sleep(randomDelay(5000));

      const currentUrl = await currentPage.url();
      const isLoggedIn =
        currentUrl !== 'https://x.com/i/flow/login?redirect_after_login=%2Fhome' &&
        !currentUrl.includes('https://x.com/?logout=');

      if (isLoggedIn) {
        logger.info('Logged in using stored cookies');
        const freshCookies = await currentPage.cookies();
        await this._saveCookiesToDB(freshCookies);
        this.sessionValid = true;
        return true;
      }

      logger.info('Stored cookies are invalid, manual login required');
      this.sessionValid = false;
      return false;
    } catch (e) {
      logger.warn({ err: e }, 'Cookie login attempt failed');
      return false;
    }
  }

  async _checkLogin(currentBrowser) {
    let newPage;
    try {
      newPage = await currentBrowser.newPage();
      await sleep(randomDelay(3000));
      await newPage.goto('https://x.com/home');
      await sleep(randomDelay(5000));

      const currentUrl = await newPage.url();
      const isLoggedIn =
        currentUrl !== 'https://x.com/i/flow/login?redirect_after_login=%2Fhome' &&
        !currentUrl.includes('https://x.com/?logout=');

      this.sessionValid = isLoggedIn;

      if (isLoggedIn) {
        logger.info('Login verification passed');
      } else {
        logger.warn('Login verification failed');
      }

      return this.sessionValid;
    } finally {
      if (newPage) {
        try {
          await sleep(randomDelay(3000));
          await newPage.close();
        } catch {
          // page already closed
        }
      }
    }
  }

  async _isEmailVerificationRequired(currentPage) {
    await sleep(randomDelay(5000));
    const textContent = await currentPage.evaluate(() => document.body.textContent);
    return textContent.includes(
      'Verify your identity by entering the email address associated with your X account.',
    );
  }

  async _saveCookiesToDB(cookies) {
    try {
      const encryptedCookies = encrypt(cookies);
      const existingData = await this.db.getItem({ id: 'cookies' });
      if (existingData && existingData[0]) {
        await this.db.updateCookie({ id: 'cookies', data: encryptedCookies });
      } else {
        await this.db.create({ id: 'cookies', data: encryptedCookies });
      }
      logger.debug('Cookies saved to database (encrypted)');
    } catch (e) {
      logger.error({ err: e }, 'Failed to save cookies');
    }
  }

  async createNewPage() {
    return withRetry(
      async () => {
        if (!this.browser) throw new BrowserError('Browser not initialized');
        return await this.browser.newPage();
      },
      { maxRetries: 3, label: 'createNewPage' },
    );
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Browser closed');
      } catch (e) {
        logger.warn({ err: e }, 'Error closing browser');
      }
      this.browser = null;
      this.page = null;
    }
  }

  async close() {
    this.sessionValid = false;
    await this.closeBrowser();
  }
}

module.exports = SessionManager;
