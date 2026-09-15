export const TUNE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_TUNE_ID_LENGTH = 96;

export const RESERVED_TUNE_IDS = new Set([
  'index.json',
  'readme.md',
  'base_map_import_notes.md',
]);

export const TUNE_FILE_NAMES = [
  'metadata.json',
  'tune.msq',
  'mainController.ini',
] as const;

export type TuneFileName = (typeof TUNE_FILE_NAMES)[number];
export type TuneWriteMode = 'create' | 'edit';

type PathRecord = {
  path: string;
};

function fail(message: string): never {
  throw new Error(message);
}

export function assertValidTuneId(
  tuneId: string,
  context = 'Tune ID',
): string {
  if (typeof tuneId !== 'string' || tuneId === '') {
    fail(`${context} must be a non-empty string.`);
  }
  if (tuneId !== tuneId.trim()) {
    fail(`${context} must not contain leading or trailing whitespace.`);
  }
  if (tuneId.length > MAX_TUNE_ID_LENGTH) {
    fail(`${context} exceeds the ${MAX_TUNE_ID_LENGTH}-character limit.`);
  }
  if (!TUNE_ID_PATTERN.test(tuneId)) {
    fail(
      `${context} "${tuneId}" may contain lowercase letters, digits, ".", "_" and "-" only.`,
    );
  }
  if (RESERVED_TUNE_IDS.has(tuneId)) {
    fail(`${context} "${tuneId}" is reserved by the Tune Hub repository.`);
  }
  return tuneId;
}

export function tuneFolderPath(tuneId: string): string {
  return `public/tunes/${assertValidTuneId(tuneId)}`;
}

export function tuneFilePath(
  tuneId: string,
  fileName: TuneFileName,
): string {
  return `${tuneFolderPath(tuneId)}/${fileName}`;
}

function tuneFileNameFromPath(tuneId: string, path: string): TuneFileName {
  const prefix = `${tuneFolderPath(tuneId)}/`;
  if (!path.startsWith(prefix)) {
    fail(
      `Write target "${path}" is outside the intended tune folder "${prefix}".`,
    );
  }

  const fileName = path.slice(prefix.length);
  if (!(TUNE_FILE_NAMES as readonly string[]).includes(fileName)) {
    fail(
      `Write target "${path}" is not a supported published tune file. `
      + `Allowed files: ${TUNE_FILE_NAMES.join(', ')}.`,
    );
  }

  if (path !== tuneFilePath(tuneId, fileName as TuneFileName)) {
    fail(`Write target "${path}" is not a canonical tune path.`);
  }

  return fileName as TuneFileName;
}

export function assertTuneWriteTargets(
  tuneId: string,
  files: PathRecord[],
  mode: TuneWriteMode,
): Set<TuneFileName> {
  assertValidTuneId(tuneId);

  if (!Array.isArray(files) || files.length === 0) {
    fail('Tune publication must contain at least one file.');
  }

  const names = new Set<TuneFileName>();
  const paths = new Set<string>();

  for (const file of files) {
    if (!file || typeof file.path !== 'string' || file.path === '') {
      fail('Tune publication contains an invalid file path.');
    }
    if (paths.has(file.path)) {
      fail(`Tune publication contains duplicate write target "${file.path}".`);
    }
    paths.add(file.path);

    const name = tuneFileNameFromPath(tuneId, file.path);
    if (names.has(name)) {
      fail(`Tune publication contains duplicate file "${name}".`);
    }
    names.add(name);
  }

  if (!names.has('metadata.json')) {
    fail('Tune publication is missing metadata.json.');
  }

  if (mode === 'create' && !names.has('tune.msq')) {
    fail('New tune publication is missing tune.msq.');
  }

  return names;
}

export function assertTuneDeleteTargets(
  tuneId: string,
  deletePaths: string[],
): Set<TuneFileName> {
  assertValidTuneId(tuneId);

  const names = new Set<TuneFileName>();
  const paths = new Set<string>();

  for (const path of deletePaths) {
    if (typeof path !== 'string' || path === '') {
      fail('Tune edit contains an invalid delete path.');
    }
    if (paths.has(path)) {
      fail(`Tune edit contains duplicate delete target "${path}".`);
    }
    paths.add(path);

    const name = tuneFileNameFromPath(tuneId, path);
    if (name !== 'mainController.ini') {
      fail(
        `Tune edit may delete only mainController.ini; received "${name}".`,
      );
    }
    names.add(name);
  }

  return names;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('metadata.json must contain a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function assertTuneMetadataIdentity(
  value: unknown,
  tuneId: string,
  firmwareSignature: string,
): {
  hasIni: boolean;
  parentTuneId?: string;
} {
  assertValidTuneId(tuneId);
  const metadata = record(value);

  if (metadata.id !== tuneId) {
    fail(
      `metadata.json id "${String(metadata.id)}" does not match intended Tune ID "${tuneId}".`,
    );
  }

  if (
    typeof firmwareSignature !== 'string'
    || firmwareSignature === ''
    || metadata.firmwareSignature !== firmwareSignature
  ) {
    fail(
      'metadata.json firmwareSignature does not match the firmware signature '
      + 'being published by this operation.',
    );
  }

  const files = record(metadata.files);
  const keys = Object.keys(files);
  if (!keys.every((key) => key === 'msq' || key === 'ini')) {
    fail('metadata.json files contains an unsupported file reference.');
  }
  if (files.msq !== 'tune.msq') {
    fail('metadata.json files.msq must be exactly "tune.msq".');
  }
  if (files.ini !== undefined && files.ini !== 'mainController.ini') {
    fail('metadata.json files.ini must be exactly "mainController.ini" when supplied.');
  }

  const parentTuneId = metadata.parentTuneId;
  if (parentTuneId !== undefined) {
    if (typeof parentTuneId !== 'string' || parentTuneId.trim() === '') {
      fail('metadata.json parentTuneId must be a non-empty string when supplied.');
    }
    assertValidTuneId(parentTuneId, 'metadata.json parentTuneId');
    if (parentTuneId === tuneId) {
      fail('metadata.json parentTuneId cannot reference the tune itself.');
    }
  }

  return {
    hasIni: files.ini === 'mainController.ini',
    ...(typeof parentTuneId === 'string' ? { parentTuneId } : {}),
  };
}

export function assertMetadataMatchesFinalFiles(
  metadata: { hasIni: boolean },
  finalFileNames: Set<TuneFileName>,
): void {
  if (!finalFileNames.has('metadata.json')) {
    fail('Final tune folder would be missing metadata.json.');
  }
  if (!finalFileNames.has('tune.msq')) {
    fail('Final tune folder would be missing tune.msq.');
  }

  const hasIniFile = finalFileNames.has('mainController.ini');
  if (metadata.hasIni !== hasIniFile) {
    fail(
      metadata.hasIni
        ? 'metadata.json references mainController.ini, but the final tune folder would not contain it.'
        : 'The final tune folder would contain mainController.ini, but metadata.json does not reference it.',
    );
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalizeJson(source[key])]),
    );
  }

  return value;
}

function parseSnapshotJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    fail(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function assertMetadataSnapshotMatches(
  currentRaw: string,
  expectedRaw: string,
  tuneId: string,
): void {
  const current = canonicalizeJson(parseSnapshotJson(currentRaw, 'Live metadata.json'));
  const expected = canonicalizeJson(parseSnapshotJson(expectedRaw, 'Loaded metadata.json'));

  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    fail(
      `Published tune "${tuneId}" changed after this page was loaded. Reload the tune before saving so a newer edit is not overwritten.`,
    );
  }
}
