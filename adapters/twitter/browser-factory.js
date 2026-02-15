// Shared browser launch logic
// Deduplicates browser setup from negotiateSession and verify

const PCR = require('puppeteer-chromium-resolver');
const path = require('path');
const {
  USER_AGENT,
  BROWSER_ARGS,
  BROWSER_ARGS_AUDIT,
  CACHE_DIR_SESSION,
  CACHE_DIR_AUDIT,
  VIEWPORT_DEFAULT,
  VIEWPORT_AUDIT,
} = require('./constants');
const { randomDelay } = require('./utils');

/**
 * Create and launch a Puppeteer browser with standard configuration
 * @param {string} cacheDirName - name of the cache directory
 * @param {object} [viewport] - viewport size, defaults to VIEWPORT_DEFAULT
 * @returns {Promise<{browser: object, page: object}>}
 */
async function createBrowser(cacheDirName, viewport) {
  const userDataDir = path.join(__dirname, cacheDirName);
  const vp = viewport || VIEWPORT_DEFAULT;
  const args =
    cacheDirName === CACHE_DIR_AUDIT ? BROWSER_ARGS_AUDIT : BROWSER_ARGS;

  const stats = await PCR({});
  console.log(
    `*****************************************CALLED PURCHROMIUM RESOLVER (${cacheDirName})*****************************************`,
  );

  const browser = await stats.puppeteer.launch({
    executablePath: stats.executablePath,
    userDataDir: userDataDir,
    userAgent: USER_AGENT,
    args: args,
  });

  console.log('Step: Open new page');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.waitForTimeout(randomDelay(3000));
  await page.setViewport(vp);
  await page.waitForTimeout(randomDelay(3000));

  return { browser, page };
}

module.exports = { createBrowser };
