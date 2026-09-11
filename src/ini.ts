import type {
  IniConstantDefinition,
  IniConstantKind,
  IniTableDefinition,
  ParsedIni,
} from './model';

function splitCsv(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let braces = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && input[i - 1] !== '\\') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted) {
      if (char === '{') braces += 1;
      if (char === '}') braces = Math.max(0, braces - 1);
      if (char === ',' && braces === 0) {
        out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim() !== '') out.push(current.trim());
  return out;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseShape(token: string): { rows: number | null; cols: number | null } {
  const match = token.match(/^\[(\d+)(?:x(\d+))?\]$/i);
  if (!match) return { rows: null, cols: null };
  const first = Number.parseInt(match[1], 10);
  const second = match[2] ? Number.parseInt(match[2], 10) : null;
  return second === null
    ? { rows: first, cols: 1 }
    : { rows: first, cols: second };
}

function parseMacroOptions(raw: string, macros: Map<string, string[]>): string[] {
  const token = raw.trim();
  if (token.startsWith('$')) {
    return macros.get(token.slice(1)) ?? [];
  }

  return splitCsv(token)
    .map((entry) => {
      const enumMatch = entry.match(/^\s*[^=]+\s*=\s*"([^"]*)"\s*$/);
      return enumMatch ? enumMatch[1] : unquote(entry);
    })
    .filter(Boolean);
}

export function parseIni(raw: string): ParsedIni {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const macros = new Map<string, string[]>();

  for (const line of lines) {
    const match = line.match(/^\s*#define\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    macros.set(match[1], splitCsv(match[2]).map(unquote));
  }

  let section = '';
  let page: number | null = null;
  let signature = '';
  const constants = new Map<string, IniConstantDefinition>();
  const tables: IniTableDefinition[] = [];
  let activeTable: IniTableDefinition | null = null;

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      if (activeTable) {
        tables.push(activeTable);
        activeTable = null;
      }
      section = sectionMatch[1];
      continue;
    }

    if ((section === 'MegaTune' || section === 'TunerStudio') && !signature) {
      const sigMatch = line.match(/^signature\s*=\s*"([^"]+)"/i);
      if (sigMatch) signature = sigMatch[1];
    }

    if (section === 'Constants') {
      const pageMatch = line.match(/^page\s*=\s*(\d+)/i);
      if (pageMatch) {
        page = Number.parseInt(pageMatch[1], 10);
        continue;
      }

      const definitionMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(scalar|bits|array|string)\s*,\s*(.+)$/i);
      if (!definitionMatch) continue;

      const name = definitionMatch[1];
      const kind = definitionMatch[2].toLowerCase() as IniConstantKind;
      const parts = splitCsv(definitionMatch[3]);
      const dataType = parts[0] ?? '';
      const offset = parts[1] && /^-?\d+$/.test(parts[1])
        ? Number.parseInt(parts[1], 10)
        : null;

      let rows: number | null = null;
      let cols: number | null = null;
      let units = '';
      let scale: string | null = null;
      let translate: string | null = null;
      let digits: string | null = null;
      let options: string[] = [];

      if (kind === 'array') {
        const shape = parseShape(parts[2] ?? '');
        rows = shape.rows;
        cols = shape.cols;
        units = unquote(parts[3] ?? '');
        scale = parts[4] ?? null;
        translate = parts[5] ?? null;
        digits = parts[8] ?? null;
      } else if (kind === 'scalar') {
        units = unquote(parts[2] ?? '');
        scale = parts[3] ?? null;
        translate = parts[4] ?? null;
        digits = parts[7] ?? null;
      } else if (kind === 'bits') {
        const bitRangeIndex = parts.findIndex((part) => /^\[\d+:\d+\]$/.test(part));
        if (bitRangeIndex >= 0 && parts.length > bitRangeIndex + 1) {
          options = parseMacroOptions(parts.slice(bitRangeIndex + 1).join(','), macros);
        }
      }

      constants.set(name, {
        name,
        kind,
        dataType,
        page,
        offset,
        units,
        rows,
        cols,
        scale,
        translate,
        digits,
        options,
      });
      continue;
    }

    if (section === 'TableEditor') {
      const tableMatch = line.match(/^table\s*=\s*([^,]+),\s*([^,]+),\s*"([^"]+)"/i);
      if (tableMatch) {
        if (activeTable) tables.push(activeTable);
        activeTable = {
          id: tableMatch[1].trim(),
          mapId: tableMatch[2].trim(),
          title: tableMatch[3],
          xBins: '',
          yBins: '',
          zBins: '',
          xLabel: '',
          yLabel: '',
        };
        continue;
      }

      if (!activeTable) continue;

      const xBins = line.match(/^xBins\s*=\s*([^,;]+)/i);
      if (xBins) activeTable.xBins = xBins[1].trim();
      const yBins = line.match(/^yBins\s*=\s*([^,;]+)/i);
      if (yBins) activeTable.yBins = yBins[1].trim();
      const zBins = line.match(/^zBins\s*=\s*([^,;]+)/i);
      if (zBins) activeTable.zBins = zBins[1].trim();

      const labels = line.match(/^xyLabels\s*=\s*"([^"]*)"\s*,\s*(.+)$/i);
      if (labels) {
        activeTable.xLabel = labels[1];
        activeTable.yLabel = unquote(labels[2]);
      }
    }
  }

  if (activeTable) tables.push(activeTable);

  if (!signature) {
    throw new Error('No firmware signature was found in this INI.');
  }

  return {
    signature,
    constants: [...constants.values()],
    tables: tables.filter((table) => table.xBins && table.yBins && table.zBins),
  };
}
