'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const auditAll = process.argv.includes('--all');
const auditArguments = ['audit'];
if (!auditAll) auditArguments.push('--groups', 'dependencies');
auditArguments.push('--level', 'high', '--json');

const audit = spawnSync(
  process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
  auditArguments,
  {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  },
);

if (audit.error) {
  console.error(`Unable to run Yarn audit: ${audit.error.message}`);
  process.exit(2);
}

const records = [];
for (const line of audit.stdout.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    records.push(JSON.parse(line));
  } catch {
    // Yarn warnings are emitted on stderr, but tolerate any non-JSON status
    // line while still requiring an audit summary below.
  }
}

const summary = records.find(record => record.type === 'auditSummary');
if (!summary) {
  if (audit.stderr) console.error(audit.stderr.trim());
  console.error('Yarn did not return an audit summary.');
  process.exit(2);
}

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const advisories = records
  .filter(record => record.type === 'auditAdvisory')
  .map(record => ({
    severity: record.data.advisory.severity,
    id:
      record.data.advisory.github_advisory_id ||
      String(record.data.advisory.id),
    module: record.data.advisory.module_name,
    path: record.data.resolution.path,
  }));

const blocking = advisories.filter(item => rank[item.severity] >= rank.high);
if (blocking.length > 0) {
  console.error('High/critical production dependency advisories:');
  for (const item of blocking) {
    console.error(`- ${item.severity} ${item.id} ${item.module}: ${item.path}`);
  }
  process.exit(1);
}

const lowerAdvisories = advisories.filter(
  item => rank[item.severity] < rank.high,
);
const lowerIds = [...new Set(lowerAdvisories.map(item => item.id))];
const register = fs.readFileSync(
  path.resolve(__dirname, '../docs/DEPENDENCY_EXCEPTIONS.md'),
  'utf8',
);
const registeredIds = new Set(register.match(/GHSA-[a-z0-9-]+/gi) || []);
const unknownLower = lowerIds.filter(id => !registeredIds.has(id));
const nextReview = register.match(/^Next review:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
const reviewDeadline = Date.parse(`${nextReview || ''}T23:59:59Z`);
if (!Number.isFinite(reviewDeadline) || Date.now() > reviewDeadline) {
  console.error(
    'Dependency exception register is missing or past its next-review date.',
  );
  process.exit(1);
}
if (unknownLower.length > 0) {
  console.error('Unregistered lower-severity dependency advisories:');
  for (const id of unknownLower) console.error(`- ${id}`);
  process.exit(1);
}

console.log(
  `${auditAll ? 'Full toolchain' : 'Production dependency'} audit passed: 0 high, 0 critical.`,
);
const vulnerabilityCounts = summary.data.vulnerabilities || {};
const lowerCount =
  (vulnerabilityCounts.info || 0) +
  (vulnerabilityCounts.low || 0) +
  (vulnerabilityCounts.moderate || 0);
if (lowerCount > 0 || lowerIds.length > 0) {
  console.log(
    `${lowerCount || lowerIds.length} lower-severity audit paths are current in docs/DEPENDENCY_EXCEPTIONS.md.`,
  );
}
