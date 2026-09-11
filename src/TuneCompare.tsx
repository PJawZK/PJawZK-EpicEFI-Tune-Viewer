import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  findRegisteredDefinition,
  loadRegisteredDefinition,
} from './definitionRegistry';
import { parseIni } from './ini';
import type { ParsedIni, ParsedTune } from './model';
import { parseMsq } from './msq';
import {
  compareTunes,
  type ComparisonResult,
  type CurveComparison,
  type TableComparison,
} from './compare';
import SelectMenu from './SelectMenu';

type TuneCompareProps = {
  navigate: (path: string) => void;
};

type DefinitionStatus = 'idle' | 'loading' | 'registry' | 'manual-needed' | 'manual' | 'error';

type SideState = {
  fileName: string;
  tune: ParsedTune | null;
  ini: ParsedIni | null;
  definitionStatus: DefinitionStatus;
  definitionLabel: string;
  error: string;
};

type CompareTab = 'summary' | 'settings' | 'tables' | 'curves' | 'report';
type TableView = 'a' | 'b' | 'absolute' | 'percent';

const emptySide: SideState = {
  fileName: '',
  tune: null,
  ini: null,
  definitionStatus: 'idle',
  definitionLabel: '',
  error: '',
};

function formatDelta(delta: number | null, units: string): string {
  if (delta === null) return '—';
  const rounded = Number(delta.toFixed(6));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}${units ? ` ${units}` : ''}`;
}

function axisSpec(
  spec: string[],
  valuesA: number[],
  valuesB: number[],
): { min: number; max: number; ticks: number[] } {
  const specifiedMin = Number.parseFloat(spec[0] ?? '');
  const specifiedMax = Number.parseFloat(spec[1] ?? '');
  const specifiedTicks = Number.parseInt(spec[2] ?? '', 10);

  let min: number;
  let max: number;
  let count: number;

  if (Number.isFinite(specifiedMin) && Number.isFinite(specifiedMax) && specifiedMax > specifiedMin) {
    min = specifiedMin;
    max = specifiedMax;
    count = Number.isFinite(specifiedTicks)
      ? Math.min(12, Math.max(2, specifiedTicks))
      : 6;
  } else {
    const values = [...valuesA, ...valuesB];
    min = Math.min(...values);
    max = Math.max(...values);
    if (min === max) {
      const padding = Math.max(Math.abs(min) * 0.1, 1);
      min -= padding;
      max += padding;
    } else {
      const padding = (max - min) * 0.05;
      min -= padding;
      max += padding;
    }
    count = 6;
  }

  return {
    min,
    max,
    ticks: Array.from(
      { length: count },
      (_, index) => min + ((max - min) * index) / (count - 1),
    ),
  };
}

function formatAxis(value: number, span: number): string {
  if (Math.abs(value) >= 1000 || span >= 100) return Math.round(value).toString();
  if (span >= 10) return Number(value.toFixed(1)).toString();
  if (span >= 1) return Number(value.toFixed(2)).toString();
  return Number(value.toFixed(3)).toString();
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], {
    type: 'application/json',
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function SideLoader({
  title,
  side,
  onMsq,
  onIni,
}: {
  title: string;
  side: SideState;
  onMsq: (file: File | undefined) => void;
  onIni: (file: File | undefined) => void;
}) {
  const definitionReady = Boolean(side.tune && side.ini);

  return (
    <section className="compare-side">
      <div className="compare-side-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{side.fileName || 'Choose tune'}</h2>
        </div>
        <span className={`badge ${definitionReady ? 'badge-ok' : ''}`}>
          {definitionReady ? 'Definition ready' : 'Tune required'}
        </span>
      </div>

      <label className="submit-file-card">
        <span>MSQ · required</span>
        <strong>{side.fileName || 'Choose EpicEFI tune'}</strong>
        <input
          type="file"
          accept=".msq,.xml,text/xml,application/xml"
          onChange={(event) => onMsq(event.target.files?.[0])}
        />
      </label>

      {side.tune && (
        <div className="compare-side-details">
          <div>
            <span>Signature</span>
            <strong>{side.tune.details.signature}</strong>
          </div>
          <div>
            <span>Definition</span>
            <strong>
              {side.definitionStatus === 'loading'
                ? 'Resolving exact registry definition…'
                : side.definitionStatus === 'registry'
                  ? side.definitionLabel || 'Public registry'
                  : side.definitionStatus === 'manual'
                    ? side.definitionLabel || 'Local INI'
                    : side.definitionStatus === 'manual-needed'
                      ? 'Matching INI required'
                      : side.definitionStatus === 'error'
                        ? 'Definition error'
                        : 'Not resolved'}
            </strong>
          </div>
        </div>
      )}

      {side.tune && side.definitionStatus === 'manual-needed' && (
        <label className="submit-file-card compare-ini-card">
          <span>mainController.ini · exact matching firmware</span>
          <strong>Choose local definition</strong>
          <input
            type="file"
            accept=".ini,text/plain"
            onChange={(event) => onIni(event.target.files?.[0])}
          />
        </label>
      )}

      {side.error && <div className="mismatch">{side.error}</div>}
    </section>
  );
}

function TableGrid({
  table,
  mode,
}: {
  table: TableComparison;
  mode: TableView;
}) {
  const x = mode === 'b' ? table.xB : table.xA;
  const y = mode === 'b' ? table.yB : table.yA;
  const source = mode === 'a' ? table.zA : mode === 'b' ? table.zB : table.zA;
  const cols = x.length;
  const rows = y.length;

  function valueAt(row: number, col: number): string {
    const index = row * cols + col;

    if (mode === 'a') return String(table.zA[index] ?? '—');
    if (mode === 'b') return String(table.zB[index] ?? '—');

    const a = table.zA[index];
    const b = table.zB[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';

    if (mode === 'absolute') {
      const delta = b - a;
      const rounded = Number(delta.toFixed(6));
      return `${rounded > 0 ? '+' : ''}${rounded}`;
    }

    if (a === 0) return b === 0 ? '0%' : '—';
    const percent = ((b - a) / a) * 100;
    const rounded = Number(percent.toFixed(2));
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  }

  function changedAt(row: number, col: number): boolean {
    const index = row * cols + col;
    return table.zA[index] !== table.zB[index];
  }

  return (
    <div className="calibration-grid-wrap compare-grid-wrap">
      <table className="calibration-grid compare-grid">
        <thead>
          <tr>
            <th>Y \ X</th>
            {x.map((value, index) => <th key={`x-${index}`}>{value}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...y].reverse().map((yValue, reverseIndex) => {
            const row = rows - 1 - reverseIndex;
            return (
              <tr key={`y-${row}`}>
                <th>{yValue}</th>
                {x.map((_, col) => (
                  <td
                    className={changedAt(row, col) ? 'compare-cell-changed' : ''}
                    key={`cell-${row}-${col}`}
                  >
                    {valueAt(row, col)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurveOverlay({ curve }: { curve: CurveComparison }) {
  const xScale = axisSpec(curve.definition.xAxis, curve.xA, curve.xB);
  const yScale = axisSpec(curve.definition.yAxis, curve.yA, curve.yB);
  const xSpan = xScale.max - xScale.min;
  const ySpan = yScale.max - yScale.min;

  const width = 680;
  const height = 320;
  const marginLeft = 60;
  const marginRight = 18;
  const marginTop = 20;
  const marginBottom = 48;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const bottom = marginTop + plotHeight;
  const right = marginLeft + plotWidth;

  const xPixel = (value: number) => marginLeft + ((value - xScale.min) / xSpan) * plotWidth;
  const yPixel = (value: number) => bottom - ((value - yScale.min) / ySpan) * plotHeight;

  const makePolyline = (x: number[], y: number[]) => {
    const count = Math.min(x.length, y.length);
    return Array.from({ length: count }, (_, index) =>
      `${xPixel(x[index]).toFixed(1)},${yPixel(y[index]).toFixed(1)}`,
    ).join(' ');
  };

  const count = Math.min(curve.xA.length, curve.xB.length, curve.yA.length, curve.yB.length);

  return (
    <>
      <div className="curve-legend">
        <span><i className="curve-key curve-key-a" />Tune A</span>
        <span><i className="curve-key curve-key-b" />Tune B</span>
      </div>

      <svg className="curve-chart compare-curve-chart" viewBox={`0 0 ${width} ${height}`}>
        {yScale.ticks.map((tick, index) => {
          const y = yPixel(tick);
          return (
            <g key={`yt-${index}`}>
              <line className="curve-grid" x1={marginLeft} y1={y} x2={right} y2={y} />
              <text className="curve-tick" x={marginLeft - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {formatAxis(tick, ySpan)}
              </text>
            </g>
          );
        })}

        {xScale.ticks.map((tick, index) => {
          const x = xPixel(tick);
          return (
            <g key={`xt-${index}`}>
              <line className="curve-grid" x1={x} y1={marginTop} x2={x} y2={bottom} />
              <text className="curve-tick" x={x} y={bottom + 18} textAnchor="middle">
                {formatAxis(tick, xSpan)}
              </text>
            </g>
          );
        })}

        <line className="curve-axis-line" x1={marginLeft} y1={bottom} x2={right} y2={bottom} />
        <line className="curve-axis-line" x1={marginLeft} y1={marginTop} x2={marginLeft} y2={bottom} />

        <polyline className="compare-curve-a" points={makePolyline(curve.xA, curve.yA)} fill="none" />
        <polyline className="compare-curve-b" points={makePolyline(curve.xB, curve.yB)} fill="none" />

        {curve.xA.slice(0, count).map((value, index) => (
          <circle className="compare-point-a" key={`a-${index}`} cx={xPixel(value)} cy={yPixel(curve.yA[index])} r="3.4" />
        ))}
        {curve.xB.slice(0, count).map((value, index) => (
          <circle className="compare-point-b" key={`b-${index}`} cx={xPixel(value)} cy={yPixel(curve.yB[index])} r="3.4" />
        ))}
      </svg>

      <div className="curve-values compare-curve-values">
        {Array.from({ length: count }, (_, index) => {
          const delta = curve.yB[index] - curve.yA[index];
          return (
            <div key={index}>
              <span>{curve.xA[index]}</span>
              <strong>{curve.yA[index]} → {curve.yB[index]}</strong>
              <em>{delta > 0 ? '+' : ''}{Number(delta.toFixed(6))}</em>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function TuneCompare({ navigate }: TuneCompareProps) {
  const [sideA, setSideA] = useState<SideState>(emptySide);
  const [sideB, setSideB] = useState<SideState>(emptySide);
  const [tab, setTab] = useState<CompareTab>('summary');
  const [changedOnly, setChangedOnly] = useState(true);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [tableView, setTableView] = useState<TableView>('absolute');
  const [selectedCurve, setSelectedCurve] = useState('');

  async function loadMsq(
    file: File | undefined,
    setSide: Dispatch<SetStateAction<SideState>>,
  ) {
    if (!file) return;

    try {
      const parsed = parseMsq(await file.text());
      if (!parsed.details.signature) throw new Error('MSQ has no firmware signature.');

      setSide({
        fileName: file.name,
        tune: parsed,
        ini: null,
        definitionStatus: 'loading',
        definitionLabel: '',
        error: '',
      });

      try {
        const entry = await findRegisteredDefinition(parsed.details.signature);
        if (!entry) {
          setSide((current) => ({
            ...current,
            definitionStatus: 'manual-needed',
            definitionLabel: '',
          }));
          return;
        }

        const definition = await loadRegisteredDefinition(entry);
        if (definition.signature !== parsed.details.signature) {
          throw new Error('Registry definition signature does not match this tune.');
        }

        setSide((current) => ({
          ...current,
          ini: definition,
          definitionStatus: 'registry',
          definitionLabel: entry.label,
        }));
      } catch (caught) {
        setSide((current) => ({
          ...current,
          definitionStatus: 'manual-needed',
          definitionLabel: '',
          error: caught instanceof Error
            ? `Automatic definition resolution failed: ${caught.message}`
            : 'Automatic definition resolution failed.',
        }));
      }
    } catch (caught) {
      setSide({
        ...emptySide,
        error: caught instanceof Error ? caught.message : 'Unable to parse this MSQ.',
      });
    }
  }

  async function loadIni(
    file: File | undefined,
    setSide: Dispatch<SetStateAction<SideState>>,
  ) {
    if (!file) return;

    try {
      const definition = parseIni(await file.text());

      setSide((current) => {
        if (!current.tune) {
          return {
            ...current,
            error: 'Load the MSQ before selecting its firmware definition.',
          };
        }

        if (definition.signature !== current.tune.details.signature) {
          return {
            ...current,
            ini: null,
            definitionStatus: 'manual-needed',
            error:
              `INI signature does not match this tune. Tune: ${current.tune.details.signature}; `
              + `INI: ${definition.signature}`,
          };
        }

        return {
          ...current,
          ini: definition,
          definitionStatus: 'manual',
          definitionLabel: file.name,
          error: '',
        };
      });
    } catch (caught) {
      setSide((current) => ({
        ...current,
        error: caught instanceof Error ? caught.message : 'Unable to parse this INI.',
      }));
    }
  }

  const result = useMemo<ComparisonResult | null>(() => {
    if (!sideA.tune || !sideA.ini || !sideB.tune || !sideB.ini) return null;
    return compareTunes(sideA.tune, sideA.ini, sideB.tune, sideB.ini);
  }, [sideA.ini, sideA.tune, sideB.ini, sideB.tune]);

  const scalarRows = useMemo(() => {
    if (!result) return [];
    const query = search.trim().toLowerCase();

    return result.scalars.filter((entry) => {
      if (changedOnly && !entry.changed) return false;
      if (category !== 'All' && entry.category !== category) return false;
      if (query && ![entry.name, entry.label, entry.category].join(' ').toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [category, changedOnly, result, search]);

  const visibleTables = useMemo(
    () => result?.tables.filter((entry) => !changedOnly || entry.changed) ?? [],
    [changedOnly, result],
  );
  const visibleCurves = useMemo(
    () => result?.curves.filter((entry) => !changedOnly || entry.changed) ?? [],
    [changedOnly, result],
  );

  const activeTable =
    visibleTables.find((entry) => entry.id === selectedTable)
    ?? visibleTables[0]
    ?? null;
  const activeCurve =
    visibleCurves.find((entry) => entry.id === selectedCurve)
    ?? visibleCurves[0]
    ?? null;

  const report = useMemo(() => {
    if (!result || !sideA.tune || !sideB.tune) return null;

    return {
      schema: 1,
      generatedAt: new Date().toISOString(),
      tuneA: {
        file: sideA.fileName,
        signature: sideA.tune.details.signature,
        definition: sideA.definitionLabel,
      },
      tuneB: {
        file: sideB.fileName,
        signature: sideB.tune.details.signature,
        definition: sideB.definitionLabel,
      },
      exactFirmwareMatch: result.exactFirmwareMatch,
      summary: {
        changedScalars: result.scalars.filter((entry) => entry.changed).length,
        unchangedScalars: result.scalars.filter((entry) => !entry.changed).length,
        changedTables: result.tables.filter((entry) => entry.changed).length,
        changedCurves: result.curves.filter((entry) => entry.changed).length,
        onlyInA: result.onlyA.length,
        onlyInB: result.onlyB.length,
      },
      changedScalars: result.scalars
        .filter((entry) => entry.changed)
        .map((entry) => ({
          name: entry.name,
          label: entry.label,
          category: entry.category,
          units: entry.units,
          a: entry.a,
          b: entry.b,
          delta: entry.numericDelta,
        })),
      changedTables: result.tables
        .filter((entry) => entry.changed)
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          category: entry.category,
          axesChanged: entry.axesChanged,
          cellsChanged: entry.cellsChanged,
          totalCells: entry.totalCells,
          maxAbsDelta: entry.maxAbsDelta,
          maxPercentDelta: entry.maxPercentDelta,
        })),
      changedCurves: result.curves
        .filter((entry) => entry.changed)
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          category: entry.category,
          pointsChanged: entry.pointsChanged,
          totalPoints: entry.totalPoints,
          maxAbsDelta: entry.maxAbsDelta,
        })),
      onlyInA: result.onlyA,
      onlyInB: result.onlyB,
    };
  }, [result, sideA, sideB]);

  const ready = Boolean(result);
  const changedScalarCount = result?.scalars.filter((entry) => entry.changed).length ?? 0;
  const changedTableCount = result?.tables.filter((entry) => entry.changed).length ?? 0;
  const changedCurveCount = result?.curves.filter((entry) => entry.changed).length ?? 0;

  return (
    <main>
      <header className="hub-hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Tune Compare</h1>
          <p className="lede">
            Compare two EpicEFI tunes with exact firmware definitions. Same-signature tunes receive
            full settings, table and curve comparison; different firmware is limited to a clearly
            marked shared-name scalar intersection.
          </p>
        </div>
        <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/local')}>
          Open Local Viewer
        </button>
      </header>

      <section className="compare-loaders">
        <SideLoader
          title="Tune A · baseline"
          side={sideA}
          onMsq={(file) => void loadMsq(file, setSideA)}
          onIni={(file) => void loadIni(file, setSideA)}
        />
        <SideLoader
          title="Tune B · comparison"
          side={sideB}
          onMsq={(file) => void loadMsq(file, setSideB)}
          onIni={(file) => void loadIni(file, setSideB)}
        />
      </section>

      {!ready && (
        <section className="empty-state compare-empty">
          <h2>Load both tunes and their exact definitions</h2>
          <p>
            Registry definitions resolve automatically when available. Otherwise each side asks for
            its matching local <code>mainController.ini</code>.
          </p>
        </section>
      )}

      {result && (
        <>
          <section className={`compare-compatibility ${result.exactFirmwareMatch ? 'compatible' : 'intersection'}`}>
            <div>
              <span>Compatibility mode</span>
              <strong>
                {result.exactFirmwareMatch
                  ? 'Exact firmware match — full semantic comparison'
                  : 'Different firmware — shared-name scalar intersection only'}
              </strong>
            </div>
            <code>{sideA.tune?.details.signature}</code>
            {!result.exactFirmwareMatch && <code>{sideB.tune?.details.signature}</code>}
          </section>

          <nav className="published-tabs compare-tabs" aria-label="Tune comparison views">
            {(['summary', 'settings', 'tables', 'curves', 'report'] as const).map((candidate) => (
              <button
                type="button"
                key={candidate}
                className={tab === candidate ? 'active' : ''}
                onClick={() => setTab(candidate)}
                disabled={!result.exactFirmwareMatch && (candidate === 'tables' || candidate === 'curves')}
              >
                {candidate[0].toUpperCase() + candidate.slice(1)}
              </button>
            ))}
          </nav>

          {tab === 'summary' && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Comparison summary</p>
                  <h2>{sideA.fileName} → {sideB.fileName}</h2>
                </div>
              </div>

              <div className="comparison-summary-grid">
                <div><span>Changed settings</span><strong>{changedScalarCount}</strong></div>
                <div><span>Unchanged settings</span><strong>{result.scalars.length - changedScalarCount}</strong></div>
                <div><span>Changed tables</span><strong>{result.exactFirmwareMatch ? changedTableCount : 'N/A'}</strong></div>
                <div><span>Changed curves</span><strong>{result.exactFirmwareMatch ? changedCurveCount : 'N/A'}</strong></div>
                <div><span>Only in Tune A</span><strong>{result.onlyA.length}</strong></div>
                <div><span>Only in Tune B</span><strong>{result.onlyB.length}</strong></div>
              </div>

              {!result.exactFirmwareMatch && (
                <div className="mismatch">
                  Firmware signatures differ. Matching constant names are shown only as an intersection;
                  the viewer does not claim that identically named tables, curves or settings have identical
                  semantics across firmware versions.
                </div>
              )}

              {result.categories.length > 0 && (
                <div className="comparison-categories">
                  {result.categories.map((entry) => <span key={entry}>{entry}</span>)}
                </div>
              )}
            </section>
          )}

          {tab === 'settings' && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Definition-aware settings</p>
                  <h2>Scalar differences</h2>
                </div>
                <span className="badge">{scalarRows.length} visible</span>
              </div>

              <div className="compare-filter-row">
                <input
                  className="search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search setting, label or category…"
                />
                <SelectMenu
                  value={category}
                  onChange={setCategory}
                  ariaLabel="Comparison category"
                  options={[
                    { value: 'All' },
                    ...result.categories.map((entry) => ({ value: entry })),
                  ]}
                />
                <label className="compare-checkbox">
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={(event) => setChangedOnly(event.target.checked)}
                  />
                  <span>Changed only</span>
                </label>
              </div>

              <div className="settings-wrap">
                <table className="settings-table compare-settings-table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Category</th>
                      <th>Tune A</th>
                      <th>Tune B</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scalarRows.map((entry) => (
                      <tr key={entry.name} className={entry.changed ? 'compare-row-changed' : ''}>
                        <td>
                          <strong>{entry.label}</strong>
                          <code>{entry.name}</code>
                        </td>
                        <td>{entry.category}</td>
                        <td>{entry.a}{entry.units ? ` ${entry.units}` : ''}</td>
                        <td>{entry.b}{entry.units ? ` ${entry.units}` : ''}</td>
                        <td>{formatDelta(entry.numericDelta, entry.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'tables' && result.exactFirmwareMatch && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Calibration tables</p>
                  <h2>Table comparison</h2>
                </div>
                <label className="compare-checkbox">
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={(event) => setChangedOnly(event.target.checked)}
                  />
                  <span>Changed only</span>
                </label>
              </div>

              {visibleTables.length === 0 ? (
                <p className="table-note">No tables match the current filter.</p>
              ) : activeTable && (
                <>
                  <div className="compare-selector-row">
                    <SelectMenu
                      value={activeTable.id}
                      onChange={setSelectedTable}
                      ariaLabel="Select comparison table"
                      options={visibleTables.map((entry) => ({
                        value: entry.id,
                        label: `${entry.title} · ${entry.cellsChanged}/${entry.totalCells} cells`,
                      }))}
                    />

                    <div className="compare-view-buttons">
                      {([
                        ['a', 'Tune A'],
                        ['b', 'Tune B'],
                        ['absolute', 'Δ absolute'],
                        ['percent', 'Δ %'],
                      ] as const).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={tableView === value ? 'active' : ''}
                          onClick={() => setTableView(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="comparison-stat-strip">
                    <span>Category <strong>{activeTable.category}</strong></span>
                    <span>Changed cells <strong>{activeTable.cellsChanged}/{activeTable.totalCells}</strong></span>
                    <span>Axes changed <strong>{activeTable.axesChanged ? 'Yes' : 'No'}</strong></span>
                    <span>Max |Δ| <strong>{activeTable.maxAbsDelta ?? '—'}</strong></span>
                    <span>Max |Δ%| <strong>{activeTable.maxPercentDelta === null ? '—' : `${Number(activeTable.maxPercentDelta.toFixed(2))}%`}</strong></span>
                  </div>

                  {activeTable.axesChanged && (
                    <div className="mismatch">
                      X or Y bins differ between tunes. Difference cells use Tune A's grid positions;
                      review both Tune A and Tune B views before interpreting deltas.
                    </div>
                  )}

                  <TableGrid table={activeTable} mode={tableView} />
                </>
              )}
            </section>
          )}

          {tab === 'curves' && result.exactFirmwareMatch && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Calibration curves</p>
                  <h2>Overlay comparison</h2>
                </div>
                <label className="compare-checkbox">
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={(event) => setChangedOnly(event.target.checked)}
                  />
                  <span>Changed only</span>
                </label>
              </div>

              {visibleCurves.length === 0 ? (
                <p className="table-note">No curves match the current filter.</p>
              ) : activeCurve && (
                <>
                  <div className="compare-selector-row">
                    <SelectMenu
                      value={activeCurve.id}
                      onChange={setSelectedCurve}
                      ariaLabel="Select comparison curve"
                      options={visibleCurves.map((entry) => ({
                        value: entry.id,
                        label: `${entry.title} · ${entry.pointsChanged} changed value(s)`,
                      }))}
                    />
                  </div>

                  <div className="comparison-stat-strip">
                    <span>Category <strong>{activeCurve.category}</strong></span>
                    <span>Changed values <strong>{activeCurve.pointsChanged}</strong></span>
                    <span>Points <strong>{activeCurve.totalPoints}</strong></span>
                    <span>Max Y |Δ| <strong>{activeCurve.maxAbsDelta ?? '—'}</strong></span>
                  </div>

                  <CurveOverlay curve={activeCurve} />
                </>
              )}
            </section>
          )}

          {tab === 'report' && report && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Portable comparison evidence</p>
                  <h2>Comparison report</h2>
                </div>
                <button
                  type="button"
                  className="open-button button-reset"
                  onClick={() => downloadJson(
                    report,
                    `${sideA.fileName.replace(/\.[^.]+$/, '')}-vs-${sideB.fileName.replace(/\.[^.]+$/, '')}-comparison.json`,
                  )}
                >
                  Download JSON report
                </button>
              </div>

              <p className="table-note">
                The report contains file names, firmware signatures, counts and changed setting/table/curve
                summaries. It does not export the complete tune contents.
              </p>

              <pre className="compare-report-preview">{JSON.stringify(report, null, 2)}</pre>
            </section>
          )}
        </>
      )}

      <footer>
        Tune Compare is read-only. No ECU writes, burns or tune uploads are performed.
      </footer>
    </main>
  );
}
