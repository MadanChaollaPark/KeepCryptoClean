'use strict';

const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');
const webpack = require('webpack');
const {
  BEGIN_MARKER,
  END_MARKER,
  embeddedSuffix,
  sha256,
} = require('./bundle-notice-integrity');
const { readBoundedRegularFile } = require('./read-bounded-regular-file');

const PLUGIN_NAME = 'KeepCryptoCleanBundleLicensePlugin';
const NOTICE_ASSET = 'THIRD_PARTY_BUNDLE_NOTICES.txt';
const MAX_LICENSE_FILE_BYTES = 1024 * 1024;
const canonicalSourceRepository =
  'https://github.com/MadanChaollaPark/KeepCryptoClean';
const locallyModifiedPackages = new Set([
  '@_koii/namespace-wrapper@1.0.23',
  '@_koii/storage-task-sdk@1.2.8',
  '@_koii/task-manager@1.0.14',
]);
const builtinRequests = new Set(
  builtinModules.flatMap(name => [name, `node:${name}`]),
);
const unresolvedNoticeOverrides = new Map([
  [
    '@_koii/namespace-wrapper@1.0.23',
    {
      path: 'LICENSES/unresolved/koii-namespace-wrapper-1.0.23.txt',
      sha256:
        '7f2eb959673fde366062d4b0325f40a29eff3178d2f1d98149f2ed3775fae540',
    },
  ],
  [
    '@_koii/storage-task-sdk@1.2.8',
    {
      path: 'LICENSES/unresolved/koii-storage-task-sdk-1.2.8.txt',
      sha256:
        '7597b1d5074a0d53b69bfca8f957108eb376fc8e667d5beb0e1f0b4c98ea0786',
    },
  ],
  [
    '@_koii/task-manager@1.0.14',
    {
      path: 'LICENSES/unresolved/koii-task-manager-1.0.14.txt',
      sha256:
        'fe99dba87faa98280fd6afa8e758526c0b78ded72abc62d5034fdadd149d2a23',
    },
  ],
]);
const reviewedNoticeOverrides = new Map([
  [
    'bs58@4.0.1',
    {
      path: 'LICENSES/clarifications/bs58-4.0.1-MIT.txt',
      sha256:
        'b19394df6cc1141984cb95c2357828dcdd3ac9b9b305c2b2f26a1a63f868be4e',
    },
  ],
  [
    'tr46@0.0.3',
    {
      path: 'LICENSES/clarifications/tr46-0.0.3-MIT.txt',
      sha256:
        '404f3ad181ef1d5c5c0d047ed47b838f7c42d7afdeefad9278c3aa93d8c299e8',
    },
  ],
]);
const reviewedReadmeNotices = new Map([
  [
    'agent-base@6.0.2',
    {
      readme:
        'f1425c3b72330fe4fb2aa5a2fb152e939bdf534692a32b5f0b38f74147b98556',
      notice:
        '5aa012c5c5e970177d1ff9144121a598fa082434391061504b2d77a70289097f',
    },
  ],
  [
    'brorand@1.1.0',
    {
      readme:
        'd506a235e27d2912c7c93be50beaaffaa9cd11e5c3852acc08362005108b61dc',
      notice:
        'f6ea0899d4a65578f4be7e01b61fa2ffb08268ca06571f4f53d8a82025179982',
    },
  ],
  [
    'cookie-signature@1.0.7',
    {
      readme:
        '1621ed10d0b2f865eb8608e0474a356cf7a9737a384b6593b61b30a9f6e50366',
      notice:
        '8211088370644d3cf185834ddf39ae21bf713420392041ba71f164bbad28da31',
    },
  ],
  [
    'elliptic@6.6.1',
    {
      readme:
        '361389f7c5c5e493c2af0e89333b4dce12cf6f4c8901b30f035475d2c0215473',
      notice:
        'f6ea0899d4a65578f4be7e01b61fa2ffb08268ca06571f4f53d8a82025179982',
    },
  ],
  [
    'hash.js@1.1.7',
    {
      readme:
        '5df660fe115c8ddcdb81c5d733c117b94abb706b91c26dac3ab7dc817dd9ba71',
      notice:
        'f6ea0899d4a65578f4be7e01b61fa2ffb08268ca06571f4f53d8a82025179982',
    },
  ],
  [
    'hmac-drbg@1.0.1',
    {
      readme:
        '31de905f4580f7a7f0eef6f2f09be85b261c64560bd072bc58d9b61ae225551f',
      notice:
        '35da5a7a6aceea5afbefafe0edf6ec3226201f7f8fc3c852cacddc768f41a058',
    },
  ],
  [
    'https-proxy-agent@5.0.1',
    {
      readme:
        '32f0856d2c43df7d05cca960fdee84e1e38ab545bd7b2186433dfa41aa90a712',
      notice:
        '5aa012c5c5e970177d1ff9144121a598fa082434391061504b2d77a70289097f',
    },
  ],
  [
    'minimalistic-crypto-utils@1.0.1',
    {
      readme:
        '64608431631207282f74532d8b9eeda5cb42fced09c663f21e1462987270950c',
      notice:
        '35da5a7a6aceea5afbefafe0edf6ec3226201f7f8fc3c852cacddc768f41a058',
    },
  ],
]);

function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..'
  );
}

function findPackageRoot(resource, nodeModulesRoot) {
  if (typeof resource !== 'string' || !path.isAbsolute(resource)) return null;
  const cleanResource = resource.split('?')[0];
  let current = fs.existsSync(cleanResource)
    ? fs.statSync(cleanResource).isDirectory()
      ? cleanResource
      : path.dirname(cleanResource)
    : path.dirname(cleanResource);

  while (isInside(nodeModulesRoot, current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function externalRequests(request) {
  if (typeof request === 'string') return [request];
  if (Array.isArray(request)) return request.flatMap(externalRequests);
  if (request && typeof request === 'object') {
    return Object.values(request).flatMap(externalRequests);
  }
  return [];
}

function visitModule(module, visit, seen = new Set()) {
  if (!module || typeof module !== 'object' || seen.has(module)) return;
  seen.add(module);
  if (module.constructor?.name === 'ExternalModule') {
    const requests = externalRequests(module.request);
    if (
      requests.length === 0 ||
      requests.some(request => !builtinRequests.has(request))
    ) {
      throw new Error(
        `Executable has a non-builtin external module: ${JSON.stringify(module.request)}`,
      );
    }
  }
  visit(module.resource);
  if (module.rootModule && module.rootModule !== module) {
    visitModule(module.rootModule, visit, seen);
  }
  if (module.modules) {
    for (const nested of module.modules) visitModule(nested, visit, seen);
  }
}

function licenseExpression(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim()) {
    return manifest.license.trim();
  }
  if (manifest.license?.type) return String(manifest.license.type);
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map(item => (typeof item === 'string' ? item : item?.type))
      .filter(Boolean);
    if (values.length) return values.join(' OR ');
  }
  return 'SEE INCLUDED LICENSE FILES';
}

function repositoryUrl(manifest) {
  const repository =
    typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository?.url;
  return (
    repository ||
    manifest.homepage ||
    `https://www.npmjs.com/package/${manifest.name}`
  );
}

function licenseFiles(packageRoot) {
  const candidates = fs
    .readdirSync(packageRoot, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(entry.name),
    )
    .map(entry => entry.name)
    .sort(bytewiseCompare);

  return candidates.map(fileName => {
    const absolutePath = path.join(packageRoot, fileName);
    const contents = readBoundedRegularFile(absolutePath, {
      minBytes: 1,
      maxBytes: MAX_LICENSE_FILE_BYTES,
    });
    return {
      fileName,
      text: normalizeText(contents.toString('utf8')),
    };
  });
}

function readmeLicenseSection(packageRoot, identity) {
  const readme = fs
    .readdirSync(packageRoot)
    .filter(fileName => /^readme(?:\.[^.]+)?$/i.test(fileName))
    .sort(bytewiseCompare)[0];
  if (!readme) return null;
  const rawReadme = fs.readFileSync(path.join(packageRoot, readme));
  const lines = normalizeText(rawReadme.toString('utf8')).split('\n');
  let start = lines.findIndex(line => /^#{1,6}\s+licen[cs]e\s*$/i.test(line));
  if (start < 0) {
    start = lines.findIndex(
      (line, index) =>
        /^licen[cs]e\s*$/i.test(line) &&
        /^[-=]{3,}\s*$/.test(lines[index + 1] || ''),
    );
  }
  if (start < 0) return null;
  const referencesStart = lines.findIndex(
    (line, index) => index > start && /^\[[^\]]+\]:\s/.test(line),
  );
  const section = normalizeText(
    lines
      .slice(start, referencesStart < 0 ? undefined : referencesStart)
      .join('\n'),
  );
  if (
    !/permission is hereby granted/i.test(section) ||
    !/the software is provided/i.test(section)
  ) {
    return null;
  }
  const reviewed = reviewedReadmeNotices.get(identity);
  const readmeDigest = sha256(rawReadme);
  const noticeDigest = sha256(section);
  if (
    !reviewed ||
    reviewed.readme !== readmeDigest ||
    reviewed.notice !== noticeDigest
  ) {
    throw new Error(
      `Unreviewed README license extraction for ${identity}: README ${readmeDigest}, notice ${noticeDigest}`,
    );
  }
  return { fileName: `${readme} (license section)`, text: section };
}

function loadOverride(projectRoot, override) {
  const absolutePath = path.join(projectRoot, override.path);
  const raw = fs.readFileSync(absolutePath);
  const digest = sha256(raw);
  if (digest !== override.sha256) {
    throw new Error(
      `Reviewed notice changed: ${override.path} (${digest}, expected ${override.sha256})`,
    );
  }
  return {
    fileName: override.path,
    text: normalizeText(raw.toString('utf8')),
  };
}

function packageRecord(packageRoot, projectRoot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  if (!manifest.name || !manifest.version) {
    throw new Error(
      `Bundled package has no canonical identity: ${packageRoot}`,
    );
  }
  const identity = `${manifest.name}@${manifest.version}`;
  const files = licenseFiles(packageRoot);
  const readmeSection = files.length
    ? null
    : readmeLicenseSection(packageRoot, identity);
  if (readmeSection) files.push(readmeSection);
  let unresolved = false;
  if (files.length === 0 && reviewedNoticeOverrides.has(identity)) {
    files.push(
      loadOverride(projectRoot, reviewedNoticeOverrides.get(identity)),
    );
  }
  if (files.length === 0 && unresolvedNoticeOverrides.has(identity)) {
    files.push(
      loadOverride(projectRoot, unresolvedNoticeOverrides.get(identity)),
    );
    unresolved = true;
  }
  if (files.length === 0) {
    throw new Error(
      `Bundled package has no reviewed license/notice source: ${identity}`,
    );
  }
  return {
    identity,
    license: licenseExpression(manifest),
    source: repositoryUrl(manifest),
    files,
    unresolved,
    locallyModified: locallyModifiedPackages.has(identity),
  };
}

function recordDigest(record) {
  return sha256(JSON.stringify(record));
}

function renderInventory(
  packageRoots,
  projectRoot,
  runtimeRecord,
  preNoticeDigest,
  releaseCommit = '',
) {
  const records = new Map();
  const packageErrors = [];
  for (const packageRoot of packageRoots) {
    let record;
    try {
      record = packageRecord(packageRoot, projectRoot);
    } catch (error) {
      packageErrors.push(error.message);
      continue;
    }
    const previous = records.get(record.identity);
    if (previous && recordDigest(previous) !== recordDigest(record)) {
      throw new Error(
        `Bundled duplicate package has inconsistent notices: ${record.identity}`,
      );
    }
    records.set(record.identity, record);
  }
  if (packageErrors.length) {
    throw new Error(packageErrors.sort().join('\n'));
  }
  const sorted = [...records.values()].sort((left, right) =>
    bytewiseCompare(left.identity, right.identity),
  );
  if (sorted.length === 0) {
    throw new Error('No bundled third-party packages were discovered');
  }
  const expectedIdentityPath = path.join(
    projectRoot,
    'LICENSES/bundle-identities.txt',
  );
  const expectedIdentities = normalizeText(
    fs.readFileSync(expectedIdentityPath, 'utf8'),
  );
  const actualIdentities = normalizeText(
    sorted.map(record => record.identity).join('\n'),
  );
  if (actualIdentities !== expectedIdentities) {
    const expected = new Set(expectedIdentities.trim().split('\n'));
    const actual = new Set(actualIdentities.trim().split('\n'));
    const added = [...actual].filter(identity => !expected.has(identity));
    const removed = [...expected].filter(identity => !actual.has(identity));
    throw new Error(
      `Executable dependency graph changed; review LICENSES/bundle-identities.txt (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'})`,
    );
  }

  if (releaseCommit && !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error(
      'KCC_RELEASE_COMMIT must be a lowercase 40-character Git commit',
    );
  }
  const sourceLocation = releaseCommit
    ? `${canonicalSourceRepository}/tree/${releaseCommit}`
    : canonicalSourceRepository;

  const projectLicense = normalizeText(
    fs.readFileSync(path.join(projectRoot, 'LICENSE'), 'utf8'),
  );
  const lgpl = normalizeText(
    fs.readFileSync(path.join(projectRoot, 'LICENSES/LGPL-3.0.txt'), 'utf8'),
  );
  const gpl = normalizeText(
    fs.readFileSync(path.join(projectRoot, 'LICENSES/GPL-3.0.txt'), 'utf8'),
  );
  const lines = [
    'KeepCryptoClean executable license notices',
    '',
    'This deterministic inventory covers third-party application packages in the final dist/main.js chunk.',
    'The complete text is also embedded at the end of that executable.',
    `Pre-notice executable SHA-256: ${preNoticeDigest}`,
    `Source repository: ${canonicalSourceRepository}`,
    `Release commit: ${releaseCommit || 'UNRECORDED - RELEASE BLOCKED'}`,
    `Complete Corresponding Source: ${sourceLocation}`,
    'The source includes package.json, yarn.lock, webpack.config.js, and scripts/patch-task-manager.js.',
    'Pinned toolchain: Node.js 22.22.0 and Yarn 1.22.22.',
    'Rebuild/relink: yarn install --frozen-lockfile',
    'Rebuild/relink: KCC_TARGET_USER_ID=<embedded numeric X User ID> yarn build',
    'Local dependency modifications are reproducibly applied by scripts/patch-task-manager.js.',
    '',
    `Bundled application package count: ${sorted.length}`,
    '',
    ...sorted.map(
      record =>
        `${record.identity} | ${record.license}${record.locallyModified ? ' | LOCALLY MODIFIED' : ''}${record.unresolved ? ' | UNRESOLVED UPSTREAM NOTICE' : ''}`,
    ),
    '',
    `Build-generated runtime: ${runtimeRecord.identity} | ${runtimeRecord.license}`,
    '',
    '===== KEEPCRYPTOCLEAN PROJECT LICENSE =====',
    projectLicense.trimEnd(),
  ];

  for (const record of sorted) {
    lines.push(
      '',
      `===== ${record.identity} =====`,
      `Declared license: ${record.license}`,
      `Source: ${record.source}`,
      ...(record.locallyModified
        ? ['Local modifications: scripts/patch-task-manager.js']
        : []),
      ...(record.unresolved
        ? ['Release status: BLOCKED - upstream notice is unresolved']
        : []),
    );
    for (const file of record.files) {
      lines.push('', `----- ${file.fileName} -----`, file.text.trimEnd());
    }
  }

  lines.push(
    '',
    `===== BUILD-GENERATED RUNTIME: ${runtimeRecord.identity} =====`,
    `Declared license: ${runtimeRecord.license}`,
    `Source: ${runtimeRecord.source}`,
  );
  for (const file of runtimeRecord.files) {
    lines.push('', `----- ${file.fileName} -----`, file.text.trimEnd());
  }

  lines.push(
    '',
    '===== COMPLETE LGPL-3.0-ONLY TEXT =====',
    lgpl.trimEnd(),
    '',
    '===== COMPLETE GPL-3.0-ONLY TEXT REFERENCED BY LGPLV3 =====',
    gpl.trimEnd(),
    '',
  );
  return normalizeText(lines.join('\n'));
}

class BundleLicensePlugin {
  constructor({ releaseCommit = '' } = {}) {
    this.releaseCommit = releaseCommit;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        () => {
          const projectRoot = compiler.context;
          const nodeModulesRoot = path.join(projectRoot, 'node_modules');
          const mainChunk = [...compilation.chunks].find(chunk =>
            [...chunk.files].includes('main.js'),
          );
          if (!mainChunk) throw new Error('main.js chunk was not found');
          const packageRoots = new Set();
          for (const module of compilation.chunkGraph.getChunkModulesIterable(
            mainChunk,
          )) {
            visitModule(module, resource => {
              const packageRoot = findPackageRoot(resource, nodeModulesRoot);
              if (packageRoot) packageRoots.add(packageRoot);
            });
          }

          const runtimeRecord = packageRecord(
            path.dirname(require.resolve('webpack/package.json')),
            projectRoot,
          );
          const mainAsset = compilation.getAsset('main.js');
          if (!mainAsset) throw new Error('main.js was not emitted');
          const preNoticeSource = mainAsset.source.source();
          const preNoticeBytes = Buffer.isBuffer(preNoticeSource)
            ? preNoticeSource
            : Buffer.from(preNoticeSource);
          const inventory = renderInventory(
            packageRoots,
            projectRoot,
            runtimeRecord,
            sha256(preNoticeBytes),
            this.releaseCommit,
          );
          if (inventory.includes('*/')) {
            throw new Error(
              'Bundle license inventory contains a comment terminator',
            );
          }
          const embedded = embeddedSuffix(Buffer.from(inventory));

          compilation.updateAsset(
            'main.js',
            new webpack.sources.ConcatSource(
              mainAsset.source,
              embedded.toString('utf8'),
            ),
          );
          compilation.emitAsset(
            NOTICE_ASSET,
            new webpack.sources.RawSource(inventory),
          );
        },
      );
    });
  }
}

module.exports = {
  BEGIN_MARKER,
  BundleLicensePlugin,
  END_MARKER,
  NOTICE_ASSET,
  findPackageRoot,
  renderInventory,
};
