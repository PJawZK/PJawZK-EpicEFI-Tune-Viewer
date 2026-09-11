import { useMemo, useState } from 'react';
import { evaluateCondition } from './condition';
import { resolveIniText } from './iniExpression';
import type {
  IniConstantDefinition,
  IniCurveDefinition,
  IniDialogDefinition,
  IniMenuDefinition,
  IniMenuItem,
  IniTableDefinition,
  ParsedIni,
  ParsedTune,
  TuneConstant,
} from './model';

function parseNumbers(value: string): number[] {
  return value
    .split(/\s+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
}

function formatValue(
  tuneConstant: TuneConstant,
  definition?: IniConstantDefinition,
): string {
  if ((definition?.kind === 'array' || tuneConstant.rows) && tuneConstant.value) {
    const values = tuneConstant.value.split(/\s+/).filter(Boolean);
    if (values.length <= 12) return values.join(', ');
    return `[${values.length} values]`;
  }

  return tuneConstant.value || '—';
}

function CalibrationTable({
  table,
  ini,
  tuneMap,
  definitionMap,
}: {
  table: IniTableDefinition;
  ini: ParsedIni;
  tuneMap: Map<string, TuneConstant>;
  definitionMap: Map<string, IniConstantDefinition>;
}) {
  const x = tuneMap.get(table.xBins);
  const y = tuneMap.get(table.yBins);
  const z = tuneMap.get(table.zBins);

  if (!x || !y || !z) {
    return <p className="browser-note">Table data is incomplete in this MSQ.</p>;
  }

  const xValues = parseNumbers(x.value);
  const yValues = parseNumbers(y.value);
  const zValues = parseNumbers(z.value);
  const expected = xValues.length * yValues.length;

  if (!xValues.length || !yValues.length || zValues.length !== expected) {
    return (
      <p className="browser-note">
        Could not form this table grid: expected {expected} cells but found {zValues.length}.
      </p>
    );
  }

  const xDefinition = definitionMap.get(table.xBins);
  const yDefinition = definitionMap.get(table.yBins);
  const zDefinition = definitionMap.get(table.zBins);

  const xLabel = resolveIniText(table.xLabel, ini, tuneMap, definitionMap) || table.xBins;
  const yLabel = resolveIniText(table.yLabel, ini, tuneMap, definitionMap) || table.yBins;
  const xUnits = resolveIniText(xDefinition?.units || x.units || '', ini, tuneMap, definitionMap);
  const yUnits = resolveIniText(yDefinition?.units || y.units || '', ini, tuneMap, definitionMap);
  const zUnits = resolveIniText(zDefinition?.units || z.units || '', ini, tuneMap, definitionMap);

  return (
    <section className="browser-block">
      <div className="browser-block-heading">
        <div>
          <span className="browser-kind">Table</span>
          <h3>{table.title}</h3>
        </div>
        <div className="table-meta">
          <code>{table.zBins}</code>
          <span>{yValues.length}×{xValues.length}</span>
          {zUnits && <span>{zUnits}</span>}
        </div>
      </div>

      <div className="calibration-grid-wrap">
        <table className="calibration-grid">
          <thead>
            <tr>
              <th>
                {yLabel}{yUnits && yUnits !== yLabel ? ` (${yUnits})` : ''} \{' '}
                {xLabel}{xUnits && xUnits !== xLabel ? ` (${xUnits})` : ''}
              </th>
              {xValues.map((value, index) => (
                <th key={`x-${index}`}>{value}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...yValues].reverse().map((yValue, reverseIndex) => {
              const rowIndex = yValues.length - 1 - reverseIndex;
              const rowStart = rowIndex * xValues.length;
              return (
                <tr key={`y-${rowIndex}`}>
                  <th>{yValue}</th>
                  {xValues.map((_, columnIndex) => (
                    <td key={`cell-${rowIndex}-${columnIndex}`}>
                      {zValues[rowStart + columnIndex]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CurvePreview({
  curve,
  tuneMap,
  definitionMap,
}: {
  curve: IniCurveDefinition;
  tuneMap: Map<string, TuneConstant>;
  definitionMap: Map<string, IniConstantDefinition>;
}) {
  const xName = curve.xBins[0];
  const yName = curve.yBins[0];
  const x = xName ? tuneMap.get(xName) : undefined;
  const y = yName ? tuneMap.get(yName) : undefined;

  if (!x || !y) {
    return <p className="browser-note">Curve data is incomplete in this MSQ.</p>;
  }

  const xValues = parseNumbers(x.value);
  const yValues = parseNumbers(y.value);
  const count = Math.min(xValues.length, yValues.length);
  if (!count) return <p className="browser-note">Curve contains no numeric points.</p>;

  const points = Array.from({ length: count }, (_, index) => ({
    x: xValues[index],
    y: yValues[index],
  }));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const polyline = points
    .map((point) => {
      const px = 24 + ((point.x - minX) / spanX) * 552;
      const py = 196 - ((point.y - minY) / spanY) * 164;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  const xUnits = definitionMap.get(xName)?.units || x.units || '';
  const yUnits = definitionMap.get(yName)?.units || y.units || '';

  return (
    <section className="browser-block">
      <div className="browser-block-heading">
        <div>
          <span className="browser-kind">Curve</span>
          <h3>{curve.title}</h3>
        </div>
        <span className="browser-muted">{count} points</span>
      </div>

      <svg className="curve-chart" viewBox="0 0 600 220" role="img" aria-label={curve.title}>
        <line x1="24" y1="196" x2="576" y2="196" />
        <line x1="24" y1="32" x2="24" y2="196" />
        <polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="curve-axis">
        <span>{curve.labels[0] || xName}{xUnits ? ` · ${xUnits}` : ''}</span>
        <span>{curve.labels[1] || yName}{yUnits ? ` · ${yUnits}` : ''}</span>
      </div>

      <div className="curve-values">
        {points.map((point, index) => (
          <div key={index}>
            <span>{point.x}</span>
            <strong>{point.y}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function FieldView({
  title,
  name,
  tuneMap,
  definitionMap,
}: {
  title: string;
  name: string;
  tuneMap: Map<string, TuneConstant>;
  definitionMap: Map<string, IniConstantDefinition>;
}) {
  if (!name) {
    const warning = title.startsWith('!');
    return (
      <div className={`browser-text-field ${warning ? 'warning' : ''}`}>
        {warning ? title.slice(1).trim() : title}
      </div>
    );
  }

  const tuneConstant = tuneMap.get(name);
  const definition = definitionMap.get(name);

  return (
    <div className="browser-field">
      <div>
        <span className="browser-field-label">{title || name}</span>
        <code>{name}</code>
      </div>
      <div className="browser-field-value">
        <strong>{tuneConstant ? formatValue(tuneConstant, definition) : 'Not present in MSQ'}</strong>
        {(definition?.units || tuneConstant?.units) && (
          <span>{definition?.units || tuneConstant?.units}</span>
        )}
      </div>
    </div>
  );
}

const hiddenMenuTitles = new Set(['Tools', 'Data Logging', 'Controller', 'Help']);

export default function TuneBrowser({
  ini,
  tune,
}: {
  ini: ParsedIni;
  tune: ParsedTune;
}) {
  const tuneMap = useMemo(
    () => new Map(tune.constants.map((constant) => [constant.name, constant])),
    [tune],
  );
  const definitionMap = useMemo(
    () => new Map(ini.constants.map((definition) => [definition.name, definition])),
    [ini],
  );
  const dialogMap = useMemo(
    () => new Map(ini.dialogs.map((dialog) => [dialog.id, dialog])),
    [ini.dialogs],
  );
  const curveMap = useMemo(
    () => new Map(ini.curves.map((curve) => [curve.id, curve])),
    [ini.curves],
  );
  const tableMap = useMemo(
    () => new Map(ini.tables.map((table) => [table.id, table])),
    [ini.tables],
  );

  const tuningMenus = useMemo(
    () => ini.menus.filter((menu) => !hiddenMenuTitles.has(menu.title)),
    [ini.menus],
  );

  const [selectedMenuId, setSelectedMenuId] = useState(tuningMenus[0]?.id ?? '');
  const selectedMenu =
    tuningMenus.find((menu) => menu.id === selectedMenuId) ?? tuningMenus[0];

  const firstTarget = (menu?: IniMenuDefinition): string => {
    if (!menu) return '';
    for (const item of menu.items) {
      if (item.type === 'item') return item.target;
      if (item.type === 'group') {
        const child = item.children.find((candidate) => candidate.type === 'item');
        if (child?.type === 'item') return child.target;
      }
    }
    return '';
  };

  const [selectedTarget, setSelectedTarget] = useState(firstTarget(selectedMenu));
  const [selectedTitle, setSelectedTitle] = useState('');

  const conditionState = (condition: string) =>
    evaluateCondition(condition, tuneMap, definitionMap);

  const chooseMenu = (menu: IniMenuDefinition) => {
    setSelectedMenuId(menu.id);
    setSelectedTarget(firstTarget(menu));
    setSelectedTitle('');
  };

  const chooseTarget = (target: string, title: string) => {
    setSelectedTarget(target);
    setSelectedTitle(title);
  };

  const renderTarget = (
    target: string,
    visited = new Set<string>(),
    depth = 0,
  ): React.ReactNode => {
    if (!target || depth > 12) return null;
    if (visited.has(target)) {
      return <p className="browser-note">Recursive panel reference stopped at <code>{target}</code>.</p>;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(target);

    const table = tableMap.get(target);
    if (table) {
      return (
        <CalibrationTable
          table={table}
          ini={ini}
          tuneMap={tuneMap}
          definitionMap={definitionMap}
        />
      );
    }

    const curve = curveMap.get(target);
    if (curve) {
      return (
        <CurvePreview
          curve={curve}
          tuneMap={tuneMap}
          definitionMap={definitionMap}
        />
      );
    }

    const dialog = dialogMap.get(target);
    if (dialog) {
      return renderDialog(dialog, nextVisited, depth + 1);
    }

    return (
      <div className="browser-unresolved">
        <span>Definition target</span>
        <code>{target}</code>
        <p>This target type is not rendered yet.</p>
      </div>
    );
  };

  const renderDialog = (
    dialog: IniDialogDefinition,
    visited: Set<string>,
    depth: number,
  ): React.ReactNode => {
    const fields = dialog.fields.filter((field) => conditionState(field.condition) !== false);
    const panels = dialog.panels.filter((panel) => conditionState(panel.condition) !== false);

    return (
      <section className="browser-dialog" key={dialog.id}>
        {(dialog.title || fields.length > 0) && (
          <div className="browser-dialog-heading">
            <div>
              {dialog.title && <h3>{dialog.title}</h3>}
              <code>{dialog.id}</code>
            </div>
            {dialog.help && <span className="browser-muted">Help: {dialog.help}</span>}
          </div>
        )}

        {fields.length > 0 && (
          <div className="browser-fields">
            {fields.map((field, index) => (
              <FieldView
                key={`${dialog.id}-${field.name}-${index}`}
                title={field.title}
                name={field.name}
                tuneMap={tuneMap}
                definitionMap={definitionMap}
              />
            ))}
          </div>
        )}

        {panels.map((panel, index) => (
          <div className="browser-panel" key={`${dialog.id}-${panel.name}-${index}`}>
            {renderTarget(panel.name, visited, depth)}
          </div>
        ))}
      </section>
    );
  };

  const renderMenuItem = (item: IniMenuItem, key: string): React.ReactNode => {
    if (item.type === 'separator') return <div className="browser-separator" key={key} />;

    if (item.type === 'group') {
      const visibleChildren = item.children.filter(
        (child) => child.type !== 'item' || conditionState(child.condition) !== false,
      );

      if (!visibleChildren.some((child) => child.type === 'item')) return null;

      return (
        <details className="browser-group" key={key} open>
          <summary>{item.title}</summary>
          <div>
            {visibleChildren.map((child, index) =>
              renderMenuItem(child, `${key}-${index}`),
            )}
          </div>
        </details>
      );
    }

    if (conditionState(item.condition) === false) return null;

    const unresolvedCondition = item.condition && conditionState(item.condition) === null;

    return (
      <button
        type="button"
        key={key}
        className={`browser-nav-item ${selectedTarget === item.target ? 'active' : ''}`}
        onClick={() => chooseTarget(item.target, item.title)}
        title={unresolvedCondition ? `Condition could not be fully evaluated: ${item.condition}` : undefined}
      >
        <span>{item.title || item.target}</span>
        {unresolvedCondition && <small>conditional</small>}
      </button>
    );
  };

  if (!tuningMenus.length) {
    return <p className="browser-note">This definition contains no supported tune menus.</p>;
  }

  return (
    <section className="tune-browser">
      <div className="browser-tabs" role="tablist" aria-label="Tune categories">
        {tuningMenus.map((menu) => (
          <button
            type="button"
            key={menu.id}
            className={selectedMenu?.id === menu.id ? 'active' : ''}
            onClick={() => chooseMenu(menu)}
          >
            {menu.title}
          </button>
        ))}
      </div>

      <div className="browser-layout">
        <aside className="browser-sidebar">
          <div className="browser-sidebar-title">{selectedMenu?.title}</div>
          {selectedMenu?.items.map((item, index) =>
            renderMenuItem(item, `${selectedMenu.id}-${index}`),
          )}
        </aside>

        <article className="browser-content">
          <div className="browser-content-heading">
            <div>
              <p className="eyebrow">{selectedMenu?.title}</p>
              <h2>{selectedTitle || selectedTarget || 'Tune page'}</h2>
            </div>
            {selectedTarget && <code>{selectedTarget}</code>}
          </div>

          {selectedTarget ? (
            renderTarget(selectedTarget)
          ) : (
            <p className="browser-note">Choose a tune page from the sidebar.</p>
          )}
        </article>
      </div>
    </section>
  );
}
