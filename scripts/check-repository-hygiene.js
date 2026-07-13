'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    console.error('Repository hygiene check requires a Git checkout.');
    console.error(error.message);
    process.exit(2);
  }
}

const forbiddenPaths = [
  {
    pattern: /(^|\/)\.env(\.|$)/i,
    except: new Set(['.env.sample']),
    reason: 'environment file',
  },
  {
    pattern:
      /(^|\/)(puppeteer_cache[^/]*|chrome-profile|chromium-profile|user-data)(\/|$)/i,
    reason: 'browser profile directory',
  },
  {
    pattern:
      /(^|\/)(cookies(?:-journal)?|login data(?: for account)?|web data|history|sessions?)$/i,
    reason: 'browser credential/session database',
  },
  {
    pattern:
      /(^|\/)(localKOIIDB(?:\.db)?|twitter-db|my_test_db|dataList\.json|bodyHTML\.html|passwordHTML\.html|usernameHTML\.html)(\/|$)/i,
    reason: 'runtime database or diagnostic dump',
  },
  {
    pattern: /\.(db|sqlite|sqlite3|pem|p12|pfx|key)$/i,
    reason: 'database or private-key material',
  },
  {
    pattern: /(^|\/)(wallet|keypair|secret-key)\.json$/i,
    reason: 'wallet or keypair material',
  },
];

const secretPatterns = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'private key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, reason: 'GitHub token' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key' },
  { pattern: /\bnpm_[A-Za-z0-9]{30,}\b/, reason: 'npm token' },
];

const credentialAssignment =
  /^\s*(?:export\s+)?(TWITTER_PASSWORD|COOKIE_ENCRYPTION_KEY|X_API_BEARER_TOKEN|X_API_USER_ACCESS_TOKEN|PRIVATE_KEY|SECRET_KEY|API_SECRET)\s*[:=]\s*(.+?)\s*$/i;

function isPlaceholder(rawValue) {
  const value = rawValue
    .replace(/\s+#.*$/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();

  return (
    value === '' ||
    /^(?:<.*>|\$\{.*\}|your[-_ ]|replace[-_ ]|example[-_ ]|changeme|redacted)/i.test(
      value,
    )
  );
}

const violations = [];

for (const relativePath of trackedFiles()) {
  const normalizedPath = relativePath.replaceAll('\\', '/');

  for (const rule of forbiddenPaths) {
    if (
      rule.pattern.test(normalizedPath) &&
      !(rule.except && rule.except.has(normalizedPath))
    ) {
      violations.push(`${relativePath}: tracked ${rule.reason}`);
    }
  }

  const absolutePath = path.join(root, relativePath);
  let contents;
  try {
    contents = fs.readFileSync(absolutePath);
  } catch {
    continue;
  }

  // Skip binary files. Path rules above still apply to them.
  if (contents.includes(0)) continue;
  const text = contents.toString('utf8');

  for (const rule of secretPatterns) {
    if (rule.pattern.test(text)) {
      violations.push(`${relativePath}: contains a possible ${rule.reason}`);
    }
  }

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const assignment = credentialAssignment.exec(line);
    if (assignment && !isPlaceholder(assignment[2])) {
      violations.push(
        `${relativePath}:${lineIndex + 1}: non-placeholder value for ${assignment[1]}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const violation of [...new Set(violations)]) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Repository hygiene check passed.');
