import type { DefinitionRegistryEntry } from './definitionRegistry.ts';
import { parseFirmwareIdentity } from './firmwareIdentity.ts';
import type { ParsedIni } from './model.ts';

export type DefinitionDiffItem = {
  id: string;
  label: string;
};

export type DefinitionDiff = {
  addedSettings: DefinitionDiffItem[];
  removedSettings: DefinitionDiffItem[];
  changedSettings: DefinitionDiffItem[];
  addedTables: DefinitionDiffItem[];
  removedTables: DefinitionDiffItem[];
  changedTables: DefinitionDiffItem[];
  addedCurves: DefinitionDiffItem[];
  removedCurves: DefinitionDiffItem[];
  changedCurves: DefinitionDiffItem[];
  addedDialogs: DefinitionDiffItem[];
  removedDialogs: DefinitionDiffItem[];
  changedDialogs: DefinitionDiffItem[];
  addedMenus: DefinitionDiffItem[];
  removedMenus: DefinitionDiffItem[];
  changedMenus: DefinitionDiffItem[];
};

export function firmwareBuildDate(entry: DefinitionRegistryEntry): string {
  return parseFirmwareIdentity(entry.signature)?.date || entry.release?.trim() || '';
}

export function displayFirmwareRelease(entry: DefinitionRegistryEntry): string {
  return firmwareBuildDate(entry) || 'Firmware date not recognized';
}

export function definitionDisplayLabel(entry: DefinitionRegistryEntry): string {
  return `${entry.ecuTarget} · ${displayFirmwareRelease(entry)} · ${entry.label}`;
}

function fieldLabelMap(definition: ParsedIni): Map<string, string> {
  const labels = new Map<string, string>();
  for (const dialog of definition.dialogs) {
    for (const field of dialog.fields) {
      if (field.name && field.title && !labels.has(field.name)) {
        labels.set(field.name, field.title);
      }
    }
  }
  return labels;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function diffNamedItems<T>(
  left: T[],
  right: T[],
  idOf: (item: T) => string,
  labelOf: (item: T) => string,
): {
  added: DefinitionDiffItem[];
  removed: DefinitionDiffItem[];
  changed: DefinitionDiffItem[];
} {
  const leftMap = new Map(left.map((item) => [idOf(item), item]));
  const rightMap = new Map(right.map((item) => [idOf(item), item]));
  const added: DefinitionDiffItem[] = [];
  const removed: DefinitionDiffItem[] = [];
  const changed: DefinitionDiffItem[] = [];

  for (const [id, item] of rightMap) {
    const before = leftMap.get(id);
    if (!before) {
      added.push({ id, label: labelOf(item) || id });
      continue;
    }
    if (stableValue(before) !== stableValue(item)) {
      changed.push({ id, label: labelOf(item) || id });
    }
  }

  for (const [id, item] of leftMap) {
    if (!rightMap.has(id)) {
      removed.push({ id, label: labelOf(item) || id });
    }
  }

  const sort = (items: DefinitionDiffItem[]) =>
    items.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  return {
    added: sort(added),
    removed: sort(removed),
    changed: sort(changed),
  };
}

export function compareDefinitions(left: ParsedIni, right: ParsedIni): DefinitionDiff {
  const leftLabels = fieldLabelMap(left);
  const rightLabels = fieldLabelMap(right);

  const settings = diffNamedItems(
    left.constants,
    right.constants,
    (item) => item.name,
    (item) => rightLabels.get(item.name) || leftLabels.get(item.name) || item.name,
  );
  const tables = diffNamedItems(
    left.tables,
    right.tables,
    (item) => item.id,
    (item) => item.title || item.id,
  );
  const curves = diffNamedItems(
    left.curves,
    right.curves,
    (item) => item.id,
    (item) => item.title || item.id,
  );
  const dialogs = diffNamedItems(
    left.dialogs,
    right.dialogs,
    (item) => item.id,
    (item) => item.title || item.id,
  );
  const menus = diffNamedItems(
    left.menus,
    right.menus,
    (item) => item.id,
    (item) => item.title || item.id,
  );

  return {
    addedSettings: settings.added,
    removedSettings: settings.removed,
    changedSettings: settings.changed,
    addedTables: tables.added,
    removedTables: tables.removed,
    changedTables: tables.changed,
    addedCurves: curves.added,
    removedCurves: curves.removed,
    changedCurves: curves.changed,
    addedDialogs: dialogs.added,
    removedDialogs: dialogs.removed,
    changedDialogs: dialogs.changed,
    addedMenus: menus.added,
    removedMenus: menus.removed,
    changedMenus: menus.changed,
  };
}

export function definitionDiffCount(diff: DefinitionDiff): number {
  return Object.values(diff).reduce((sum, items) => sum + items.length, 0);
}

export function previousRegisteredDefinitions(
  definitions: DefinitionRegistryEntry[],
): Map<string, DefinitionRegistryEntry> {
  const result = new Map<string, DefinitionRegistryEntry>();
  const byTarget = new Map<string, DefinitionRegistryEntry[]>();

  for (const entry of definitions) {
    if (!firmwareBuildDate(entry)) continue;
    const list = byTarget.get(entry.ecuTarget) ?? [];
    list.push(entry);
    byTarget.set(entry.ecuTarget, list);
  }

  for (const list of byTarget.values()) {
    list.sort((a, b) => {
      const dateOrder = firmwareBuildDate(a).localeCompare(firmwareBuildDate(b));
      if (dateOrder) return dateOrder;
      return a.signature.localeCompare(b.signature);
    });
    for (let index = 1; index < list.length; index += 1) {
      result.set(list[index].signature, list[index - 1]);
    }
  }

  return result;
}
