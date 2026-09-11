import assert from 'node:assert/strict';
import {
  assertAuthorityConsistency,
  assertTuneValidationAuthority,
  parseValidationAuthority,
} from './validation-policy.mjs';

const empty = parseValidationAuthority({ schema: 1, tunes: {} });
assert.equal(empty.size, 0);

const verified = parseValidationAuthority({
  schema: 1,
  tunes: {
    'verified-tune': 'EpicEFI Verified',
  },
});

assert.doesNotThrow(() => assertTuneValidationAuthority(
  { id: 'normal-tune', validationStatus: 'Road Tested' },
  verified,
  'normal-tune/metadata.json',
));

assert.doesNotThrow(() => assertTuneValidationAuthority(
  { id: 'verified-tune', validationStatus: 'EpicEFI Verified' },
  verified,
  'verified-tune/metadata.json',
));

assert.throws(
  () => assertTuneValidationAuthority(
    { id: 'unlisted-tune', validationStatus: 'EpicEFI Verified' },
    verified,
    'unlisted-tune/metadata.json',
  ),
  /reserved and requires an exact matching entry/,
);

assert.throws(
  () => parseValidationAuthority({
    schema: 1,
    tunes: {
      'bad-status': 'Road Tested',
    },
  }),
  /may only be assigned a reserved validation status/,
);

assert.throws(
  () => assertAuthorityConsistency(
    [{ id: 'other-tune', validationStatus: 'Unverified' }],
    verified,
  ),
  /missing Tune ID "verified-tune"/,
);

assert.throws(
  () => assertAuthorityConsistency(
    [{ id: 'verified-tune', validationStatus: 'Road Tested' }],
    verified,
  ),
  /authorizes "EpicEFI Verified" but metadata contains "Road Tested"/,
);

assert.doesNotThrow(() => assertAuthorityConsistency(
  [{ id: 'verified-tune', validationStatus: 'EpicEFI Verified' }],
  verified,
));

console.log('Validation authority policy tests: PASS');
