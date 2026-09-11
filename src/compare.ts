import type {
  IniCurveDefinition,
  IniDialogDefinition,
  IniMenuItem,
  IniTableDefinition,
  ParsedIni,
  ParsedTune,
  TuneConstant,
} from './model';

export type ScalarComparison = {
  name: string;
  label: string;
  category: string;
  kind: string;
  units: string;
  a: string;
  b: string;
  changed: boolean;
  numericDelta: number | null;
};

export type TableComparison = {
  id: string;
  title: string;
  category: string;
  definition: IniTableDefinition;
  xA: number[];
  xB: number[];
  yA: number[];
  yB: number[];
  zA: number[];
  zB: number[];
  changed: boolean;
  axesChanged: boolean;
  cellsChanged: number;
  totalCells: number;
  maxAbsDelta: number | null;
  maxPercentDelta: number | null;
};

export type CurveComparison = {
  id: string;
  title: string;
  category: string;
  definition: IniCurveDefinition;
  xA: number[];
  xB: number[];
  yA: number[];
  yB: number[];
  changed: boolean;
  pointsChanged: number;
  totalPoints: number;
  maxAbsDelta: number | null;
};

export type ComparisonResult = {
  exactFirmwareMatch: boolean;
  scalars: ScalarComparison[];
  tables: TableComparison[];
  curves: CurveComparison[];
  onlyA: string[];
  onlyB: string[];
  categories: string[];
};

function numbers(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function numericDelta(a: string, b: string): number | null {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right)
    ? right - left
    : null;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function maxAbsDelta(a: number[], b: number[]): number | null {
  const count = Math.min(a.length, b.length);
  if (!count) return null;

  let max = 0;
  for (let index = 0; index < count; index += 1) {
    max = Math.max(max, Math.abs(b[index] - a[index]));
  }
  return max;
}

function maxPercentDelta(a: number[], b: number[]): number | null {
  const count = Math.min(a.length, b.length);
  let max: number | null = null;

  for (let index = 0; index < count; index += 1) {
    if (a[index] === 0) continue;
    const delta = Math.abs(((b[index] - a[index]) / a[index]) * 100);
    max = max === null ? delta : Math.max(max, delta);
  }

  return max;
}

function changedCount(a: number[], b: number[]): number {
  const common = Math.min(a.length, b.length);
  let changed = Math.abs(a.length - b.length);

  for (let index = 0; index < common; index += 1) {
    if (a[index] !== b[index]) changed += 1;
  }

  return changed;
}

function collectMenuTargets(items: IniMenuItem[]): string[] {
  const targets: string[] = [];

  for (const item of items) {
    if (item.type === 'item') targets.push(item.target);
    if (item.type === 'group') targets.push(...collectMenuTargets(item.children));
  }

  return targets;
}

function fieldLabels(ini: ParsedIni): Map<string, string> {
  const labels = new Map<string, string>();

  for (const dialog of ini.dialogs) {
    for (const field of dialog.fields) {
      if (field.name && field.title && !labels.has(field.name)) {
        labels.set(field.name, field.title.replace(/^!/, '').trim());
      }
    }
  }

  return labels;
}

function categoryMap(ini: ParsedIni): Map<string, string> {
  const categories = new Map<string, string>();
  const dialogMap = new Map(ini.dialogs.map((dialog) => [dialog.id, dialog]));
  const tableMap = new Map(ini.tables.map((table) => [table.id, table]));
  const curveMap = new Map(ini.curves.map((curve) => [curve.id, curve]));

  function assignConstant(name: string, category: string) {
    if (name && !categories.has(name)) categories.set(name, category);
  }

  function traverseDialog(
    dialog: IniDialogDefinition,
    category: string,
    visited: Set<string>,
  ) {
    if (visited.has(dialog.id)) return;
    visited.add(dialog.id);

    for (const field of dialog.fields) assignConstant(field.name, category);
    for (const panel of dialog.panels) traverseTarget(panel.name, category, visited);
  }

  function traverseTarget(target: string, category: string, visited: Set<string>) {
    if (!target || visited.has(target)) return;

    const dialog = dialogMap.get(target);
    if (dialog) {
      traverseDialog(dialog, category, visited);
      return;
    }

    const table = tableMap.get(target);
    if (table) {
      visited.add(target);
      assignConstant(table.xBins, category);
      assignConstant(table.yBins, category);
      assignConstant(table.zBins, category);
      return;
    }

    const curve = curveMap.get(target);
    if (curve) {
      visited.add(target);
      for (const name of curve.xBins) assignConstant(name, category);
      for (const name of curve.yBins) assignConstant(name, category);
    }
  }

  for (const menu of ini.menus) {
    const category = menu.title || menu.id;
    for (const target of collectMenuTargets(menu.items)) {
      traverseTarget(target, category, new Set());
    }
  }

  return categories;
}

function tuneMap(tune: ParsedTune): Map<string, TuneConstant> {
  return new Map(tune.constants.map((constant) => [constant.name, constant]));
}

export function compareTunes(
  tuneA: ParsedTune,
  iniA: ParsedIni,
  tuneB: ParsedTune,
  iniB: ParsedIni,
): ComparisonResult {
  const exactFirmwareMatch =
    tuneA.details.signature === tuneB.details.signature
    && iniA.signature === iniB.signature
    && tuneA.details.signature === iniA.signature;

  const mapA = tuneMap(tuneA);
  const mapB = tuneMap(tuneB);
  const defsA = new Map(iniA.constants.map((definition) => [definition.name, definition]));
  const defsB = new Map(iniB.constants.map((definition) => [definition.name, definition]));
  const labelsA = fieldLabels(iniA);
  const labelsB = fieldLabels(iniB);
  const categoriesA = categoryMap(iniA);
  const categoriesB = categoryMap(iniB);

  const namesA = new Set(mapA.keys());
  const namesB = new Set(mapB.keys());
  const commonNames = [...namesA].filter((name) => namesB.has(name)).sort();

  const scalars: ScalarComparison[] = [];

  for (const name of commonNames) {
    const defA = defsA.get(name);
    const defB = defsB.get(name);

    if (exactFirmwareMatch) {
      if (!defA || defA.kind === 'array') continue;
    } else {
      if (!defA || !defB || defA.kind === 'array' || defB.kind === 'array') continue;
    }

    const a = normalized(mapA.get(name)?.value);
    const b = normalized(mapB.get(name)?.value);
    const units =
      exactFirmwareMatch
        ? defA?.units ?? mapA.get(name)?.units ?? ''
        : defA?.units === defB?.units
          ? defA?.units ?? ''
          : '';

    scalars.push({
      name,
      label: labelsA.get(name) || labelsB.get(name) || name,
      category: categoriesA.get(name) || categoriesB.get(name) || 'Other',
      kind: defA?.kind || defB?.kind || 'unknown',
      units,
      a,
      b,
      changed: a !== b,
      numericDelta: numericDelta(a, b),
    });
  }

  const tables: TableComparison[] = [];
  const curves: CurveComparison[] = [];

  if (exactFirmwareMatch) {
    for (const table of iniA.tables) {
      const xA = numbers(mapA.get(table.xBins)?.value);
      const xB = numbers(mapB.get(table.xBins)?.value);
      const yA = numbers(mapA.get(table.yBins)?.value);
      const yB = numbers(mapB.get(table.yBins)?.value);
      const zA = numbers(mapA.get(table.zBins)?.value);
      const zB = numbers(mapB.get(table.zBins)?.value);

      if (!xA.length || !xB.length || !yA.length || !yB.length || !zA.length || !zB.length) {
        continue;
      }

      const axesChanged = !arraysEqual(xA, xB) || !arraysEqual(yA, yB);
      const cellsChanged = changedCount(zA, zB);

      tables.push({
        id: table.id,
        title: table.title || table.id,
        category: categoriesA.get(table.zBins) || 'Other',
        definition: table,
        xA,
        xB,
        yA,
        yB,
        zA,
        zB,
        changed: axesChanged || cellsChanged > 0,
        axesChanged,
        cellsChanged,
        totalCells: Math.max(zA.length, zB.length),
        maxAbsDelta: maxAbsDelta(zA, zB),
        maxPercentDelta: maxPercentDelta(zA, zB),
      });
    }

    for (const curve of iniA.curves) {
      const xName = curve.xBins[0];
      const yName = curve.yBins[0];
      if (!xName || !yName) continue;

      const xA = numbers(mapA.get(xName)?.value);
      const xB = numbers(mapB.get(xName)?.value);
      const yA = numbers(mapA.get(yName)?.value);
      const yB = numbers(mapB.get(yName)?.value);

      if (!xA.length || !xB.length || !yA.length || !yB.length) continue;

      const pointsChanged = changedCount(xA, xB) + changedCount(yA, yB);

      curves.push({
        id: curve.id,
        title: curve.title || `${curve.labels[1] || yName} vs ${curve.labels[0] || xName}`,
        category: categoriesA.get(yName) || categoriesA.get(xName) || 'Other',
        definition: curve,
        xA,
        xB,
        yA,
        yB,
        changed: pointsChanged > 0,
        pointsChanged,
        totalPoints: Math.max(xA.length, xB.length, yA.length, yB.length),
        maxAbsDelta: maxAbsDelta(yA, yB),
      });
    }
  }

  const categories = [...new Set([
    ...scalars.map((entry) => entry.category),
    ...tables.map((entry) => entry.category),
    ...curves.map((entry) => entry.category),
  ])].sort();

  return {
    exactFirmwareMatch,
    scalars,
    tables,
    curves,
    onlyA: [...namesA].filter((name) => !namesB.has(name)).sort(),
    onlyB: [...namesB].filter((name) => !namesA.has(name)).sort(),
    categories,
  };
}
