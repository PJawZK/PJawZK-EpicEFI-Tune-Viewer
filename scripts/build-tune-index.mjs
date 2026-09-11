import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tunesRoot = path.join(root, 'public', 'tunes');
const indexPath = path.join(tunesRoot, 'index.json');
const definitionRegistryPath = path.join(root, 'public', 'definitions', 'registry.json');

const validationStatuses = new Set([
  'Unverified',
  'Starts/Idles',
  'Driven',
  'Road Tested',
  'Performance Tested',
  'Track Tested',
  'Dyno Tested',
  'EpicEFI Verified',
]);

const classifications = new Set([
  'Normal',
  'Experimental',
  'Base Tune',
  'Development',
]);

function fail(message) {
  throw new Error(message);
}

function expectString(record, key, context, optional = false) {
  const value = record[key];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${context}: "${key}" must be a non-empty string.`);
  }
}

function expectOptionalNumber(record, key, context) {
  const value = record[key];
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    fail(`${context}: "${key}" must be a finite number when supplied.`);
  }
}

function validateRelativeFileName(value, extension, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${context}: file name must be a non-empty string.`);
  }

  if (
    value.includes('..')
    || value.includes('/')
    || value.includes('\\')
    || /^[a-z]+:/i.test(value)
  ) {
    fail(`${context}: file paths must be simple file names inside the tune folder.`);
  }

  if (!value.toLowerCase().endsWith(extension)) {
    fail(`${context}: expected a ${extension} file.`);
  }
}

async function assertFileExists(filePath, context) {
  try {
    await access(filePath);
  } catch {
    fail(`${context}: referenced file does not exist.`);
  }
}

function extractMsqSignature(raw, context) {
  const versionInfo = raw.match(
    /<(?:[A-Za-z0-9_.-]+:)?versionInfo\b[^>]*>/i,
  )?.[0];

  if (!versionInfo) {
    fail(`${context}: MSQ versionInfo is missing.`);
  }

  const signature = versionInfo.match(
    /\bsignature\s*=\s*["']([^"']+)["']/i,
  )?.[1]?.trim();

  if (!signature) {
    fail(`${context}: MSQ firmware signature is missing.`);
  }

  return signature;
}

function extractIniSignature(raw, context) {
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

  fail(`${context}: INI firmware signature is missing.`);
}

async function loadDefinitionRegistry() {
  let raw;
  try {
    raw = await readFile(definitionRegistryPath, 'utf8');
  } catch {
    fail('public/definitions/registry.json is missing. Run the definition build first.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`public/definitions/registry.json: invalid JSON: ${error.message}`);
  }

  if (!parsed || !Array.isArray(parsed.definitions)) {
    fail('public/definitions/registry.json: "definitions" must be an array.');
  }

  return new Map(
    parsed.definitions.map((entry) => [entry.signature, entry]),
  );
}

function validateNestedObject(value, allowedKeys, context) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context} must be an object when supplied.`);
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${context}: unsupported property "${key}".`);
    }
  }
}

async function loadTuneFolder(entry, definitionRegistry) {
  const folder = path.join(tunesRoot, entry.name);
  const metadataPath = path.join(folder, 'metadata.json');
  let raw;

  try {
    raw = await readFile(metadataPath, 'utf8');
  } catch {
    return null;
  }

  let tune;
  try {
    tune = JSON.parse(raw);
  } catch (error) {
    fail(`${entry.name}/metadata.json: invalid JSON: ${error.message}`);
  }

  const context = `${entry.name}/metadata.json`;
  if (!tune || typeof tune !== 'object' || Array.isArray(tune)) {
    fail(`${context}: metadata must be a JSON object.`);
  }

  for (const key of [
    'id', 'title', 'summary', 'author', 'publishedAt', 'updatedAt',
    'ecuTarget', 'firmwareSignature', 'validationStatus', 'classification',
    'vehicle', 'engine', 'fuel', 'ignition', 'injectorCc', 'powerHp',
    'stockPowerHp', 'torqueNm', 'boostBar', 'tags', 'notes',
    'versionLabel', 'parentTuneId', 'files',
  ]) {
    // Allowed top-level keys are enumerated below.
  }

  const allowedTopLevel = new Set([
    'id', 'title', 'summary', 'author', 'publishedAt', 'updatedAt',
    'ecuTarget', 'firmwareSignature', 'validationStatus', 'classification',
    'vehicle', 'engine', 'fuel', 'ignition', 'injectorCc', 'powerHp',
    'stockPowerHp', 'torqueNm', 'boostBar', 'tags', 'notes',
    'versionLabel', 'parentTuneId', 'files',
  ]);
  for (const key of Object.keys(tune)) {
    if (!allowedTopLevel.has(key)) {
      fail(`${context}: unsupported property "${key}".`);
    }
  }

  for (const key of [
    'id', 'title', 'author', 'publishedAt', 'ecuTarget',
    'firmwareSignature', 'validationStatus', 'classification',
  ]) {
    expectString(tune, key, context);
  }

  for (const key of [
    'summary', 'updatedAt', 'fuel', 'ignition', 'notes',
    'versionLabel', 'parentTuneId',
  ]) {
    expectString(tune, key, context, true);
  }

  if (tune.id !== entry.name) {
    fail(`${context}: "id" must exactly match its folder name "${entry.name}".`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(tune.id)) {
    fail(`${context}: id may contain lowercase letters, digits, ".", "_" and "-" only.`);
  }
  if (!validationStatuses.has(tune.validationStatus)) {
    fail(`${context}: unsupported validationStatus "${tune.validationStatus}".`);
  }
  if (!classifications.has(tune.classification)) {
    fail(`${context}: unsupported classification "${tune.classification}".`);
  }

  if (!Array.isArray(tune.tags) || !tune.tags.every((tag) => typeof tag === 'string')) {
    fail(`${context}: "tags" must be an array of strings.`);
  }

  validateNestedObject(
    tune.vehicle,
    new Set(['make', 'model', 'year', 'trim']),
    `${context}: vehicle`,
  );
  validateNestedObject(
    tune.engine,
    new Set(['make', 'code', 'displacementLiters', 'cylinders', 'aspiration', 'compressionRatio']),
    `${context}: engine`,
  );

  if (tune.vehicle) {
    expectString(tune.vehicle, 'make', `${context}: vehicle`, true);
    expectString(tune.vehicle, 'model', `${context}: vehicle`, true);
    expectString(tune.vehicle, 'trim', `${context}: vehicle`, true);
    expectOptionalNumber(tune.vehicle, 'year', `${context}: vehicle`);
  }

  if (tune.engine) {
    expectString(tune.engine, 'make', `${context}: engine`, true);
    expectString(tune.engine, 'code', `${context}: engine`, true);
    expectString(tune.engine, 'aspiration', `${context}: engine`, true);
    expectOptionalNumber(tune.engine, 'displacementLiters', `${context}: engine`);
    expectOptionalNumber(tune.engine, 'cylinders', `${context}: engine`);
    expectOptionalNumber(tune.engine, 'compressionRatio', `${context}: engine`);
  }

  for (const key of ['injectorCc', 'powerHp', 'stockPowerHp', 'torqueNm', 'boostBar']) {
    expectOptionalNumber(tune, key, context);
  }

  if (!tune.files || typeof tune.files !== 'object' || Array.isArray(tune.files)) {
    fail(`${context}: "files" is required.`);
  }

  const fileKeys = Object.keys(tune.files);
  if (!fileKeys.every((key) => key === 'msq' || key === 'ini')) {
    fail(`${context}: files supports only "msq" and optional "ini".`);
  }

  validateRelativeFileName(tune.files.msq, '.msq', `${context}: files.msq`);
  const msqPath = path.join(folder, tune.files.msq);
  await assertFileExists(msqPath, `${context}: files.msq`);

  const msqSignature = extractMsqSignature(
    await readFile(msqPath, 'utf8'),
    `${context}: files.msq`,
  );

  if (msqSignature !== tune.firmwareSignature) {
    fail(
      `${context}: firmwareSignature does not match the MSQ. `
      + `Metadata="${tune.firmwareSignature}", MSQ="${msqSignature}".`,
    );
  }

  if (tune.files.ini !== undefined) {
    validateRelativeFileName(tune.files.ini, '.ini', `${context}: files.ini`);
    const iniPath = path.join(folder, tune.files.ini);
    await assertFileExists(iniPath, `${context}: files.ini`);

    const iniSignature = extractIniSignature(
      await readFile(iniPath, 'utf8'),
      `${context}: files.ini`,
    );

    if (iniSignature !== msqSignature) {
      fail(
        `${context}: INI signature does not match the MSQ. `
        + `MSQ="${msqSignature}", INI="${iniSignature}".`,
      );
    }
  } else {
    const registryEntry = definitionRegistry.get(msqSignature);
    if (!registryEntry) {
      fail(
        `${context}: no INI is included and exact firmware signature "${msqSignature}" `
        + 'is not present in the public definition registry.',
      );
    }

    if (
      typeof registryEntry.ecuTarget === 'string'
      && registryEntry.ecuTarget
      && registryEntry.ecuTarget !== tune.ecuTarget
    ) {
      fail(
        `${context}: ecuTarget "${tune.ecuTarget}" does not match registered target `
        + `"${registryEntry.ecuTarget}" for this firmware signature.`,
      );
    }
  }

  const publicPrefix = `tunes/${tune.id}/`;
  return {
    ...tune,
    files: {
      msq: publicPrefix + tune.files.msq,
      ...(tune.files.ini ? { ini: publicPrefix + tune.files.ini } : {}),
    },
  };
}

await mkdir(tunesRoot, { recursive: true });

const definitionRegistry = await loadDefinitionRegistry();
const entries = await readdir(tunesRoot, { withFileTypes: true });
const tunes = [];

for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const tune = await loadTuneFolder(entry, definitionRegistry);
  if (tune) tunes.push(tune);
}

const ids = new Set();
for (const tune of tunes) {
  if (ids.has(tune.id)) fail(`Duplicate tune id "${tune.id}".`);
  ids.add(tune.id);
}

for (const tune of tunes) {
  if (tune.parentTuneId && !ids.has(tune.parentTuneId)) {
    fail(`${tune.id}: parentTuneId "${tune.parentTuneId}" does not exist in this catalog.`);
  }
}

tunes.sort((left, right) => {
  const leftTime = new Date(left.publishedAt).getTime();
  const rightTime = new Date(right.publishedAt).getTime();
  return rightTime - leftTime;
});

const index = {
  schema: 1,
  tunes,
};

await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`Validated and indexed ${tunes.length} published tune(s).`);
