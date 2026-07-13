'use strict';

const fs = require('node:fs');

function unsafeFile(filePath, message) {
  const error = new Error(`${filePath}: ${message}`);
  error.code = 'ERR_UNSAFE_FILE';
  return error;
}

function safeReadFlags(filePath) {
  const { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } = fs.constants;
  if (
    !Number.isInteger(O_NOFOLLOW) ||
    O_NOFOLLOW === 0 ||
    !Number.isInteger(O_NONBLOCK) ||
    O_NONBLOCK === 0
  ) {
    throw unsafeFile(
      filePath,
      'platform lacks required no-follow or nonblocking file flags',
    );
  }
  return O_RDONLY | O_NOFOLLOW | O_NONBLOCK;
}

function validateBound(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function sameSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function readBoundedRegularFile(
  filePath,
  { encoding = null, maxBytes, minBytes = 0 } = {},
) {
  validateBound('minBytes', minBytes);
  validateBound('maxBytes', maxBytes);
  if (maxBytes < minBytes) {
    throw new RangeError('maxBytes must be greater than or equal to minBytes');
  }

  let descriptor;
  try {
    descriptor = fs.openSync(filePath, safeReadFlags(filePath));
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      throw unsafeFile(filePath, 'expected a regular file');
    }
    if (before.size < BigInt(minBytes) || before.size > BigInt(maxBytes)) {
      throw unsafeFile(
        filePath,
        `size ${before.size} is outside ${minBytes}-${maxBytes} bytes`,
      );
    }

    const expectedBytes = Number(before.size);
    const bytes = Buffer.alloc(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const bytesRead = fs.readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw unsafeFile(filePath, 'file ended while it was being read');
      }
      offset += bytesRead;
    }

    const growthProbe = Buffer.allocUnsafe(1);
    if (fs.readSync(descriptor, growthProbe, 0, 1, expectedBytes) !== 0) {
      throw unsafeFile(filePath, 'file grew while it was being read');
    }

    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(before, after)) {
      throw unsafeFile(filePath, 'file changed while it was being read');
    }

    return encoding === null ? bytes : bytes.toString(encoding);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

module.exports = { readBoundedRegularFile };
