import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const releasesRoot = path.join(root, 'definitions', 'sources', 'releases');
const historyPath = path.join(root, 'definitions', 'firmware-history.json');

const releaseDates = (await readdir(releasesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const history = JSON.parse(await readFile(historyPath, 'utf8'));
assert.equal(history.schema, 1);
assert.ok(history.releases && typeof history.releases === 'object');
assert.ok(history.unresolved && typeof history.unresolved === 'object');

const documented = new Set(Object.keys(history.releases));
const unresolved = new Set(Object.keys(history.unresolved));

for (const date of releaseDates) {
  assert.ok(
    documented.has(date) || unresolved.has(date),
    `Firmware release ${date} must have source-backed notes or an explicit unresolved record.`,
  );
}

for (const date of documented) {
  assert.ok(releaseDates.includes(date), `Firmware history ${date} has no stored release milestone.`);
  assert.equal(unresolved.has(date), false, `Firmware history ${date} cannot be both documented and unresolved.`);
  const release = history.releases[date];
  assert.equal(typeof release.source, 'string');
  assert.ok(release.source.trim());
  assert.ok(Array.isArray(release.changes));
  assert.ok(release.changes.length > 0);
  assert.ok(release.changes.every((change) => typeof change === 'string' && change.trim()));
}

for (const date of unresolved) {
  assert.ok(releaseDates.includes(date), `Unresolved firmware history ${date} has no stored release milestone.`);
  const record = history.unresolved[date];
  assert.equal(typeof record.reason, 'string');
  assert.ok(record.reason.trim());
}

assert.deepEqual(
  releaseDates.filter((date) => unresolved.has(date)),
  ['2026-09-11'],
);

console.log('Firmware history coverage tests: PASS');
