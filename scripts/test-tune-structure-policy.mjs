import './test-tag-normalization.mjs';
import assert from 'node:assert/strict';
import {
  assertCanonicalMetadataFiles,
  assertMetadataMatchesFolderFiles,
  assertTuneFolderEntries,
} from './tune-structure-policy.mjs';

const canonical = assertTuneFolderEntries('example-tune', [
  { name: 'metadata.json', isFile: true },
  { name: 'tune.msq', isFile: true },
  { name: 'mainController.ini', isFile: true },
]);

assert.deepEqual(
  [...canonical].sort(),
  ['mainController.ini', 'metadata.json', 'tune.msq'],
);

assert.throws(
  () => assertTuneFolderEntries('orphan', [
    { name: 'tune.msq', isFile: true },
  ]),
  /metadata\.json.*missing/,
);

assert.throws(
  () => assertTuneFolderEntries('missing-msq', [
    { name: 'metadata.json', isFile: true },
  ]),
  /tune\.msq.*missing/,
);

assert.throws(
  () => assertTuneFolderEntries('unexpected', [
    { name: 'metadata.json', isFile: true },
    { name: 'tune.msq', isFile: true },
    { name: 'notes.txt', isFile: true },
  ]),
  /unexpected file "notes\.txt"/,
);

assert.throws(
  () => assertTuneFolderEntries('nested', [
    { name: 'metadata.json', isFile: true },
    { name: 'tune.msq', isFile: true },
    { name: 'assets', isFile: false },
  ]),
  /not a regular file/,
);

const withIni = assertCanonicalMetadataFiles({
  msq: 'tune.msq',
  ini: 'mainController.ini',
}, 'example/metadata.json');
assert.equal(withIni.hasIni, true);

const withoutIni = assertCanonicalMetadataFiles({
  msq: 'tune.msq',
}, 'example/metadata.json');
assert.equal(withoutIni.hasIni, false);

assert.throws(
  () => assertCanonicalMetadataFiles({ msq: 'custom-name.msq' }),
  /files\.msq must be exactly "tune\.msq"/,
);

assert.throws(
  () => assertCanonicalMetadataFiles({
    msq: 'tune.msq',
    ini: 'custom.ini',
  }),
  /files\.ini must be exactly "mainController\.ini"/,
);

assert.doesNotThrow(() => assertMetadataMatchesFolderFiles(
  withIni,
  new Set(['metadata.json', 'tune.msq', 'mainController.ini']),
));

assert.throws(
  () => assertMetadataMatchesFolderFiles(
    withIni,
    new Set(['metadata.json', 'tune.msq']),
  ),
  /references mainController\.ini, but the file is missing/,
);

assert.throws(
  () => assertMetadataMatchesFolderFiles(
    withoutIni,
    new Set(['metadata.json', 'tune.msq', 'mainController.ini']),
  ),
  /mainController\.ini exists, but metadata does not reference it/,
);

console.log('Tune repository structure policy tests: PASS');
