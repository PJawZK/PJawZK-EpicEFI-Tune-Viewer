const TUNE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_TUNE_IDS = new Set([
  'index.json',
  'readme.md',
  'base_map_import_notes.md',
]);
const PUBLIC_VALIDATION_STATUSES = new Set([
  'Unverified',
  'Starts/Idles',
  'Driven',
  'Road Tested',
  'Performance Tested',
  'Track Tested',
  'Dyno Tested',
]);
const CLASSIFICATIONS = new Set([
  'Normal',
  'Experimental',
  'Base Tune',
  'Development',
]);
const TOP_LEVEL_KEYS = new Set([
  'id', 'title', 'summary', 'author', 'publishedAt', 'updatedAt',
  'ecuTarget', 'firmwareSignature', 'validationStatus', 'classification',
  'vehicle', 'engine', 'fuel', 'ignition', 'injectorCc', 'powerHp',
  'stockPowerHp', 'torqueNm', 'boostBar', 'tags', 'notes',
  'versionLabel', 'parentTuneId', 'files',
]);
const VEHICLE_KEYS = new Set(['make', 'model', 'year', 'trim']);
const ENGINE_KEYS = new Set([
  'make', 'code', 'displacementLiters', 'cylinders', 'aspiration', 'compressionRatio',
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function requireString(value, name, maxLength = 512) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    fail(`${name} exceeds the ${maxLength}-character public submission limit.`);
  }
  return trimmed;
}

function optionalString(value, name, maxLength) {
  if (value === undefined) return undefined;
  return requireString(value, name, maxLength);
}

function optionalNumber(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be a finite number when supplied.`);
  }
  return value;
}

function copyNested(value, keys, name, limits = {}) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object when supplied.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail(`${name} contains unsupported property "${key}".`);
  }

  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    if (typeof raw === 'string') {
      result[key] = requireString(raw, `${name}.${key}`, limits[key] ?? 160);
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      result[key] = raw;
    } else {
      fail(`${name}.${key} has an unsupported value.`);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function assertPublicTuneId(value, name = 'Tune ID') {
  const id = requireString(value, name, 96);
  if (!TUNE_ID_PATTERN.test(id)) {
    fail(`${name} "${id}" may contain lowercase letters, digits, ".", "_" and "-" only.`);
  }
  if (RESERVED_TUNE_IDS.has(id)) {
    fail(`${name} "${id}" is reserved by the Tune Hub repository.`);
  }
  return id;
}

export function extractMsqSignature(raw) {
  if (typeof raw !== 'string') fail('MSQ content must be text.');
  const versionInfo = raw.match(/<(?:[A-Za-z0-9_.-]+:)?versionInfo\b[^>]*>/i)?.[0];
  if (!versionInfo) fail('MSQ versionInfo is missing.');
  const signature = versionInfo.match(/\bsignature\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (!signature) fail('MSQ firmware signature is missing.');
  return signature;
}

export function extractIniSignature(raw) {
  if (typeof raw !== 'string') fail('INI content must be text.');
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let section = '';

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'MegaTune' && section !== 'TunerStudio') continue;
    const signature = line.match(/^signature\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (signature) return signature;
  }

  fail('INI firmware signature is missing.');
}

function parseMetadata(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    fail(`metadata.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('metadata.json must contain an object.');
  }
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(`metadata.json contains unsupported property "${key}".`);
  }
  return parsed;
}

export function normalizePublicMetadata(raw, { hasIni, publishedAt }) {
  const source = parseMetadata(raw);
  const id = assertPublicTuneId(source.id);
  const parentTuneId = source.parentTuneId === undefined
    ? undefined
    : assertPublicTuneId(source.parentTuneId, 'metadata.json parentTuneId');

  if (parentTuneId === id) {
    fail('metadata.json parentTuneId cannot reference the tune itself.');
  }

  if (source.validationStatus === 'EpicEFI Verified') {
    fail('EpicEFI Verified is reserved and cannot be assigned by public submission.');
  }
  if (!PUBLIC_VALIDATION_STATUSES.has(source.validationStatus)) {
    fail(
      `metadata.json validationStatus "${String(source.validationStatus)}" is not supported for public submission.`,
    );
  }
  if (!CLASSIFICATIONS.has(source.classification)) {
    fail(`metadata.json classification "${String(source.classification)}" is not supported.`);
  }

  if (!Array.isArray(source.tags) || !source.tags.every((tag) => typeof tag === 'string')) {
    fail('metadata.json tags must be an array of strings.');
  }

  const tags = [...new Set(
    source.tags
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
  if (tags.length > 20) fail('metadata.json tags supports at most 20 unique non-empty tags.');
  for (const tag of tags) {
    if (tag.length > 48) fail('metadata.json tags may contain at most 48 characters each.');
  }

  const vehicle = copyNested(
    source.vehicle,
    VEHICLE_KEYS,
    'metadata.json vehicle',
    { make: 80, model: 120, trim: 120 },
  );
  const engine = copyNested(
    source.engine,
    ENGINE_KEYS,
    'metadata.json engine',
    { make: 80, code: 120, aspiration: 120 },
  );

  return {
    id,
    title: requireString(source.title, 'metadata.json title', 160),
    ...(optionalString(source.summary, 'metadata.json summary', 1000)
      ? { summary: source.summary.trim() } : {}),
    author: requireString(source.author, 'metadata.json author', 120),
    publishedAt,
    ecuTarget: requireString(source.ecuTarget, 'metadata.json ecuTarget', 120),
    firmwareSignature: requireString(
      source.firmwareSignature,
      'metadata.json firmwareSignature',
      240,
    ),
    validationStatus: source.validationStatus,
    classification: source.classification,
    ...(vehicle ? { vehicle } : {}),
    ...(engine ? { engine } : {}),
    ...(optionalString(source.fuel, 'metadata.json fuel', 120)
      ? { fuel: source.fuel.trim() } : {}),
    ...(optionalString(source.ignition, 'metadata.json ignition', 120)
      ? { ignition: source.ignition.trim() } : {}),
    ...(source.injectorCc !== undefined
      ? { injectorCc: optionalNumber(source.injectorCc, 'metadata.json injectorCc') } : {}),
    ...(source.powerHp !== undefined
      ? { powerHp: optionalNumber(source.powerHp, 'metadata.json powerHp') } : {}),
    ...(source.stockPowerHp !== undefined
      ? { stockPowerHp: optionalNumber(source.stockPowerHp, 'metadata.json stockPowerHp') } : {}),
    ...(source.torqueNm !== undefined
      ? { torqueNm: optionalNumber(source.torqueNm, 'metadata.json torqueNm') } : {}),
    ...(source.boostBar !== undefined
      ? { boostBar: optionalNumber(source.boostBar, 'metadata.json boostBar') } : {}),
    tags,
    ...(optionalString(source.notes, 'metadata.json notes', 6000)
      ? { notes: source.notes.trim() } : {}),
    ...(optionalString(source.versionLabel, 'metadata.json versionLabel', 120)
      ? { versionLabel: source.versionLabel.trim() } : {}),
    ...(parentTuneId ? { parentTuneId } : {}),
    files: {
      msq: 'tune.msq',
      ...(hasIni ? { ini: 'mainController.ini' } : {}),
    },
  };
}

export function validatePublicPackage({
  metadata,
  msqText,
  iniText,
  registry,
  publishedAt,
}) {
  const hasIni = typeof iniText === 'string';
  const normalized = normalizePublicMetadata(metadata, { hasIni, publishedAt });
  const msqSignature = extractMsqSignature(msqText);

  if (normalized.firmwareSignature !== msqSignature) {
    fail(
      `metadata firmwareSignature does not match MSQ. Metadata="${normalized.firmwareSignature}", MSQ="${msqSignature}".`,
    );
  }

  if (hasIni) {
    const iniSignature = extractIniSignature(iniText);
    if (iniSignature !== msqSignature) {
      fail(
        `INI signature does not match MSQ. MSQ="${msqSignature}", INI="${iniSignature}".`,
      );
    }
  } else {
    const definitions = Array.isArray(registry?.definitions) ? registry.definitions : [];
    const exact = definitions.find((entry) => entry?.signature === msqSignature);
    if (!exact) {
      fail(
        `No INI was supplied and exact firmware signature "${msqSignature}" is not registered.`,
      );
    }
    if (
      typeof exact.ecuTarget === 'string'
      && exact.ecuTarget
      && exact.ecuTarget !== normalized.ecuTarget
    ) {
      fail(
        `ECU target "${normalized.ecuTarget}" does not match registered target "${exact.ecuTarget}".`,
      );
    }
  }

  return normalized;
}

export function publicErrorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 500;
}
