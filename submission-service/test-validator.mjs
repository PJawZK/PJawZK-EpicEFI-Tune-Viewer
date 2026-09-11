import assert from 'node:assert/strict';
import {
  assertPublicTuneId,
  extractIniSignature,
  extractMsqSignature,
  normalizePublicMetadata,
  validatePublicPackage,
} from './validator.mjs';

const msq = '<versionInfo signature="EpicEFI.NEW.123" />';
const ini = '[MegaTune]\nsignature = "EpicEFI.NEW.123"\n';
const baseMetadata = {
  id: 'volvo-940-public',
  title: 'Volvo 940 public tune',
  author: 'Community Tuner',
  ecuTarget: 'Mega144H7',
  firmwareSignature: 'EpicEFI.NEW.123',
  validationStatus: 'Dyno Tested',
  classification: 'Normal',
  tags: ['volvo', 'turbo'],
  files: {
    msq: 'anything.msq',
    ini: 'anything.ini',
  },
};

assert.equal(assertPublicTuneId('volvo-940-r2'), 'volvo-940-r2');
assert.throws(() => assertPublicTuneId('../escape'), /may contain lowercase/);
assert.throws(() => assertPublicTuneId('index.json'), /reserved/);

assert.equal(extractMsqSignature(msq), 'EpicEFI.NEW.123');
assert.equal(extractIniSignature(ini), 'EpicEFI.NEW.123');

const normalized = normalizePublicMetadata(baseMetadata, {
  hasIni: true,
  publishedAt: '2026-09-12',
});
assert.equal(normalized.validationStatus, 'Unverified');
assert.equal(normalized.publishedAt, '2026-09-12');
assert.equal(normalized.updatedAt, undefined);
assert.deepEqual(normalized.files, {
  msq: 'tune.msq',
  ini: 'mainController.ini',
});

const unknownWithIni = validatePublicPackage({
  metadata: baseMetadata,
  msqText: msq,
  iniText: ini,
  registry: { definitions: [] },
  publishedAt: '2026-09-12',
});
assert.equal(unknownWithIni.firmwareSignature, 'EpicEFI.NEW.123');

assert.throws(
  () => validatePublicPackage({
    metadata: baseMetadata,
    msqText: msq,
    registry: { definitions: [] },
    publishedAt: '2026-09-12',
  }),
  /exact firmware signature .* is not registered/,
);

const registryBacked = validatePublicPackage({
  metadata: {
    ...baseMetadata,
    id: 'registry-backed',
    firmwareSignature: 'EpicEFI.REG.1',
  },
  msqText: '<versionInfo signature="EpicEFI.REG.1" />',
  registry: {
    definitions: [{ signature: 'EpicEFI.REG.1', ecuTarget: 'Mega144H7' }],
  },
  publishedAt: '2026-09-12',
});
assert.equal(registryBacked.validationStatus, 'Unverified');

assert.throws(
  () => validatePublicPackage({
    metadata: {
      ...baseMetadata,
      id: 'self-parent',
      parentTuneId: 'self-parent',
    },
    msqText: msq,
    iniText: ini,
    registry: { definitions: [] },
    publishedAt: '2026-09-12',
  }),
  /cannot reference the tune itself/,
);

assert.throws(
  () => validatePublicPackage({
    metadata: baseMetadata,
    msqText: '<versionInfo signature="EpicEFI.OTHER" />',
    iniText: ini,
    registry: { definitions: [] },
    publishedAt: '2026-09-12',
  }),
  /metadata firmwareSignature does not match MSQ/,
);

console.log('Public submission validator tests: PASS');
