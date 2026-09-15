import assert from 'node:assert/strict';
import {
  firmwareIdentityDetail,
  firmwareIdentitySummary,
  parseFirmwareIdentity,
} from '../src/firmwareIdentity.ts';

assert.deepEqual(
  parseFirmwareIdentity('epicEFI master.2026.09.11.MEGA144H7.3717101070'),
  {
    raw: 'epicEFI master.2026.09.11.MEGA144H7.3717101070',
    family: 'epicEFI',
    branch: 'master',
    date: '2026-09-11',
    ecuTarget: 'MEGA144H7',
    definitionHash: '3717101070',
  },
);

assert.deepEqual(
  parseFirmwareIdentity('rusEFI master.2026.03.29.KLM_MS43.2629890729'),
  {
    raw: 'rusEFI master.2026.03.29.KLM_MS43.2629890729',
    family: 'rusEFI',
    branch: 'master',
    date: '2026-03-29',
    ecuTarget: 'KLM_MS43',
    definitionHash: '2629890729',
  },
);

assert.equal(
  firmwareIdentitySummary('epicEFI master.2026.09.11.MEGA144H7.3717101070'),
  'epicEFI · 2026-09-11 · MEGA144H7',
);
assert.match(
  firmwareIdentityDetail('epicEFI master.2026.09.11.MEGA144H7.3717101070'),
  /definition 3717101070/,
);
assert.equal(parseFirmwareIdentity('EpicEFI.NEW.123'), null);
assert.equal(firmwareIdentitySummary('EpicEFI.NEW.123'), 'EpicEFI.NEW.123');

console.log('Firmware identity tests: PASS');
