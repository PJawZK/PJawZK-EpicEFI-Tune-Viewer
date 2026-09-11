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

  if (current.trim() !== '' || input.endsWith(',')) out.push(current.trim());
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
  const match = token.replace(/\s+/g, '').match(/^\[(\d+)(?:x(\d+))?\]$/i);
  if (!match) return { rows: null, cols: null };

  const first = Number.parseInt(match[1], 10);
  const second = match[2] ? Number.parseInt(match[2], 10) : null;
  return second === null ? { rows: first, cols: 1 } : { rows: first, cols: second };
}

function parseBitOptions(rawParts: string[], macros: Map<string, string[]>): string[] {
  const options: string[] = [];
  let sequentialIndex = 0;

  const addSequential = (label: string) => {
    while (options.length <= sequentialIndex) options.push('');
    options[sequentialIndex] = label;
    sequentialIndex += 1;
  };

  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.startsWith('$')) {
      for (const label of macros.get(part.slice(1)) ?? []) addSequential(label);
      continue;
    }

    const indexed = part.match(/^\s*(\d+)\s*=\s*"([^"]*)"\s*$/);
    if (indexed) {
      const index = Number.parseInt(indexed[1], 10);
      while (options.length <= index) options.push('');
      options[index] = indexed[2];
      sequentialIndex = Math.max(sequentialIndex, index + 1);
      continue;
    }

    addSequential(unquote(part));
  }

  return options;
}

function parseVirtualBitSet(
  line: string,
  macros: Map<string, string[]>,
): { name: string; options: string[] } | null {
  const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*bits\s*,\s*(.+)$/i);
  if (!match) return null;

  const parts = splitCsv(match[2]);
  const rangeIndex = parts.findIndex((part) => /^\[\s*\d+\s*:\s*\d+\s*\]$/.test(part));
  if (rangeIndex !== 1 || parts.length <= rangeIndex + 1) return null;

  return {
    name: match[1],
    options: parseBitOptions(parts.slice(rangeIndex + 1), macros),
  };
}

function extractCondition(parts: string[], start = 0): string {
  for (let index = parts.length - 1; index >= start; index -= 1) {
    const part = parts[index].trim();
    if (part.startsWith('{') && part.endsWith('}') && part.slice(1, -1).trim()) {
      return part.slice(1, -1).trim();
    }
  }
  return '';
}

function menuId(title: string): string {
  const normalized = title
    .replace(/&/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)?/g, (_match, next: string | undefined) => next?.toUpperCase() ?? '');

  return normalized || 'menu';
}

export function parseIni(raw: string): ParsedIni {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const macros = new Map<string, string[]>();

  for (const sourceLine of lines) {
    const match = sourceLine.match(/^\s*#define\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    macros.set(match[1], splitCsv(match[2]).map(unquote));
  }

  let section = '';
  let page: number | null = null;
  let signature = '';

  const constants = new Map<string, IniConstantDefinition>();
  const labelSets = new Map<string, string[]>();

  const tables: IniTableDefinition[] = [];
  let activeTable: IniTableDefinition | null = null;

  const curves: IniCurveDefinition[] = [];
  let activeCurve: IniCurveDefinition | null = null;

  const dialogs: IniDialogDefinition[] = [];
  let activeDialog: IniDialogDefinition | null = null;

  const menus: IniMenuDefinition[] = [];
  let activeMenu: IniMenuDefinition | null = null;
  let activeGroup: Extract<IniMenuItem, { type: 'group' }> | null = null;

  const flushSectionState = () => {
    if (activeTable) {
      tables.push(activeTable);
      activeTable = null;
    }
    if (activeCurve) {
      curves.push(activeCurve);
      activeCurve = null;
    }
    if (activeDialog) {
      dialogs.push(activeDialog);
      activeDialog = null;
    }
  };

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      flushSectionState();
      section = sectionMatch[1];
      activeMenu = null;
      activeGroup = null;
      continue;
    }

    if (line.startsWith('#') && !line.startsWith('#define')) continue;

    const virtualBitSet = parseVirtualBitSet(line, macros);
    if (virtualBitSet) {
      labelSets.set(virtualBitSet.name, virtualBitSet.options);
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

      const definitionMatch = line.match(
        /^([A-Za-z0-9_]+)\s*=\s*(scalar|bits|array|string)\s*,\s*(.+)$/i,
      );
      if (!definitionMatch) continue;

      const name = definitionMatch[1];
      if (constants.has(name)) continue;

      const kind = definitionMatch[2].toLowerCase() as IniConstantKind;
      const parts = splitCsv(definitionMatch[3]);
      const dataType = parts[0] ?? '';
      const offset =
        parts[1] && /^-?\d+$/.test(parts[1])
          ? Number.parseInt(parts[1], 10)
          : null;

      let rows: number | null = null;
      let cols: number | null = null;
      let units = '';
      let scale: string | null = null;
      let translate: string | null = null;
      let digits: string | null = null;
      let min: string | null = null;
      let max: string | null = null;
      let options: string[] = [];

      if (kind === 'array') {
        const shape = parseShape(parts[2] ?? '');
        rows = shape.rows;
        cols = shape.cols;
        units = unquote(parts[3] ?? '');
        scale = parts[4] ?? null;
        translate = parts[5] ?? null;
        min = parts[6] ?? null;
        max = parts[7] ?? null;
        digits = parts[8] ?? null;
      } else if (kind === 'scalar') {
        units = unquote(parts[2] ?? '');
        scale = parts[3] ?? null;
        translate = parts[4] ?? null;
        min = parts[5] ?? null;
        max = parts[6] ?? null;
        digits = parts[7] ?? null;
      } else if (kind === 'bits') {
        const bitRangeIndex = parts.findIndex((part) => /^\[\s*\d+\s*:\s*\d+\s*\]$/.test(part));
        if (bitRangeIndex >= 0 && parts.length > bitRangeIndex + 1) {
          options = parseBitOptions(parts.slice(bitRangeIndex + 1), macros);
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
        min,
        max,
        options,
      });
      continue;
    }

    if (section === 'TableEditor') {
      const tableMatch = line.match(
        /^table\s*=\s*([^,]+),\s*([^,]+),\s*"([^"]+)"(?:\s*,\s*(\d+))?/i,
      );
      if (tableMatch) {
        if (activeTable) tables.push(activeTable);
        activeTable = {
          id: tableMatch[1].trim(),
          mapId: tableMatch[2].trim(),
          title: tableMatch[3],
          page: tableMatch[4] ? Number.parseInt(tableMatch[4], 10) : null,
          help: '',
          xBins: '',
          yBins: '',
          zBins: '',
          xLabel: '',
          yLabel: '',
        };
        continue;
      }

      if (!activeTable || !line.includes('=')) continue;
      const [key, rest] = line.split(/=(.*)/s, 2).map((part) => part.trim());
      const parts = splitCsv(rest);

      if (key.toLowerCase() === 'xbins') activeTable.xBins = parts[0]?.trim() ?? '';
      if (key.toLowerCase() === 'ybins') activeTable.yBins = parts[0]?.trim() ?? '';
      if (key.toLowerCase() === 'zbins') activeTable.zBins = parts[0]?.trim() ?? '';
      if (key.toLowerCase() === 'xylabels') {
        activeTable.xLabel = unquote(parts[0] ?? '');
        activeTable.yLabel = unquote(parts[1] ?? '');
      }
      if (key.toLowerCase() === 'topichelp') activeTable.help = unquote(parts[0] ?? '');
      continue;
    }

    if (section === 'CurveEditor') {
      const curveMatch = line.match(/^curve\s*=\s*([^,]+),\s*"([^"]*)"/i);
      if (curveMatch) {
        if (activeCurve) curves.push(activeCurve);
        activeCurve = {
          id: curveMatch[1].trim(),
          title: curveMatch[2],
          labels: [],
          xBins: [],
          yBins: [],
          xAxis: [],
          yAxis: [],
          gauge: '',
        };
        continue;
      }

      if (!activeCurve || !line.includes('=')) continue;
      const [key, rest] = line.split(/=(.*)/s, 2).map((part) => part.trim());
      const parts = splitCsv(rest).map(unquote);
      const lower = key.toLowerCase();

      if (lower === 'columnlabel') activeCurve.labels = parts;
      if (lower === 'xbins') activeCurve.xBins = parts;
      if (lower === 'ybins') activeCurve.yBins = parts;
      if (lower === 'xaxis') activeCurve.xAxis = parts;
      if (lower === 'yaxis') activeCurve.yAxis = parts;
      if (lower === 'gauge') activeCurve.gauge = parts[0] ?? '';
      continue;
    }

    if (section === 'UserDefined') {
      const dialogMatch = line.match(
        /^dialog\s*=\s*([^,]+)\s*,\s*"([^"]*)"(?:\s*,\s*([^,;]+))?/i,
      );
      if (dialogMatch) {
        if (activeDialog) dialogs.push(activeDialog);
        activeDialog = {
          id: dialogMatch[1].trim(),
          title: dialogMatch[2],
          layout: (dialogMatch[3] ?? '').trim(),
          help: '',
          fields: [],
          panels: [],
        };
        continue;
      }

      if (!activeDialog) continue;

      if (/^field\s*=/i.test(line)) {
        const parts = splitCsv(line.split(/=(.*)/s, 2)[1].trim());
        const title = unquote(parts[0] ?? '');
        const candidate = parts[1]?.trim() ?? '';
        const name = candidate && !candidate.startsWith('{') && candidate !== '{}'
          ? unquote(candidate)
          : '';

        activeDialog.fields.push({
          title,
          name,
          condition: extractCondition(parts, 1),
        });
        continue;
      }

      if (/^panel\s*=/i.test(line)) {
        const parts = splitCsv(line.split(/=(.*)/s, 2)[1].trim());
        let layout = '';

        for (const part of parts.slice(1)) {
          const trimmed = part.trim();
          if (!trimmed || trimmed === '{}' || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            continue;
          }
          layout = unquote(trimmed);
          break;
        }

        activeDialog.panels.push({
          name: parts[0]?.trim() ?? '',
          layout,
          condition: extractCondition(parts, 1),
        });
        continue;
      }

      if (/^topicHelp\s*=/i.test(line)) {
        activeDialog.help = unquote(splitCsv(line.split(/=(.*)/s, 2)[1].trim())[0] ?? '');
      }
      continue;
    }

    if (section === 'Menu') {
      if (/^menuDialog\s*=/i.test(line)) continue;

      const menuMatch = line.match(/^menu\s*=\s*"([^"]*)"/i);
      if (menuMatch) {
        const title = menuMatch[1].replace(/&/g, '').trim();
        activeMenu = {
          id: menuId(title),
          title,
          items: [],
        };
        menus.push(activeMenu);
        activeGroup = null;
        continue;
      }

      if (!activeMenu) continue;

      const groupMatch = line.match(/^groupMenu\s*=\s*"([^"]*)"/i);
      if (groupMatch) {
        activeGroup = {
          type: 'group',
          title: groupMatch[1],
          children: [],
        };
        activeMenu.items.push(activeGroup);
        continue;
      }

      const childMatch = line.match(/^(subMenu|groupChildMenu)\s*=\s*(.+)$/i);
      if (!childMatch) continue;

      const parts = splitCsv(childMatch[2]);
      const target = parts[0]?.trim() ?? '';
      const isSeparator = target === 'std_separator';
      const item: IniMenuItem = {
        type: isSeparator ? 'separator' : 'item',
        target,
        title: isSeparator
          ? ''
          : parts[1]?.trim().startsWith('"')
            ? unquote(parts[1])
            : target,
        condition: extractCondition(parts, 2),
      };

      if (childMatch[1].toLowerCase() === 'groupchildmenu' && activeGroup) {
        activeGroup.children.push(item);
      } else {
        activeMenu.items.push(item);
      }
    }
  }

  flushSectionState();

  if (!signature) {
    throw new Error('No firmware signature was found in this INI.');
  }

  return {
    signature,
    constants: [...constants.values()],
    tables: tables.filter((table) => table.xBins && table.yBins && table.zBins),
    curves,
    dialogs,
    menus,
    labelSets: Object.fromEntries(labelSets),
  };
}
