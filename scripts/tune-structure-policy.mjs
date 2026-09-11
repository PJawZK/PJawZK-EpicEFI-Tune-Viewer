export const REQUIRED_TUNE_FILES = Object.freeze([
  'metadata.json',
  'tune.msq',
]);

export const OPTIONAL_TUNE_FILES = Object.freeze([
  'mainController.ini',
]);

export const ALLOWED_TUNE_FILES = Object.freeze([
  ...REQUIRED_TUNE_FILES,
  ...OPTIONAL_TUNE_FILES,
]);

function fail(message) {
  throw new Error(message);
}

export function assertTuneFolderEntries(tuneId, entries) {
  const context = `public/tunes/${tuneId}`;

  if (!Array.isArray(entries)) {
    fail(`${context}: folder entries must be an array.`);
  }

  const names = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || entry.name === '') {
      fail(`${context}: contains an invalid directory entry.`);
    }

    if (names.has(entry.name)) {
      fail(`${context}: duplicate entry "${entry.name}".`);
    }
    names.add(entry.name);

    if (entry.isFile !== true) {
      fail(
        `${context}: "${entry.name}" is not a regular file. Nested directories, links, and other entry types are not allowed.`,
      );
    }

    if (!ALLOWED_TUNE_FILES.includes(entry.name)) {
      fail(
        `${context}: unexpected file "${entry.name}". Allowed files: ${ALLOWED_TUNE_FILES.join(', ')}.`,
      );
    }
  }

  for (const required of REQUIRED_TUNE_FILES) {
    if (!names.has(required)) {
      fail(`${context}: required file "${required}" is missing.`);
    }
  }

  return names;
}

export function assertCanonicalMetadataFiles(files, context = 'metadata.json') {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    fail(`${context}: "files" is required and must be an object.`);
  }

  const keys = Object.keys(files);
  if (!keys.every((key) => key === 'msq' || key === 'ini')) {
    fail(`${context}: files supports only "msq" and optional "ini".`);
  }

  if (files.msq !== 'tune.msq') {
    fail(`${context}: files.msq must be exactly "tune.msq".`);
  }

  if (files.ini !== undefined && files.ini !== 'mainController.ini') {
    fail(`${context}: files.ini must be exactly "mainController.ini" when supplied.`);
  }

  return {
    hasIni: files.ini === 'mainController.ini',
  };
}

export function assertMetadataMatchesFolderFiles(metadataFiles, folderNames, context = 'metadata.json') {
  const hasIniFile = folderNames.has('mainController.ini');

  if (metadataFiles.hasIni !== hasIniFile) {
    fail(
      metadataFiles.hasIni
        ? `${context}: metadata references mainController.ini, but the file is missing.`
        : `${context}: mainController.ini exists, but metadata does not reference it.`,
    );
  }
}
