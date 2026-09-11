import type {
  IniConstantDefinition,
  IniConstantKind,
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

type CompactDefinitionPack = {
  schema: number;
  signature: string;
  ecuTarget: string;
  definitionCount: number;
  tableCount: number;
  kinds: IniConstantKind[];
  types: string[];
  units: string[];
  definitions: Array<
    [
      name: string,
      kindIndex: number,
      typeIndex: number,
      offset: number | null,
      unitIndex: number,
      options?: string[],
    ]
  >;
  tables: Array<{
    i: string;
    m: string;
    t: string;
    x: string;
    y: string;
    z: string;
    xl: string;
    yl: string;
  }>;
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

function expandPack(pack: CompactDefinitionPack): ParsedIni {
  const constants: IniConstantDefinition[] = pack.definitions.map((row) => {
    const [name, kindIndex, typeIndex, offset, unitIndex, options] = row;
    return {
      name,
      kind: pack.kinds[kindIndex] ?? 'unknown',
      dataType: pack.types[typeIndex] ?? '',
      page: null,
      offset,
      units: pack.units[unitIndex] ?? '',
      rows: null,
      cols: null,
      scale: null,
      translate: null,
      digits: null,
      options: options ?? [],
    };
  });

  const tables: IniTableDefinition[] = pack.tables.map((table) => ({
    id: table.i,
    mapId: table.m,
    title: table.t,
    xBins: table.x,
    yBins: table.y,
    zBins: table.z,
    xLabel: table.xl,
    yLabel: table.yl,
  }));

  return {
    signature: pack.signature,
    constants,
    tables,
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
