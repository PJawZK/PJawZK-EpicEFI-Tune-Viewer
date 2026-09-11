import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const sourcesRoot = path.join(root, 'definitions', 'sources');
const publicRoot = path.join(root, 'public', 'definitions');
const generatedRoot = path.join(publicRoot, 'generated');
const registryPath = path.join(publicRoot, 'registry.json');

function fail(message) {
  throw new Error(message);
}

function safeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function inferEcuTarget(signature) {
  const mega = signature.match(/\b(MEGA[0-9A-Z_-]+)\b/i);
  if (mega) return mega[1].toUpperCase();

  const parts = signature.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] ?? '')) {
    return parts[parts.length - 2] ?? '';
  }

  const targetish = [...parts].reverse().find(
    (part) => /^[A-Z][A-Z0-9_-]{2,}$/i.test(part) && !/^master$/i.test(part),
  );
  return targetish?.toUpperCase() ?? '';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadSharedIniParser() {
  const sourcePath = path.join(root, 'src', 'ini.ts');

  let module;
  try {
    module = await import(pathToFileURL(sourcePath).href);
  } catch (error) {
    fail(
      'Unable to load shared src/ini.ts parser with the current Node runtime. '
      + 'Use Node 24 or newer for definition generation. '
      + (error instanceof Error ? error.message : String(error)),
    );
  }

  if (typeof module.parseIni !== 'function') {
    fail('Shared src/ini.ts parser did not export parseIni().');
  }

  return module.parseIni;
}

async function readMetadata(folder, id) {
  const metadataPath = path.join(folder, 'metadata.json');
  if (!(await fileExists(metadataPath))) return {};

  let parsed;
  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    fail(`${id}/metadata.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${id}/metadata.json must contain a JSON object.`);
  }

  const allowed = new Set(['ecuTarget', 'label', 'source', 'expectedSignature']);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) fail(`${id}/metadata.json contains unsupported property "${key}".`);
  }

  const metadata = {};
  for (const key of allowed) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) {
      fail(`${id}/metadata.json property "${key}" must be a non-empty string.`);
    }
    metadata[key] = value.trim();
  }

  return metadata;
}

function dictionary(values) {
  const unique = [];
  const index = new Map();

  for (const value of values) {
    if (index.has(value)) continue;
    index.set(value, unique.length);
    unique.push(value);
  }

  return { values: unique, index };
}

function compactMenuItem(item) {
  if (item.type === 'separator') return ['s'];

  if (item.type === 'group') {
    return ['g', item.title, item.children.map(compactMenuItem)];
  }

  const compact = ['i', item.target];
  if (item.title && item.title !== item.target) compact[2] = item.title;
  if (item.condition) compact[3] = item.condition;
  return compact;
}

function createPack(parsed, ecuTarget) {
  const kindDictionary = dictionary(parsed.constants.map((entry) => entry.kind));
  const typeDictionary = dictionary(parsed.constants.map((entry) => entry.dataType));
  const unitDictionary = dictionary(parsed.constants.map((entry) => entry.units));

  return {
    schema: 2,
    signature: parsed.signature,
    ecuTarget,
    definitionCount: parsed.constants.length,
    tableCount: parsed.tables.length,
    kinds: kindDictionary.values,
    types: typeDictionary.values,
    units: unitDictionary.values,
    definitions: parsed.constants.map((entry) => [
      entry.name,
      kindDictionary.index.get(entry.kind),
      typeDictionary.index.get(entry.dataType),
      entry.page,
      entry.offset,
      unitDictionary.index.get(entry.units),
      entry.rows,
      entry.cols,
      entry.scale,
      entry.translate,
      entry.digits,
      entry.min,
      entry.max,
      entry.options.length ? entry.options : undefined,
    ]),
    tables: parsed.tables.map((entry) => [
      entry.id,
      entry.mapId,
      entry.title,
      entry.page,
      entry.help,
      entry.xBins,
      entry.yBins,
      entry.zBins,
      entry.xLabel,
      entry.yLabel,
    ]),
    menus: parsed.menus.map((menu) => [
      menu.id,
      menu.title,
      menu.items.map(compactMenuItem),
    ]),
    dialogs: parsed.dialogs.map((dialog) => [
      dialog.id,
      dialog.title,
      dialog.layout,
      dialog.help,
      dialog.fields.map((field) => [
        field.title,
        field.name,
        field.condition,
      ]),
      dialog.panels.map((panel) => [
        panel.name,
        panel.layout,
        panel.condition,
      ]),
    ]),
    curves: parsed.curves.map((curve) => [
      curve.id,
      curve.title,
      curve.labels,
      curve.xBins,
      curve.yBins,
      curve.xAxis,
      curve.yAxis,
      curve.gauge,
    ]),
    labelSets: parsed.labelSets,
  };
}

const parseIni = await loadSharedIniParser();

function runSelfTest() {
  const fixture = `
[MegaTune]
signature = "EpicEFI test.TESTTARGET.1"

[Constants]
page = 1
rpmLimit = scalar, U16, 0, "rpm", 1, 0, 0, 10000, 0
ignitionMode = bits, U08, 2, [0:1], "Single Coil", "Wasted Spark"
rpmBins = array, U16, 4, [4], "rpm", 1, 0, 0, 8000, 0
loadBins = array, U16, 12, [4], "kPa", 1, 0, 0, 300, 0
fuelTable = array, U16, 20, [4x4], "%", 1, 0, 0, 200, 0
curveX = array, U16, 52, [4], "degC", 1, 0, -40, 120, 0
curveY = array, U16, 60, [4], "rpm", 1, 0, 0, 8000, 0

[TableEditor]
table = fuelTbl, fuelMap, "Fuel Table", 1
  xBins = rpmBins
  yBins = loadBins
  zBins = fuelTable
  xyLabels = "RPM", "Load"

[CurveEditor]
curve = limitCurve, "Limit Curve"
  columnLabel = "Coolant", "RPM Limit"
  xBins = curveX
  yBins = curveY
  xAxis = -40, 120, 9
  yAxis = 0, 8000, 9

[UserDefined]
dialog = fuelDialog, "Fuel Settings"
  field = "RPM Limit", rpmLimit
  panel = fuelTbl

[Menu]
menu = "&Fuel"
  subMenu = fuelDialog, "Fuel Settings"
`;

  const parsed = parseIni(fixture);
  if (parsed.signature !== 'EpicEFI test.TESTTARGET.1') {
    fail('Definition pipeline self-test failed to preserve firmware signature.');
  }
  if (parsed.constants.length !== 7) {
    fail(`Definition pipeline self-test expected 7 constants, got ${parsed.constants.length}.`);
  }
  if (parsed.tables.length !== 1 || parsed.curves.length !== 1) {
    fail('Definition pipeline self-test failed to preserve table/curve metadata.');
  }
  if (parsed.dialogs.length !== 1 || parsed.menus.length !== 1) {
    fail('Definition pipeline self-test failed to preserve dialog/menu metadata.');
  }

  const pack = createPack(parsed, 'TESTTARGET');
  if (
    pack.definitionCount !== parsed.constants.length
    || pack.tableCount !== parsed.tables.length
    || pack.menus.length !== parsed.menus.length
    || pack.dialogs.length !== parsed.dialogs.length
    || pack.curves.length !== parsed.curves.length
  ) {
    fail('Definition pipeline self-test failed while compacting viewer metadata.');
  }

  console.log('Definition pipeline self-test: PASS');
}

runSelfTest();

await mkdir(sourcesRoot, { recursive: true });
await mkdir(publicRoot, { recursive: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(generatedRoot, { recursive: true });

const sourceEntries = await readdir(sourcesRoot, { withFileTypes: true });
const registryEntries = [];
const signatures = new Map();

for (const entry of sourceEntries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) continue;

  const id = entry.name;
  if (safeSlug(id) !== id) {
    fail(`Definition source folder "${id}" must already be a lowercase-safe id.`);
  }

  const folder = path.join(sourcesRoot, id);
  const iniPath = path.join(folder, 'mainController.ini');
  if (!(await fileExists(iniPath))) {
    fail(`${id}: missing mainController.ini.`);
  }

  const metadata = await readMetadata(folder, id);
  const rawIni = await readFile(iniPath, 'utf8');
  const parsed = parseIni(rawIni);

  if (metadata.expectedSignature && metadata.expectedSignature !== parsed.signature) {
    fail(
      `${id}: expectedSignature does not match INI signature. Expected "${metadata.expectedSignature}", got "${parsed.signature}".`,
    );
  }

  const prior = signatures.get(parsed.signature);
  if (prior) {
    fail(
      `Duplicate firmware signature "${parsed.signature}" in definition sources "${prior}" and "${id}".`,
    );
  }
  signatures.set(parsed.signature, id);

  const ecuTarget = metadata.ecuTarget || inferEcuTarget(parsed.signature);
  if (!ecuTarget) {
    fail(
      `${id}: ECU target could not be inferred from signature "${parsed.signature}". Add metadata.json with "ecuTarget".`,
    );
  }

  const targetSlug = safeSlug(ecuTarget);
  if (!targetSlug) fail(`${id}: ECU target "${ecuTarget}" cannot be converted to a safe path.`);

  const pack = createPack(parsed, ecuTarget);
  const packedJson = Buffer.from(JSON.stringify(pack), 'utf8');
  const compressed = gzipSync(packedJson, { level: 9 });
  const sha256 = createHash('sha256').update(compressed).digest('hex');

  const outputFolder = path.join(generatedRoot, targetSlug, id);
  await mkdir(outputFolder, { recursive: true });
  await writeFile(path.join(outputFolder, 'definition-pack.json.gz'), compressed);

  registryEntries.push({
    signature: parsed.signature,
    ecuTarget,
    label: metadata.label || `${ecuTarget} · ${id}`,
    path: `definitions/generated/${targetSlug}/${id}/definition-pack.json.gz`,
    sha256,
    definitionCount: parsed.constants.length,
    tableCount: parsed.tables.length,
    menuCount: parsed.menus.length,
    dialogCount: parsed.dialogs.length,
    curveCount: parsed.curves.length,
    source: metadata.source || 'EpicEFI mainController.ini',
  });

  console.log(
    `Definition ${id}: ${ecuTarget}, ${parsed.constants.length} settings, ${parsed.tables.length} tables, ${parsed.curves.length} curves.`,
  );
}

registryEntries.sort((left, right) => left.signature.localeCompare(right.signature));

await writeFile(
  registryPath,
  JSON.stringify({ schema: 2, definitions: registryEntries }, null, 2) + '\n',
  'utf8',
);

console.log(`Generated registry with ${registryEntries.length} EpicEFI definition(s).`);
