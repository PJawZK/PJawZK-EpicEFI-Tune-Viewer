import type {
  IniConstantDefinition,
  IniConstantKind,
  IniCurveDefinition,
  IniDialogDefinition,
  IniMenuDefinition,
  IniMenuItem,
  IniTableDefinition,
  ParsedIni,
} from './model';

export type DefinitionRegistryEntry = {
  signature: string;
  ecuTarget: string;
  label: string;
  path: string;
  sha256: string;
  definitionCount: number;
  tableCount: number;
  source: string;
};

type DefinitionRegistry = {
  schema: number;
  definitions: DefinitionRegistryEntry[];
};

type CompactMenuItem =
  | ['s']
  | ['i', string, string?, string?]
  | ['g', string, CompactMenuItem[]];

type CompactDefinitionPack = {
  schema: number;
  signature: string;
  ecuTarget: string;
  definitionCount: number;
  tableCount: number;
  kinds: IniConstantKind[];
  types: string[];
  units: string[];
  definitions: unknown[][];
  tables: unknown[] | Array<{
    i: string;
    m: string;
    t: string;
    x: string;
    y: string;
    z: string;
    xl: string;
    yl: string;
  }>;
  menus?: Array<[string, string, CompactMenuItem[]]>;
  dialogs?: unknown[][];
  curves?: unknown[][];
  labelSets: Record<string, string[]>;
};

let registryPromise: Promise<DefinitionRegistry> | null = null;

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchRegistry(): Promise<DefinitionRegistry> {
  if (!registryPromise) {
    registryPromise = fetch(assetUrl('definitions/registry.json')).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Definition registry request failed with HTTP ${response.status}.`);
      }
      return response.json() as Promise<DefinitionRegistry>;
    });
  }

  return registryPromise;
}

export async function findRegisteredDefinition(
  signature: string,
): Promise<DefinitionRegistryEntry | null> {
  const registry = await fetchRegistry();
  return registry.definitions.find((entry) => entry.signature === signature) ?? null;
}

function expandMenuItem(item: CompactMenuItem): IniMenuItem {
  if (item[0] === 's') {
    return { type: 'separator', target: 'std_separator', title: '', condition: '' };
  }

  if (item[0] === 'g') {
    return {
      type: 'group',
      title: item[1],
      children: item[2].map(expandMenuItem),
    };
  }

  return {
    type: 'item',
    target: item[1],
    title: item[2] ?? item[1],
    condition: item[3] ?? '',
  };
}

function expandPack(pack: CompactDefinitionPack): ParsedIni {
  const constants: IniConstantDefinition[] = pack.definitions.map((raw) => {
    const row = raw as unknown[];
    return {
      name: String(row[0] ?? ''),
      kind: pack.kinds[Number(row[1] ?? -1)] ?? 'unknown',
      dataType: pack.types[Number(row[2] ?? -1)] ?? '',
      page: row[3] === undefined || row[3] === null ? null : Number(row[3]),
      offset: row[4] === undefined || row[4] === null ? null : Number(row[4]),
      units: pack.units[Number(row[5] ?? -1)] ?? '',
      rows: row[6] === undefined || row[6] === null ? null : Number(row[6]),
      cols: row[7] === undefined || row[7] === null ? null : Number(row[7]),
      scale: row[8] === undefined || row[8] === null ? null : String(row[8]),
      translate: row[9] === undefined || row[9] === null ? null : String(row[9]),
      digits: row[10] === undefined || row[10] === null ? null : String(row[10]),
      min: row[11] === undefined || row[11] === null ? null : String(row[11]),
      max: row[12] === undefined || row[12] === null ? null : String(row[12]),
      options: Array.isArray(row[13]) ? row[13].map(String) : [],
    };
  });

  const tables: IniTableDefinition[] = [];

  for (const raw of pack.tables) {
    if (!Array.isArray(raw)) {
      tables.push({
        id: raw.i,
        mapId: raw.m,
        title: raw.t,
        page: null,
        help: '',
        xBins: raw.x,
        yBins: raw.y,
        zBins: raw.z,
        xLabel: raw.xl,
        yLabel: raw.yl,
      });
      continue;
    }

    tables.push({
      id: String(raw[0] ?? ''),
      mapId: String(raw[1] ?? ''),
      title: String(raw[2] ?? ''),
      page: raw[3] === undefined || raw[3] === null ? null : Number(raw[3]),
      help: String(raw[4] ?? ''),
      xBins: String(raw[5] ?? ''),
      yBins: String(raw[6] ?? ''),
      zBins: String(raw[7] ?? ''),
      xLabel: String(raw[8] ?? ''),
      yLabel: String(raw[9] ?? ''),
    });
  }

  const menus: IniMenuDefinition[] = (pack.menus ?? []).map((menu) => ({
    id: menu[0],
    title: menu[1],
    items: menu[2].map(expandMenuItem),
  }));

  const dialogs: IniDialogDefinition[] = (pack.dialogs ?? []).map((raw) => {
    const fields = Array.isArray(raw[4]) ? raw[4] as unknown[][] : [];
    const panels = Array.isArray(raw[5]) ? raw[5] as unknown[][] : [];

    return {
      id: String(raw[0] ?? ''),
      title: String(raw[1] ?? ''),
      layout: String(raw[2] ?? ''),
      help: String(raw[3] ?? ''),
      fields: fields.map((field) => ({
        title: String(field[0] ?? ''),
        name: String(field[1] ?? ''),
        condition: String(field[2] ?? ''),
      })),
      panels: panels.map((panel) => ({
        name: String(panel[0] ?? ''),
        layout: String(panel[1] ?? ''),
        condition: String(panel[2] ?? ''),
      })),
    };
  });

  const curves: IniCurveDefinition[] = (pack.curves ?? []).map((raw) => ({
    id: String(raw[0] ?? ''),
    title: String(raw[1] ?? ''),
    labels: Array.isArray(raw[2]) ? (raw[2] as unknown[]).map(String) : [],
    xBins: Array.isArray(raw[3]) ? (raw[3] as unknown[]).map(String) : [],
    yBins: Array.isArray(raw[4]) ? (raw[4] as unknown[]).map(String) : [],
    xAxis: Array.isArray(raw[5]) ? (raw[5] as unknown[]).map(String) : [],
    yAxis: Array.isArray(raw[6]) ? (raw[6] as unknown[]).map(String) : [],
    gauge: String(raw[7] ?? ''),
  }));

  return {
    signature: pack.signature,
    constants,
    tables,
    curves,
    dialogs,
    menus,
    labelSets: pack.labelSets,
  };
}

export async function loadRegisteredDefinition(
  entry: DefinitionRegistryEntry,
): Promise<ParsedIni> {
  const response = await fetch(assetUrl(entry.path));
  if (!response.ok) {
    throw new Error(`Registered definition request failed with HTTP ${response.status}.`);
  }

  const compressed = await response.arrayBuffer();
  const digest = bytesToHex(await crypto.subtle.digest('SHA-256', compressed));
  if (digest !== entry.sha256.toLowerCase()) {
    throw new Error('Registered definition failed SHA-256 integrity verification.');
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support gzip definition packs.');
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const pack = JSON.parse(await new Response(stream).text()) as CompactDefinitionPack;

  if (pack.signature !== entry.signature) {
    throw new Error('Registered definition signature does not match its registry entry.');
  }
  if (pack.definitionCount !== entry.definitionCount || pack.tableCount !== entry.tableCount) {
    throw new Error('Registered definition counts do not match its registry entry.');
  }

  return expandPack(pack);
}
