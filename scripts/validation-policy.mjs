export const VALIDATION_STATUSES = new Set([
  'Unverified',
  'Starts/Idles',
  'Driven',
  'Road Tested',
  'Performance Tested',
  'Track Tested',
  'Dyno Tested',
  'EpicEFI Verified',
]);

export const RESERVED_VALIDATION_STATUSES = new Set([
  'EpicEFI Verified',
]);

const TUNE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function error(context, message) {
  throw new Error(`${context}: ${message}`);
}

export function parseValidationAuthority(
  value,
  context = 'authority/validation-statuses.json',
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    error(context, 'authority data must be a JSON object.');
  }

  const allowedKeys = new Set(['schema', 'tunes']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      error(context, `unsupported property "${key}".`);
    }
  }

  if (value.schema !== 1) {
    error(context, '"schema" must be exactly 1.');
  }

  if (!value.tunes || typeof value.tunes !== 'object' || Array.isArray(value.tunes)) {
    error(context, '"tunes" must be an object keyed by Tune ID.');
  }

  const authority = new Map();
  for (const [tuneId, status] of Object.entries(value.tunes)) {
    if (!TUNE_ID_PATTERN.test(tuneId)) {
      error(context, `invalid Tune ID "${tuneId}".`);
    }
    if (typeof status !== 'string' || !RESERVED_VALIDATION_STATUSES.has(status)) {
      error(
        context,
        `Tune ID "${tuneId}" may only be assigned a reserved validation status. `
        + `Received "${String(status)}".`,
      );
    }
    authority.set(tuneId, status);
  }

  return authority;
}

export function assertTuneValidationAuthority(tune, authority, context) {
  if (!VALIDATION_STATUSES.has(tune.validationStatus)) {
    error(context, `unsupported validationStatus "${tune.validationStatus}".`);
  }

  if (!RESERVED_VALIDATION_STATUSES.has(tune.validationStatus)) return;

  const authorizedStatus = authority.get(tune.id);
  if (authorizedStatus !== tune.validationStatus) {
    error(
      context,
      `validationStatus "${tune.validationStatus}" is reserved and requires an exact `
      + 'matching entry in authority/validation-statuses.json.',
    );
  }
}

export function assertAuthorityConsistency(tunes, authority) {
  const byId = new Map(tunes.map((tune) => [tune.id, tune]));

  for (const [tuneId, status] of authority) {
    const tune = byId.get(tuneId);
    if (!tune) {
      error(
        'authority/validation-statuses.json',
        `reserved validation entry for missing Tune ID "${tuneId}".`,
      );
    }

    if (tune.validationStatus !== status) {
      error(
        'authority/validation-statuses.json',
        `Tune ID "${tuneId}" authorizes "${status}" but metadata contains `
        + `"${tune.validationStatus}".`,
      );
    }
  }
}
