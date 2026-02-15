// Session management: login, cookies, session checking
// Extracted from twitter.js — process.exit(1) replaced with thrown errors

const fs = require('fs');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const {
  SELECTORS,
  URLS,
  DELAYS,
  EMAIL_VERIFICATION_TEXT,
  MAX_CREATE_PAGE_RETRIES,
} = require('./constants');
const { randomDelay } = require('./utils');

/**
 * Check if the session is still valid, re-negotiate if stale
 * @param {object} ctx - the Twitter instance (this)
 * @returns {Promise<boolean>}
 */
async function checkSession(ctx) {
  if (ctx.sessionValid) {
    return true;
  } else if (Date.now() - ctx.lastSessionCheck > DELAYS.SESSION_CHECK_INTERVAL) {
    await negotiateSession(ctx);
    return true;
  }
  return false;
}

/**
 * Launch a browser and log in
 * @param {object} ctx - the Twitter instance
 * @returns {Promise<boolean>}
 */
async function negotiateSession(ctx) {
  const { createBrowser } = require('./browser-factory');
  const { CACHE_DIR_SESSION, VIEWPORT_DEFAULT } = require('./constants');

  try {
    if (ctx.browser) {
      await ctx.browser.close();
      console.log('Old browser closed');
    }
    const { browser, page } = await createBrowser(
      CACHE_DIR_SESSION,
      VIEWPORT_DEFAULT,
    );
    ctx.browser = browser;
    ctx.page = page;
    await twitterLogin(ctx, ctx.page, ctx.browser);
    return true;
  } catch (e) {
    console.log('Error negotiating session', e);
    return false;
  }
}

/**
 * Attempt Twitter login with retries
 * @param {object} ctx - the Twitter instance
 * @param {object} currentPage - Puppeteer page
 * @param {object} currentBrowser - Puppeteer browser
 * @returns {Promise<boolean>}
 */
async function twitterLogin(ctx, currentPage, currentBrowser) {
  let currentAttempt = 0;
  const cookieLoginSuccess = await tryLoginWithCookies(ctx, currentPage);
  if (cookieLoginSuccess) {
    ctx.sessionValid = true;
    return ctx.sessionValid;
  }

  while (currentAttempt < ctx.maxRetry && !ctx.sessionValid) {
    try {
      console.log(currentAttempt, ctx.maxRetry);
      console.log('Step: Go to login page');
      await currentPage.goto(URLS.LOGIN, {
        timeout: randomDelay(DELAYS.PAGE_LOAD),
        waitUntil: 'networkidle0',
      });

      let basePath = await namespaceWrapper.getBasePath();
      console.log('Waiting for login page to load');

      const bodyHTML = await currentPage.evaluate(
        () => document.body.outerHTML,
      );
      fs.writeFileSync(`${basePath}/bodyHTML.html`, bodyHTML);

      await currentPage.waitForSelector(SELECTORS.INPUT, {
        timeout: randomDelay(DELAYS.PAGE_LOAD),
      });
      const usernameHTML = await currentPage.$eval(
        SELECTORS.INPUT,
        el => el.outerHTML,
      );
      fs.writeFileSync(`${basePath}/usernameHTML.html`, usernameHTML);

      await currentPage.waitForSelector(SELECTORS.USERNAME_INPUT, {
        timeout: randomDelay(DELAYS.PAGE_LOAD),
      });

      console.log('Step: Fill in username');
      console.log(ctx.credentials.username);

      await currentPage.type(
        SELECTORS.USERNAME_INPUT,
        ctx.credentials.username,
      );
      await currentPage.keyboard.press('Enter');
      await new Promise(resolve => setTimeout(resolve, DELAYS.EXTRA_LONG));

      const twitter_verify = await currentPage
        .waitForSelector(SELECTORS.VERIFY_INPUT, {
          timeout: randomDelay(DELAYS.MEDIUM),
          visible: true,
        })
        .then(() => true)
        .catch(() => false);

      if (twitter_verify) {
        console.log('Twitter verify needed, trying phone number');
        console.log('Step: Fill in phone number');
        await currentPage.type(SELECTORS.VERIFY_INPUT, ctx.credentials.phone);
        await currentPage.keyboard.press('Enter');
        await new Promise(resolve => setTimeout(resolve, DELAYS.SHORT));
      }

      const passwordHTML = await currentPage.$$eval(
        SELECTORS.INPUT,
        elements => elements.map(el => el.outerHTML).join('\n'),
      );
      fs.writeFileSync(`${basePath}/passwordHTML.html`, passwordHTML);

      await currentPage.waitForSelector(SELECTORS.PASSWORD_INPUT);
      console.log('Step: Fill in password');
      await currentPage.type(
        SELECTORS.PASSWORD_INPUT,
        ctx.credentials.password,
      );
      console.log('Step: Click login button');
      await currentPage.keyboard.press('Enter');
      await currentPage.waitForTimeout(randomDelay(DELAYS.EXTRA_LONG));

      if (!(await checkLoginPage(currentBrowser))) {
        console.log('Password is incorrect or email verification needed.');
        await currentPage.waitForTimeout(randomDelay(DELAYS.MEDIUM));
        ctx.sessionValid = false;
        throw new Error(
          'Login failed: password is incorrect or email verification needed',
        );
      } else if (await isEmailVerificationRequired(currentPage)) {
        console.log('Email verification required.');
        ctx.sessionValid = false;
        await currentPage.waitForTimeout(randomDelay(DELAYS.VERY_LONG));
        throw new Error('Login failed: email verification required');
      } else {
        console.log('Password is correct.');
        currentPage.waitForNavigation({ waitUntil: 'load' });
        await currentPage.waitForTimeout(randomDelay(DELAYS.VERY_LONG));

        ctx.sessionValid = true;
        ctx.lastSessionCheck = Date.now();

        console.log('Step: Login successful');

        const cookies = await currentPage.cookies();
        await saveCookiesToDB(ctx, cookies);
      }
      return ctx.sessionValid;
    } catch (e) {
      console.log(
        `Error logging in, retrying ${currentAttempt + 1} of ${ctx.maxRetry}`,
        e,
      );
      currentAttempt++;

      if (currentAttempt === ctx.maxRetry) {
        console.log('Max retry reached');
        throw new Error(
          `Login failed after ${ctx.maxRetry} attempts: ${e.message}`,
        );
      }
    }
  }
}

/**
 * Try to log in using saved cookies
 * @param {object} ctx - the Twitter instance
 * @param {object} currentPage
 * @returns {Promise<boolean>}
 */
async function tryLoginWithCookies(ctx, currentPage) {
  const cookies = await ctx.db.getItem({ id: 'cookies' });
  if (cookies && cookies.data && cookies.data.length > 0) {
    await currentPage.setCookie(...cookies);
    await currentPage.goto(URLS.HOME);
    await currentPage.waitForTimeout(randomDelay(DELAYS.MEDIUM));

    const pageUrl = await currentPage.url();
    const isLoggedIn =
      pageUrl !== URLS.LOGIN_REDIRECT && !pageUrl.includes(URLS.LOGOUT_PREFIX);

    if (isLoggedIn) {
      console.log('Logged in using existing cookies');
      console.log('Updating last session check');
      const freshCookies = await currentPage.cookies();
      saveCookiesToDB(ctx, freshCookies);
      ctx.sessionValid = true;
    } else {
      console.log('No valid cookies found, proceeding with manual login');
      ctx.sessionValid = false;
    }
    return ctx.sessionValid;
  }
  console.log('No cookies found');
  return false;
}

/**
 * Open a new page and check if we're logged in
 * @param {object} currentBrowser
 * @returns {Promise<boolean>}
 */
async function checkLoginPage(currentBrowser) {
  const newPage = await currentBrowser.newPage();
  await newPage.waitForTimeout(randomDelay(DELAYS.SHORT));
  await newPage.goto(URLS.HOME);
  await newPage.waitForTimeout(randomDelay(DELAYS.MEDIUM));

  const pageUrl = await newPage.url();
  const isLoggedIn =
    pageUrl !== URLS.LOGIN_REDIRECT && !pageUrl.includes(URLS.LOGOUT_PREFIX);

  if (isLoggedIn) {
    console.log('Logged in using existing cookies');
    console.log('Updating last session check');
  } else {
    console.log('No valid cookies found, proceeding with manual login');
  }

  await newPage.waitForTimeout(randomDelay(DELAYS.SHORT));
  await newPage.close();
  await new Promise(resolve => setTimeout(resolve, randomDelay(DELAYS.SHORT)));
  return isLoggedIn;
}

/**
 * Check if the page is asking for email verification
 * @param {object} currentPage
 * @returns {Promise<boolean>}
 */
async function isEmailVerificationRequired(currentPage) {
  await currentPage.waitForTimeout(randomDelay(DELAYS.MEDIUM));
  const textContent = await currentPage.evaluate(
    () => document.body.textContent,
  );
  return textContent.includes(EMAIL_VERIFICATION_TEXT);
}

/**
 * Create a new page with retry
 * @param {object} ctx - the Twitter instance
 * @returns {Promise<object|null>}
 */
async function createNewPage(ctx) {
  let currentAttempt = 0;
  while (currentAttempt < MAX_CREATE_PAGE_RETRIES) {
    try {
      return await ctx.browser.newPage();
    } catch (e) {
      console.log('Error creating new page', e);
      currentAttempt++;
    }
  }
  return null;
}

/**
 * Save cookies to the database
 * @param {object} ctx - the Twitter instance
 * @param {Array} cookies
 */
async function saveCookiesToDB(ctx, cookies) {
  try {
    const data = await ctx.db.getItem({ id: 'cookies' });
    if (data && data.data) {
      await ctx.db.updateCookie({ id: 'cookies', data: cookies });
    } else {
      await ctx.db.create({ id: 'cookies', data: cookies });
    }
  } catch (e) {
    console.log('Error saving cookies to database', e);
  }
}

module.exports = {
  checkSession,
  negotiateSession,
  twitterLogin,
  tryLoginWithCookies,
  checkLoginPage,
  isEmailVerificationRequired,
  createNewPage,
  saveCookiesToDB,
};
