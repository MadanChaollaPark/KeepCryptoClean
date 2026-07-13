'use strict';

const { spawnSync } = require('node:child_process');

const audit = spawnSync(
  process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
  ['audit', '--groups', 'dependencies', '--level', 'high', '--json'],
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

const lowerIds = [...new Set(advisories.map(item => `${item.severity} ${item.id}`))];
console.log('Production dependency audit passed: 0 high, 0 critical.');
const vulnerabilityCounts = summary.data.vulnerabilities || {};
const lowerCount =
  (vulnerabilityCounts.info || 0) +
  (vulnerabilityCounts.low || 0) +
  (vulnerabilityCounts.moderate || 0);
if (lowerCount > 0 || lowerIds.length > 0) {
  console.log(
    `${lowerCount || lowerIds.length} lower-severity audit paths remain documented in docs/DEPENDENCY_EXCEPTIONS.md.`,
  );
}
