import type {
  IniConstantDefinition,
  TuneConstant,
} from './model';

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' };

type ConditionValue = boolean | number | string | null;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const rest = input.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const operator = rest.match(/^(?:&&|\|\||==|!=|>=|<=|>|<|!)/);
    if (operator) {
      tokens.push({ type: 'operator', value: operator[0] });
      index += operator[0].length;
      continue;
    }

    if (rest[0] === '(' || rest[0] === ')') {
      tokens.push({ type: 'paren', value: rest[0] });
      index += 1;
      continue;
    }

    const number = rest.match(/^-?(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    throw new Error(`Unsupported condition token near "${rest.slice(0, 20)}"`);
  }

  return tokens;
}

function comparableValue(
  name: string,
  tuneMap: Map<string, TuneConstant>,
  definitionMap: Map<string, IniConstantDefinition>,
): ConditionValue {
  const tuneValue = tuneMap.get(name)?.value.trim();
  if (tuneValue === undefined) return null;

  if (/^true$/i.test(tuneValue)) return 1;
  if (/^false$/i.test(tuneValue)) return 0;

  const numeric = Number(tuneValue);
  if (Number.isFinite(numeric)) return numeric;

  const options = definitionMap.get(name)?.options ?? [];
  const optionIndex = options.findIndex(
    (option) => option.trim().toLowerCase() === tuneValue.toLowerCase(),
  );
  if (optionIndex >= 0) return optionIndex;

  if (/^(none|invalid|off|disabled)$/i.test(tuneValue)) return 0;
  return tuneValue;
}

function truthy(value: ConditionValue): boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.length > 0;
}

function compare(left: ConditionValue, operator: string, right: ConditionValue): boolean | null {
  if (left === null || right === null) return null;

  switch (operator) {
    case '==':
      return left === right || String(left) === String(right);
    case '!=':
      return !(left === right || String(left) === String(right));
    case '>':
      return Number(left) > Number(right);
    case '<':
      return Number(left) < Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return null;
  }
}

export function evaluateCondition(
  expression: string,
  tuneMap: Map<string, TuneConstant>,
  definitionMap: Map<string, IniConstantDefinition>,
): boolean | null {
  const source = expression.trim();
  if (!source) return true;

  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch {
    return null;
  }

  let position = 0;

  const parsePrimary = (): ConditionValue => {
    const token = tokens[position];
    if (!token) return null;

    if (token.type === 'paren' && token.value === '(') {
      position += 1;
      const value = parseOr();
      if (tokens[position]?.type === 'paren' && tokens[position]?.value === ')') position += 1;
      return value;
    }

    position += 1;
    if (token.type === 'number') return token.value;
    if (token.type === 'identifier') return comparableValue(token.value, tuneMap, definitionMap);
    return null;
  };

  const parseUnary = (): ConditionValue => {
    const token = tokens[position];
    if (token?.type === 'operator' && token.value === '!') {
      position += 1;
      const value = truthy(parseUnary());
      return value === null ? null : !value;
    }
    return parsePrimary();
  };

  const parseComparison = (): ConditionValue => {
    const left = parseUnary();
    const token = tokens[position];

    if (
      token?.type === 'operator'
      && ['==', '!=', '>', '<', '>=', '<='].includes(token.value)
    ) {
      position += 1;
      return compare(left, token.value, parseUnary());
    }

    return left;
  };

  const combine = (
    left: boolean | null,
    right: boolean | null,
    operator: '&&' | '||',
  ): boolean | null => {
    if (operator === '&&') {
      if (left === false || right === false) return false;
      if (left === null || right === null) return null;
      return true;
    }

    if (left === true || right === true) return true;
    if (left === null || right === null) return null;
    return false;
  };

  const parseAnd = (): ConditionValue => {
    let left = truthy(parseComparison());
    while (tokens[position]?.type === 'operator' && tokens[position]?.value === '&&') {
      position += 1;
      left = combine(left, truthy(parseComparison()), '&&');
    }
    return left;
  };

  function parseOr(): ConditionValue {
    let left = truthy(parseAnd());
    while (tokens[position]?.type === 'operator' && tokens[position]?.value === '||') {
      position += 1;
      left = combine(left, truthy(parseAnd()), '||');
    }
    return left;
  }

  try {
    const value = truthy(parseOr());
    return position === tokens.length ? value : null;
  } catch {
    return null;
  }
}
