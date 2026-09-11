import type {
  IniConstantDefinition,
  ParsedIni,
  TuneConstant,
} from './model';

function optionIndex(
  selector: TuneConstant | undefined,
  definition: IniConstantDefinition | undefined,
): number | null {
  if (!selector) return null;

  const numeric = Number(selector.value);
  if (Number.isInteger(numeric)) return numeric;

  if (!definition?.options.length) return null;

  const normalized = selector.value.trim().toLowerCase();
  const index = definition.options.findIndex(
    (option) => option.trim().toLowerCase() === normalized,
  );
  return index >= 0 ? index : null;
}

export function resolveIniText(
  raw: string,
  ini: ParsedIni,
  tuneMap: Map<string, TuneConstant>,
  definitionMap: Map<string, IniConstantDefinition>,
): string {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^\{\s*bitStringValue\s*\(\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\)\s*\}$/i,
  );

  if (!match) return trimmed;

  const [, labelSetName, selectorName] = match;
  const labels = ini.labelSets[labelSetName];
  if (!labels?.length) return trimmed;

  const index = optionIndex(
    tuneMap.get(selectorName),
    definitionMap.get(selectorName),
  );

  if (index === null || index < 0 || index >= labels.length) return trimmed;
  return labels[index];
}
