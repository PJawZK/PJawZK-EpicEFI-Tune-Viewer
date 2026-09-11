# Reserved validation authority

This directory is the repository-controlled authority for validation states that ordinary Tune Hub publication must not self-assign.

## Current reserved state

- `EpicEFI Verified`

Normal **Submit Tune**, **Edit Tune**, and **Create Revision** flows write only under `public/tunes/<tune-id>/` and do not update this authority file.

To grant a reserved state, a repository maintainer must deliberately update both:

1. the tune metadata `validationStatus`, and
2. `authority/validation-statuses.json`

The build rejects a reserved metadata state without an exact matching authority entry, stale authority entries, and authority/metadata mismatches.
