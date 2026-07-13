'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const nodeModules = path.join(root, 'node_modules');
const failures = [];
const warnings = [];
const strictRelease = process.argv.includes('--release');
let embeddedReleaseCommit = '';
const allowedCopyleft = new Set(['rpc-websockets@7.11.2|LGPL-3.0-only']);
const bundleNoticeName = 'THIRD_PARTY_BUNDLE_NOTICES.txt';
const beginMarker = 'BEGIN KEEPCRYPTOCLEAN BUNDLE LICENSE NOTICES';
const endMarker = 'END KEEPCRYPTOCLEAN BUNDLE LICENSE NOTICES';
const unresolvedKoiiPackages = new Set([
  '@_koii/namespace-wrapper@1.0.23',
  '@_koii/storage-task-sdk@1.2.8',
  '@_koii/task-manager@1.0.14',
]);
const requiredLicenseDigests = new Map([
  [
    'LICENSES/LGPL-3.0.txt',
    '996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1',
  ],
  [
    'LICENSES/GPL-3.0.txt',
    'fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0',
  ],
]);

function packageDirectories(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const child = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      results.push(...packageDirectories(child));
    } else if (fs.existsSync(path.join(child, 'package.json'))) {
      results.push(child);
      const nested = path.join(child, 'node_modules');
      if (fs.existsSync(nested)) results.push(...packageDirectories(nested));
    }
  }
  return results;
}

const copyleftPattern = /(?:^|[^A-Z])(A?GPL|LGPL|MPL|EPL|CDDL)-/i;
for (const directory of packageDirectories(nodeModules)) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
  );
  const license = typeof manifest.license === 'string' ? manifest.license : '';
  if (!copyleftPattern.test(license)) continue;
  const identity = `${manifest.name}@${manifest.version}|${license}`;
  if (!allowedCopyleft.has(identity)) {
    failures.push(`Unreviewed copyleft dependency: ${identity}`);
  }
}

const notice = fs.readFileSync(
  path.join(root, 'THIRD_PARTY_NOTICES.md'),
  'utf8',
);
const packageNotice = fs.readFileSync(
  path.join(root, 'LICENSES/rpc-websockets-LICENSE.txt'),
  'utf8',
);
for (const marker of ['rpc-websockets 7.11.2', 'LGPL-3.0-only']) {
  if (!notice.includes(marker))
    failures.push(`Third-party notice is missing ${marker}.`);
}
if (!packageNotice.includes('Elpheria j.d.o.o.')) {
  failures.push('rpc-websockets package license notice is incomplete.');
}
for (const [relativePath, expectedDigest] of requiredLicenseDigests) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Required license text is missing: ${relativePath}`);
    continue;
  }
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(absolutePath))
    .digest('hex');
  if (digest !== expectedDigest) {
    failures.push(`Required license text changed: ${relativePath}`);
  }
}

const artifact = path.join(root, 'dist/main.js');
if (!fs.existsSync(artifact)) {
  failures.push('dist/main.js is missing; run yarn build first.');
} else {
  const artifactBytes = fs.readFileSync(artifact);
  const text = artifactBytes.toString('utf8');
  const bundleNoticePath = path.join(root, 'dist', bundleNoticeName);
  if (!fs.existsSync(bundleNoticePath)) {
    failures.push(`dist/${bundleNoticeName} is missing.`);
  } else {
    const bundleNoticeBytes = fs.readFileSync(bundleNoticePath);
    const bundleNotice = bundleNoticeBytes.toString('utf8');
    const digest = crypto
      .createHash('sha256')
      .update(bundleNoticeBytes)
      .digest('hex');
    const expectedSuffix = Buffer.from(
      `\n/*! ${beginMarker}\nSHA-256: ${digest}\n${bundleNotice}${endMarker} */\n`,
    );
    if (
      artifactBytes.length < expectedSuffix.length ||
      !artifactBytes.subarray(-expectedSuffix.length).equals(expectedSuffix)
    ) {
      failures.push(
        'dist/main.js does not end with an exact digest-bound copy of the notice sidecar.',
      );
    }
    for (const marker of [
      'rpc-websockets@7.11.2 | LGPL-3.0-only',
      'Build-generated runtime: webpack@5.108.4 | MIT',
      'Source repository: https://github.com/MadanChaollaPark/KeepCryptoClean',
      'Rebuild/relink: yarn install --frozen-lockfile',
      '===== COMPLETE LGPL-3.0-ONLY TEXT =====',
      '===== COMPLETE GPL-3.0-ONLY TEXT REFERENCED BY LGPLV3 =====',
    ]) {
      if (!bundleNotice.includes(marker)) {
        failures.push(
          `Bundle notice is missing required marker: ${marker.slice(0, 80)}`,
        );
      }
    }

    for (const marker of [beginMarker, endMarker]) {
      const occurrences = text.split(marker).length - 1;
      if (occurrences !== 1) {
        failures.push(
          `dist/main.js must contain exactly one ${marker}; found ${occurrences}.`,
        );
      }
    }

    const inventoryMatch = bundleNotice.match(
      /\nBundled application package count: (\d+)\n\n([\s\S]*?)\n\nBuild-generated runtime:/,
    );
    if (!inventoryMatch) {
      failures.push('Bundle application inventory cannot be parsed.');
    } else {
      const declaredCount = Number(inventoryMatch[1]);
      const packageLines = inventoryMatch[2].split('\n');
      const identities = packageLines.map(line => line.split(' | ')[0]);
      const uniqueIdentities = new Set(identities);
      if (
        packageLines.length !== declaredCount ||
        uniqueIdentities.size !== declaredCount
      ) {
        failures.push(
          `Bundle application inventory count/uniqueness mismatch: declared ${declaredCount}, lines ${packageLines.length}, unique ${uniqueIdentities.size}.`,
        );
      }

      const expectedIdentities = fs.readFileSync(
        path.join(root, 'LICENSES/bundle-identities.txt'),
        'utf8',
      );
      if (`${identities.join('\n')}\n` !== expectedIdentities) {
        failures.push(
          'Bundle application identities differ from LICENSES/bundle-identities.txt.',
        );
      }

      const actualUnresolved = new Set(
        packageLines
          .filter(line => line.includes('UNRESOLVED UPSTREAM NOTICE'))
          .map(line => line.split(' | ')[0]),
      );
      if (
        actualUnresolved.size !== unresolvedKoiiPackages.size ||
        [...actualUnresolved].some(
          identity => !unresolvedKoiiPackages.has(identity),
        )
      ) {
        failures.push(
          `Unexpected unresolved-notice set: ${[...actualUnresolved].join(', ') || 'none'}.`,
        );
      }
      if (strictRelease && actualUnresolved.size > 0) {
        failures.push(
          'Public release is blocked: exact Koii package license notices remain unresolved.',
        );
      } else if (actualUnresolved.size > 0) {
        warnings.push(
          'Candidate only: public release remains blocked on three unresolved Koii package notices.',
        );
      }
    }

    embeddedReleaseCommit =
      bundleNotice.match(/^Release commit: (.+)$/m)?.[1] || '';
    if (strictRelease && !/^[0-9a-f]{40}$/.test(embeddedReleaseCommit)) {
      failures.push(
        'Public release is blocked: rebuild with a lowercase 40-character KCC_RELEASE_COMMIT.',
      );
    }
  }
}

if (strictRelease) {
  try {
    const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (
      /^[0-9a-f]{40}$/.test(embeddedReleaseCommit) &&
      embeddedReleaseCommit !== actualCommit
    ) {
      failures.push(
        `Embedded release commit ${embeddedReleaseCommit} does not match checked-out commit ${actualCommit}.`,
      );
    }
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    if (status) {
      failures.push(
        'Public release is blocked: the source worktree is not clean.',
      );
    }
  } catch (error) {
    failures.push(
      `Public release provenance could not inspect Git: ${error.message}`,
    );
  }
}

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

console.log(
  strictRelease
    ? 'Public-release license inventory and artifact notices verified.'
    : 'Candidate license inventory and artifact notices verified.',
);
