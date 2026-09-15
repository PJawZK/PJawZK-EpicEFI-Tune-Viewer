import assert from 'node:assert/strict';
import {
  assertMetadataMatchesFinalFiles,
  assertMetadataSnapshotMatches,
  assertTuneDeleteTargets,
  assertTuneMetadataIdentity,
  assertTuneWriteTargets,
  assertValidTuneId,
  tuneFilePath,
} from '../src/publicationPolicy.ts';

assert.equal(assertValidTuneId('volvo-940-r2'), 'volvo-940-r2');
assert.throws(() => assertValidTuneId('../escape'), /may contain lowercase/);
assert.throws(() => assertValidTuneId('index.json'), /reserved/);
assert.throws(() => assertValidTuneId('UpperCase'), /may contain lowercase/);
assert.throws(() => assertValidTuneId('a'.repeat(97)), /96-character limit/);

assert.equal(
  tuneFilePath('volvo-940-r2', 'tune.msq'),
  'public/tunes/volvo-940-r2/tune.msq',
);

const createTargets = assertTuneWriteTargets(
  'volvo-940-r2',
  [
    { path: 'public/tunes/volvo-940-r2/metadata.json' },
    { path: 'public/tunes/volvo-940-r2/tune.msq' },
    { path: 'public/tunes/volvo-940-r2/mainController.ini' },
  ],
  'create',
);
assert.deepEqual(
  [...createTargets].sort(),
  ['mainController.ini', 'metadata.json', 'tune.msq'],
);

assert.throws(
  () => assertTuneWriteTargets(
    'volvo-940-r2',
    [
      { path: 'public/tunes/other/metadata.json' },
      { path: 'public/tunes/volvo-940-r2/tune.msq' },
    ],
    'create',
  ),
  /outside the intended tune folder/,
);

assert.throws(
  () => assertTuneWriteTargets(
    'volvo-940-r2',
    [
      { path: 'public/tunes/volvo-940-r2/metadata.json' },
      { path: 'public/tunes/volvo-940-r2/tune.msq' },
      { path: 'public/tunes/volvo-940-r2/SUBMISSION.txt' },
    ],
    'create',
  ),
  /not a supported published tune file/,
);

assert.throws(
  () => assertTuneWriteTargets(
    'volvo-940-r2',
    [{ path: 'public/tunes/volvo-940-r2/metadata.json' }],
    'create',
  ),
  /missing tune.msq/,
);

assert.doesNotThrow(() => assertTuneWriteTargets(
  'volvo-940-r2',
  [{ path: 'public/tunes/volvo-940-r2/metadata.json' }],
  'edit',
));

assert.deepEqual(
  [...assertTuneDeleteTargets(
    'volvo-940-r2',
    ['public/tunes/volvo-940-r2/mainController.ini'],
  )],
  ['mainController.ini'],
);

assert.throws(
  () => assertTuneDeleteTargets(
    'volvo-940-r2',
    ['public/tunes/volvo-940-r2/tune.msq'],
  ),
  /may delete only mainController.ini/,
);

const localIniMetadata = assertTuneMetadataIdentity(
  {
    id: 'volvo-940-r2',
    firmwareSignature: 'EpicEFI.NEWFW.123',
    files: {
      msq: 'tune.msq',
      ini: 'mainController.ini',
    },
  },
  'volvo-940-r2',
  'EpicEFI.NEWFW.123',
);
assert.equal(localIniMetadata.hasIni, true);

assert.throws(
  () => assertTuneMetadataIdentity(
    {
      id: 'other',
      firmwareSignature: 'EpicEFI.NEWFW.123',
      files: { msq: 'tune.msq' },
    },
    'volvo-940-r2',
    'EpicEFI.NEWFW.123',
  ),
  /does not match intended Tune ID/,
);

assert.throws(
  () => assertTuneMetadataIdentity(
    {
      id: 'volvo-940-r2',
      firmwareSignature: 'EpicEFI.OTHER.999',
      files: { msq: 'tune.msq' },
    },
    'volvo-940-r2',
    'EpicEFI.NEWFW.123',
  ),
  /firmwareSignature does not match/,
);

assert.doesNotThrow(() => assertMetadataMatchesFinalFiles(
  localIniMetadata,
  new Set(['metadata.json', 'tune.msq', 'mainController.ini']),
));

assert.throws(
  () => assertMetadataMatchesFinalFiles(
    localIniMetadata,
    new Set(['metadata.json', 'tune.msq']),
  ),
  /references mainController.ini/,
);

const registryBackedMetadata = assertTuneMetadataIdentity(
  {
    id: 'registry-backed',
    firmwareSignature: 'EpicEFI.REGISTERED.1',
    files: { msq: 'tune.msq' },
  },
  'registry-backed',
  'EpicEFI.REGISTERED.1',
);
assert.equal(registryBackedMetadata.hasIni, false);
assert.doesNotThrow(() => assertMetadataMatchesFinalFiles(
  registryBackedMetadata,
  new Set(['metadata.json', 'tune.msq']),
));

assert.doesNotThrow(() => assertMetadataSnapshotMatches(
  JSON.stringify({
    id: 'volvo-940-r2',
    title: 'Same tune',
    files: { ini: 'mainController.ini', msq: 'tune.msq' },
  }),
  JSON.stringify({
    files: { msq: 'tune.msq', ini: 'mainController.ini' },
    title: 'Same tune',
    id: 'volvo-940-r2',
  }, null, 2),
  'volvo-940-r2',
));

assert.throws(
  () => assertMetadataSnapshotMatches(
    JSON.stringify({ id: 'volvo-940-r2', title: 'Newer edit' }),
    JSON.stringify({ id: 'volvo-940-r2', title: 'Loaded edit' }),
    'volvo-940-r2',
  ),
  /changed after this page was loaded/,
);

const lineageMetadata = assertTuneMetadataIdentity(
  {
    id: 'child-r2',
    firmwareSignature: 'EpicEFI.NEWFW.123',
    parentTuneId: 'parent-tune',
    files: { msq: 'tune.msq' },
  },
  'child-r2',
  'EpicEFI.NEWFW.123',
);
assert.equal(lineageMetadata.parentTuneId, 'parent-tune');

assert.throws(
  () => assertTuneMetadataIdentity(
    {
      id: 'self-parent',
      firmwareSignature: 'EpicEFI.NEWFW.123',
      parentTuneId: 'self-parent',
      files: { msq: 'tune.msq' },
    },
    'self-parent',
    'EpicEFI.NEWFW.123',
  ),
  /cannot reference the tune itself/,
);

console.log('Publication path/identity policy tests: PASS');
