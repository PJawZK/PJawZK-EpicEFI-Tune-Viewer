import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertAuthorityConsistency,
  assertTuneValidationAuthority,
  parseValidationAuthority,
  VALIDATION_STATUSES,
} from './validation-policy.mjs';
import { assertValidTuneId } from '../src/publicationPolicy.ts';
import {
  assertCanonicalMetadataFiles,
  assertMetadataMatchesFolderFiles,
  assertTuneFolderEntries,
} from './tune-structure-policy.mjs';

const root = process.cwd();
const tunesRoot = path.join(root, 'public', 'tunes');
const indexPath = path.join(tunesRoot, 'index.json');
const definitionRegistryPath = path.join(root, 'public', 'definitions', 'registry.json');
const validationAuthorityPath = path.join(root, 'authority', 'validation-statuses.json');

const classifications = new Set([
  'Normal',
  'Experimental',
  'Base Tune',
  'Development',
]);

const TEXT_LIMITS = {
  title: 160,
  summary: 1000,
  author: 120,
  ecuTarget: 120,
  firmwareSignature: 240,
  fuel: 120,
  ignition: 120,
  notes: 6000,
  versionLabel: 120,
  archiveReason: 500,
  vehicleMake: 80,
  vehicleModel: 120,
  vehicleTrim: 120,
  engineMake: 80,
  engineCode: 120,
  engineAspiration: 120,
  tag: 48,
};

const MAX_TAGS = 20;

function fail(message) {
  throw new Error(message);
}

function expectString(record, key, context, optional = false, maxLength) {
  const value = record[key];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${context}: "${key}" must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.trim().length > maxLength) {
    fail(
      `${context}: "${key}" exceeds the ${maxLength}-character publication limit.`,
    );
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

async function loadValidationAuthority() {
  let raw;
  try {
    raw = await readFile(validationAuthorityPath, 'utf8');
  } catch {
    fail('authority/validation-statuses.json is missing.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`authority/validation-statuses.json: invalid JSON: ${error.message}`);
  }

  return parseValidationAuthority(parsed);
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

async function loadTuneFolder(entry, definitionRegistry, validationAuthority) {
  try {
    assertValidTuneId(entry.name, `Tune folder "${entry.name}"`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const folder = path.join(tunesRoot, entry.name);
  const folderEntries = await readdir(folder, { withFileTypes: true });
  const folderNames = assertTuneFolderEntries(
    entry.name,
    folderEntries.map((folderEntry) => ({
      name: folderEntry.name,
      isFile: folderEntry.isFile(),
    })),
  );

  const metadataPath = path.join(folder, 'metadata.json');
  let raw;

  try {
    raw = await readFile(metadataPath, 'utf8');
  } catch (error) {
    fail(`${entry.name}/metadata.json: unable to read required file: ${error.message}`);
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
    'versionLabel', 'parentTuneId', 'lifecycleStatus', 'archivedAt',
    'archiveReason', 'files',
  ]) {
    // Allowed top-level keys are enumerated below.
  }

  const allowedTopLevel = new Set([
    'id', 'title', 'summary', 'author', 'publishedAt', 'updatedAt',
    'ecuTarget', 'firmwareSignature', 'validationStatus', 'classification',
    'vehicle', 'engine', 'fuel', 'ignition', 'injectorCc', 'powerHp',
    'stockPowerHp', 'torqueNm', 'boostBar', 'tags', 'notes',
    'versionLabel', 'parentTuneId', 'lifecycleStatus', 'archivedAt',
    'archiveReason', 'files',
  ]);
  for (const key of Object.keys(tune)) {
    if (!allowedTopLevel.has(key)) {
      fail(`${context}: unsupported property "${key}".`);
    }
  }

  expectString(tune, 'id', context);
  expectString(tune, 'title', context, false, TEXT_LIMITS.title);
  expectString(tune, 'author', context, false, TEXT_LIMITS.author);
  expectString(tune, 'publishedAt', context);
  expectString(tune, 'ecuTarget', context, false, TEXT_LIMITS.ecuTarget);
  expectString(
    tune,
    'firmwareSignature',
    context,
    false,
    TEXT_LIMITS.firmwareSignature,
  );
  expectString(tune, 'validationStatus', context);
  expectString(tune, 'classification', context);

  expectString(tune, 'summary', context, true, TEXT_LIMITS.summary);
  expectString(tune, 'updatedAt', context, true);
  expectString(tune, 'fuel', context, true, TEXT_LIMITS.fuel);
  expectString(tune, 'ignition', context, true, TEXT_LIMITS.ignition);
  expectString(tune, 'notes', context, true, TEXT_LIMITS.notes);
  expectString(tune, 'versionLabel', context, true, TEXT_LIMITS.versionLabel);
  expectString(tune, 'parentTuneId', context, true);
  expectString(tune, 'lifecycleStatus', context, true);
  expectString(tune, 'archivedAt', context, true);
  expectString(tune, 'archiveReason', context, true, TEXT_LIMITS.archiveReason);

  if (
    tune.lifecycleStatus !== undefined
    && tune.lifecycleStatus !== 'Archived'
  ) {
    fail(`${context}: lifecycleStatus must be exactly "Archived" when supplied.`);
  }
  if (tune.lifecycleStatus === 'Archived' && !tune.archivedAt) {
    fail(`${context}: archived tunes must contain archivedAt.`);
  }
  if (
    tune.lifecycleStatus !== 'Archived'
    && (tune.archivedAt !== undefined || tune.archiveReason !== undefined)
  ) {
    fail(`${context}: archivedAt/archiveReason require lifecycleStatus "Archived".`);
  }

  if (tune.id !== entry.name) {
    fail(`${context}: "id" must exactly match its folder name "${entry.name}".`);
  }
  try {
    assertValidTuneId(tune.id, `${context}: id`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!VALIDATION_STATUSES.has(tune.validationStatus)) {
    fail(`${context}: unsupported validationStatus "${tune.validationStatus}".`);
  }
  assertTuneValidationAuthority(tune, validationAuthority, context);
  if (!classifications.has(tune.classification)) {
    fail(`${context}: unsupported classification "${tune.classification}".`);
  }

  if (!Array.isArray(tune.tags) || !tune.tags.every((tag) => typeof tag === 'string')) {
    fail(`${context}: "tags" must be an array of strings.`);
  }
  if (tune.tags.length > MAX_TAGS) {
    fail(`${context}: "tags" supports at most ${MAX_TAGS} tags.`);
  }
  for (const tag of tune.tags) {
    if (tag.trim().length > TEXT_LIMITS.tag) {
      fail(
        `${context}: tags may contain at most ${TEXT_LIMITS.tag} characters each.`,
      );
    }
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
    expectString(
      tune.vehicle,
      'make',
      `${context}: vehicle`,
      true,
      TEXT_LIMITS.vehicleMake,
    );
    expectString(
      tune.vehicle,
      'model',
      `${context}: vehicle`,
      true,
      TEXT_LIMITS.vehicleModel,
    );
    expectString(
      tune.vehicle,
      'trim',
      `${context}: vehicle`,
      true,
      TEXT_LIMITS.vehicleTrim,
    );
    expectOptionalNumber(tune.vehicle, 'year', `${context}: vehicle`);
  }

  if (tune.engine) {
    expectString(
      tune.engine,
      'make',
      `${context}: engine`,
      true,
      TEXT_LIMITS.engineMake,
    );
    expectString(
      tune.engine,
      'code',
      `${context}: engine`,
      true,
      TEXT_LIMITS.engineCode,
    );
    expectString(
      tune.engine,
      'aspiration',
      `${context}: engine`,
      true,
      TEXT_LIMITS.engineAspiration,
    );
    expectOptionalNumber(tune.engine, 'displacementLiters', `${context}: engine`);
    expectOptionalNumber(tune.engine, 'cylinders', `${context}: engine`);
    expectOptionalNumber(tune.engine, 'compressionRatio', `${context}: engine`);
  }

  for (const key of ['injectorCc', 'powerHp', 'stockPowerHp', 'torqueNm', 'boostBar']) {
    expectOptionalNumber(tune, key, context);
  }

  const canonicalFiles = assertCanonicalMetadataFiles(tune.files, context);
  assertMetadataMatchesFolderFiles(canonicalFiles, folderNames, context);

  const msqPath = path.join(folder, 'tune.msq');
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

  if (canonicalFiles.hasIni) {
    const iniPath = path.join(folder, 'mainController.ini');
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
      msq: publicPrefix + 'tune.msq',
      ...(canonicalFiles.hasIni ? { ini: publicPrefix + 'mainController.ini' } : {}),
    },
  };
}

await mkdir(tunesRoot, { recursive: true });

const definitionRegistry = await loadDefinitionRegistry();
const validationAuthority = await loadValidationAuthority();
const entries = await readdir(tunesRoot, { withFileTypes: true });
const tunes = [];

for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const tune = await loadTuneFolder(entry, definitionRegistry, validationAuthority);
  tunes.push(tune);
}

const ids = new Set();
for (const tune of tunes) {
  if (ids.has(tune.id)) fail(`Duplicate tune id "${tune.id}".`);
  ids.add(tune.id);
}

assertAuthorityConsistency(tunes, validationAuthority);

for (const tune of tunes) {
  if (tune.parentTuneId && !ids.has(tune.parentTuneId)) {
    fail(`${tune.id}: parentTuneId "${tune.parentTuneId}" does not exist in this catalog.`);
  }
  if (tune.parentTuneId === tune.id) {
    fail(`${tune.id}: parentTuneId cannot reference the tune itself.`);
  }
}

const tuneById = new Map(tunes.map((tune) => [tune.id, tune]));
for (const tune of tunes) {
  const seen = new Set([tune.id]);
  let cursor = tune;

  while (cursor.parentTuneId) {
    if (seen.has(cursor.parentTuneId)) {
      fail(
        `${tune.id}: circular tune lineage detected through "${cursor.parentTuneId}".`,
      );
    }

    seen.add(cursor.parentTuneId);
    const parent = tuneById.get(cursor.parentTuneId);
    if (!parent) break;
    cursor = parent;
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
