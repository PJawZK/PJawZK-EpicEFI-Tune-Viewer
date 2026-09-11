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
import { parseIni } from '../src/ini';
import type {
  IniMenuItem,
  ParsedIni,
} from '../src/model';

type SourceMetadata = {
  ecuTarget?: string;
  label?: string;
  source?: string;
  expectedSignature?: string;
};

type CompactMenuItem =
  | ['s']
  | ['i', string, string?, string?]
  | ['g', string, CompactMenuItem[]];

type RegistryEntry = {
  signature: string;
  ecuTarget: string;
  label: string;
  path: string;
  sha256: string;
  definitionCount: number;
  tableCount: number;
  menuCount: number;
  dialogCount: number;
  curveCount: number;
  source: string;
};

const root = process.cwd();
const sourcesRoot = path.join(root, 'definitions', 'sources');
const publicRoot = path.join(root, 'public', 'definitions');
const generatedRoot = path.join(publicRoot, 'generated');
const registryPath = path.join(publicRoot, 'registry.json');

function fail(message: string): never {
  throw new Error(message);
}

function safeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function inferEcuTarget(signature: string): string {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readMetadata(folder: string, id: string): Promise<SourceMetadata> {
  const metadataPath = path.join(folder, 'metadata.json');
  if (!(await fileExists(metadataPath))) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    fail(`${id}/metadata.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${id}/metadata.json must contain a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  const allowed = new Set(['ecuTarget', 'label', 'source', 'expectedSignature']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${id}/metadata.json contains unsupported property "${key}".`);
  }

  const metadata: SourceMetadata = {};
  for (const key of allowed) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) {
      fail(`${id}/metadata.json property "${key}" must be a non-empty string.`);
    }
    metadata[key as keyof SourceMetadata] = value.trim();
  }

  return metadata;
}

function dictionary(values: string[]): { values: string[]; index: Map<string, number> } {
  const unique: string[] = [];
  const index = new Map<string, number>();

  for (const value of values) {
    if (index.has(value)) continue;
    index.set(value, unique.length);
    unique.push(value);
  }

  return { values: unique, index };
}

function compactMenuItem(item: IniMenuItem): CompactMenuItem {
  if (item.type === 'separator') return ['s'];

  if (item.type === 'group') {
    return ['g', item.title, item.children.map(compactMenuItem)];
  }

  const compact: CompactMenuItem = ['i', item.target];
  if (item.title && item.title !== item.target) compact[2] = item.title;
  if (item.condition) compact[3] = item.condition;
  return compact;
}

function createPack(parsed: ParsedIni, ecuTarget: string) {
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

await mkdir(sourcesRoot, { recursive: true });
await mkdir(publicRoot, { recursive: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(generatedRoot, { recursive: true });

const sourceEntries = await readdir(sourcesRoot, { withFileTypes: true });
const registryEntries: RegistryEntry[] = [];
const signatures = new Map<string, string>();

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
