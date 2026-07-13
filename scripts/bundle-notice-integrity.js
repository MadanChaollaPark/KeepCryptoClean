'use strict';

const crypto = require('node:crypto');

const BEGIN_MARKER = 'BEGIN KEEPCRYPTOCLEAN BUNDLE LICENSE NOTICES';
const END_MARKER = 'END KEEPCRYPTOCLEAN BUNDLE LICENSE NOTICES';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function embeddedSuffix(bundleNoticeBytes) {
  const notice = bundleNoticeBytes.toString('utf8');
  return Buffer.from(
    `\n/*! ${BEGIN_MARKER}\nSHA-256: ${sha256(bundleNoticeBytes)}\n${notice}${END_MARKER} */\n`,
  );
}

function verifyBundleIntegrity(artifactBytes, bundleNoticeBytes) {
  const failures = [];
  const notice = bundleNoticeBytes.toString('utf8');
  const expectedSuffix = embeddedSuffix(bundleNoticeBytes);
  let preNoticeDigest = null;
  let embeddedPreNoticeDigest = null;

  if (
    artifactBytes.length < expectedSuffix.length ||
    !artifactBytes.subarray(-expectedSuffix.length).equals(expectedSuffix)
  ) {
    failures.push(
      'dist/main.js does not end with an exact digest-bound copy of the notice sidecar.',
    );
  } else {
    const preNoticeBytes = artifactBytes.subarray(
      0,
      artifactBytes.length - expectedSuffix.length,
    );
    preNoticeDigest = sha256(preNoticeBytes);
    const digestLines = [
      ...notice.matchAll(/^Pre-notice executable SHA-256: ([0-9a-f]{64})$/gm),
    ].map(match => match[1]);
    embeddedPreNoticeDigest = digestLines[0] || null;
    if (digestLines.length !== 1) {
      failures.push(
        `Bundle notice must contain exactly one pre-notice executable SHA-256; found ${digestLines.length}.`,
      );
    } else if (embeddedPreNoticeDigest !== preNoticeDigest) {
      failures.push(
        `Executable payload digest mismatch: ${preNoticeDigest} (expected ${embeddedPreNoticeDigest}).`,
      );
    }
  }

  return {
    embeddedPreNoticeDigest,
    expectedSuffix,
    failures,
    preNoticeDigest,
  };
}

module.exports = {
  BEGIN_MARKER,
  END_MARKER,
  embeddedSuffix,
  sha256,
  verifyBundleIntegrity,
};
