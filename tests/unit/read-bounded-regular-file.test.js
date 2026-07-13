'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  readBoundedRegularFile,
} = require('../../scripts/read-bounded-regular-file');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-safe-read-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return root;
}

test('bounded reader returns exact regular-file bytes and text', t => {
  const root = fixture(t);
  const file = path.join(root, 'notice.txt');
  fs.writeFileSync(file, 'license\n');

  assert.deepEqual(
    readBoundedRegularFile(file, { minBytes: 1, maxBytes: 8 }),
    Buffer.from('license\n'),
  );
  assert.equal(
    readBoundedRegularFile(file, {
      encoding: 'utf8',
      minBytes: 8,
      maxBytes: 8,
    }),
    'license\n',
  );
});

test('bounded reader rejects non-files, symlinks, and unsafe sizes', t => {
  const root = fixture(t);
  const empty = path.join(root, 'empty');
  const oversized = path.join(root, 'oversized');
  const link = path.join(root, 'link');
  fs.writeFileSync(empty, '');
  fs.writeFileSync(oversized, '1234');
  fs.symlinkSync(oversized, link);

  assert.throws(
    () => readBoundedRegularFile(root, { maxBytes: 16 }),
    /expected a regular file/,
  );
  assert.throws(
    () => readBoundedRegularFile(empty, { minBytes: 1, maxBytes: 16 }),
    /outside 1-16 bytes/,
  );
  assert.throws(
    () => readBoundedRegularFile(oversized, { maxBytes: 3 }),
    /outside 0-3 bytes/,
  );
  if (fs.constants.O_NOFOLLOW) {
    assert.throws(
      () => readBoundedRegularFile(link, { maxBytes: 16 }),
      error => error?.code === 'ELOOP',
    );
  }
});

test('bounded reader rejects a pathname replacement during the read', t => {
  const root = fixture(t);
  const file = path.join(root, 'artifact');
  const replacement = path.join(root, 'replacement');
  fs.writeFileSync(file, 'original');
  fs.writeFileSync(replacement, 'replaced');

  const originalRead = fs.readSync;
  let swapped = false;
  fs.readSync = function swapPath(...args) {
    if (!swapped) {
      swapped = true;
      fs.renameSync(replacement, file);
    }
    return originalRead.apply(this, args);
  };
  t.after(() => {
    fs.readSync = originalRead;
  });

  assert.throws(
    () => readBoundedRegularFile(file, { encoding: 'utf8', maxBytes: 8 }),
    /file changed while it was being read/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'replaced');
});

test('bounded reader rejects truncation and an in-place change', t => {
  const root = fixture(t);
  const file = path.join(root, 'artifact');
  fs.writeFileSync(file, 'abcdef');

  const originalRead = fs.readSync;
  let firstRead = true;
  fs.readSync = function changeFile(
    descriptor,
    buffer,
    offset,
    length,
    position,
  ) {
    if (!firstRead) {
      return originalRead.call(
        this,
        descriptor,
        buffer,
        offset,
        length,
        position,
      );
    }
    firstRead = false;
    const bytesRead = originalRead.call(
      this,
      descriptor,
      buffer,
      offset,
      Math.min(length, 1),
      position,
    );
    fs.writeFileSync(file, 'ghijkl');
    fs.utimesSync(file, new Date(0), new Date(0));
    return bytesRead;
  };
  t.after(() => {
    fs.readSync = originalRead;
  });

  assert.throws(
    () => readBoundedRegularFile(file, { maxBytes: 6 }),
    /file changed while it was being read/,
  );

  fs.readSync = () => 0;
  assert.throws(
    () => readBoundedRegularFile(file, { maxBytes: 6 }),
    /file ended while it was being read/,
  );
});

test(
  'bounded reader rejects a FIFO without blocking',
  { skip: process.platform === 'win32' },
  t => {
    const root = fixture(t);
    const fifo = path.join(root, 'fifo');
    const creation = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    if (creation.error?.code === 'ENOENT') {
      t.skip('mkfifo is unavailable');
      return;
    }
    assert.equal(creation.status, 0, creation.stderr);

    const helper = require.resolve('../../scripts/read-bounded-regular-file');
    const script = [
      'const { readBoundedRegularFile } = require(process.argv[1]);',
      'readBoundedRegularFile(process.argv[2], { maxBytes: 16 });',
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script, helper, fifo], {
      encoding: 'utf8',
      timeout: 1_000,
    });

    assert.notEqual(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected a regular file/);
  },
);
