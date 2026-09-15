import assert from 'node:assert/strict';
import { assertTuneLifecycleMetadata } from './tune-lifecycle-policy.mjs';

assert.deepEqual(assertTuneLifecycleMetadata({}, 'normal'), { archived: false });

assert.deepEqual(
  assertTuneLifecycleMetadata(
    { lifecycleStatus: 'Archived', archivedAt: '2026-09-15' },
    'archived',
  ),
  { archived: true, archivedAt: '2026-09-15' },
);

assert.deepEqual(
  assertTuneLifecycleMetadata(
    {
      lifecycleStatus: 'Archived',
      archivedAt: ' 2026-09-15 ',
      archiveReason: ' Superseded by revision ',
    },
    'archived',
  ),
  {
    archived: true,
    archivedAt: '2026-09-15',
    archiveReason: 'Superseded by revision',
  },
);

assert.throws(
  () => assertTuneLifecycleMetadata(
    { lifecycleStatus: 'Published' },
    'bad-status',
  ),
  /must be exactly "Archived"/,
);

assert.throws(
  () => assertTuneLifecycleMetadata(
    { lifecycleStatus: 'Archived' },
    'missing-date',
  ),
  /must contain archivedAt/,
);

assert.throws(
  () => assertTuneLifecycleMetadata(
    { archivedAt: '2026-09-15' },
    'orphan-date',
  ),
  /require lifecycleStatus "Archived"/,
);

assert.throws(
  () => assertTuneLifecycleMetadata(
    { archiveReason: 'old' },
    'orphan-reason',
  ),
  /require lifecycleStatus "Archived"/,
);

assert.throws(
  () => assertTuneLifecycleMetadata(
    {
      lifecycleStatus: 'Archived',
      archivedAt: '2026-09-15',
      archiveReason: 'x'.repeat(501),
    },
    'long-reason',
  ),
  /500-character publication limit/,
);

console.log('Tune lifecycle policy tests: PASS');
