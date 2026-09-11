import { useMemo, useState } from 'react';
import type {
  IniConstantDefinition,
  IniTableDefinition,
  ParsedIni,
  ParsedTune,
  TuneConstant,
} from './model';
import { parseIni } from './ini';
import { parseMsq } from './msq';
import './styles.css';

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value === '' || value === null ? '—' : value}</strong>
    </div>
  );
}

function parseNumbers(value: string): number[] {
  return value
    .split(/\s+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
}

function shapeLabel(
  tuneConstant: TuneConstant,
  definition?: IniConstantDefinition,
): string {
  const rows = definition?.rows ?? tuneConstant.rows;
  const cols = definition?.cols ?? tuneConstant.cols;

  if (rows && cols && cols > 1) return `${rows}×${cols}`;
  if (rows) return `${rows}`;
  return definition?.kind ?? 'scalar';
}

function displayValue(constant: TuneConstant, definition?: IniConstantDefinition): string {
  if ((definition?.kind === 'array' || constant.rows) && constant.value) {
    const count = constant.value.split(/\s+/).filter(Boolean).length;
    return `[${count} values]`;
  }
  return constant.value || '—';
}

function TablePreview({
  table,
  tuneMap,
  definitionMap,
}: {
  table: IniTableDefinition;
  tuneMap: Map<string, TuneConstant>;
  definitionMap: Map<string, IniConstantDefinition>;
}) {
  const x = tuneMap.get(table.xBins);
  const y = tuneMap.get(table.yBins);
  const z = tuneMap.get(table.zBins);

  if (!x || !y || !z) {
    return <p className="table-note">This table is defined by the INI but is incomplete in the loaded MSQ.</p>;
  }

  const xValues = parseNumbers(x.value);
  const yValues = parseNumbers(y.value);
  const zValues = parseNumbers(z.value);
  const expected = xValues.length * yValues.length;

  if (!xValues.length || !yValues.length || zValues.length !== expected) {
    return (
      <p className="table-note">
        Could not form the table grid: expected {expected} cells but found {zValues.length}.
      </p>
    );
  }

  const zDefinition = definitionMap.get(table.zBins);
  const units = zDefinition?.units || z.units || '';

  return (
    <>
      <div className="table-meta">
        <code>{table.zBins}</code>
        <span>{yValues.length}×{xValues.length}</span>
        {units && <span>{units}</span>}
      </div>
      <div className="calibration-grid-wrap">
        <table className="calibration-grid">
          <thead>
            <tr>
              <th>{table.yLabel || 'Y'} \ {table.xLabel || 'X'}</th>
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
      <p className="table-note">
        X axis follows INI order; Y is displayed high-to-low like a conventional tuning table.
      </p>
    </>
  );
}

export default function App() {
  const [tuneFileName, setTuneFileName] = useState('');
  const [iniFileName, setIniFileName] = useState('');
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [tuneError, setTuneError] = useState('');
  const [iniError, setIniError] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');

  const tuneMap = useMemo(
    () => new Map((tune?.constants ?? []).map((constant) => [constant.name, constant])),
    [tune],
  );
  const definitionMap = useMemo(
    () => new Map((ini?.constants ?? []).map((definition) => [definition.name, definition])),
    [ini],
  );

  const signatureMatch = Boolean(
    tune && ini && tune.details.signature && tune.details.signature === ini.signature,
  );

  const recognizedConstants = useMemo(() => {
    if (!tune || !ini || !signatureMatch) return [];
    const query = filter.trim().toLowerCase();

    return tune.constants
      .filter((constant) => definitionMap.has(constant.name))
      .filter((constant) => !query || constant.name.toLowerCase().includes(query))
      .slice(0, 300);
  }, [definitionMap, filter, ini, signatureMatch, tune]);

  const recognizedTables = useMemo(() => {
    if (!tune || !ini || !signatureMatch) return [];
    return ini.tables.filter(
      (table) => tuneMap.has(table.xBins) && tuneMap.has(table.yBins) && tuneMap.has(table.zBins),
    );
  }, [ini, signatureMatch, tune, tuneMap]);

  const selectedTable =
    recognizedTables.find((table) => table.id === selectedTableId)
    ?? recognizedTables.find((table) => table.zBins === 'veTable')
    ?? recognizedTables[0];

  async function loadTune(file: File | undefined) {
    if (!file) return;
    setTuneError('');
    setTune(null);
    setTuneFileName(file.name);

    try {
      setTune(parseMsq(await file.text()));
    } catch (caught) {
      setTuneError(caught instanceof Error ? caught.message : 'Unable to parse this MSQ.');
    }
  }

  async function loadIni(file: File | undefined) {
    if (!file) return;
    setIniError('');
    setIni(null);
    setIniFileName(file.name);

    try {
      setIni(parseIni(await file.text()));
    } catch (caught) {
      setIniError(caught instanceof Error ? caught.message : 'Unable to parse this INI.');
    }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Tune Viewer</h1>
          <p className="lede">
            Local browser prototype. Load an MSQ and its exact EpicEFI mainController.ini; neither file
            is uploaded.
          </p>
        </div>
        <div className="file-actions">
          <label className="open-button">
            Open MSQ
            <input
              type="file"
              accept=".msq,.xml,text/xml,application/xml"
              onChange={(event) => void loadTune(event.target.files?.[0])}
            />
          </label>
          <label className="open-button secondary">
            Open INI
            <input
              type="file"
              accept=".ini,text/plain"
              onChange={(event) => void loadIni(event.target.files?.[0])}
            />
          </label>
        </div>
      </header>

      {!tune && !ini && !tuneError && !iniError && (
        <section className="empty-state">
          <h2>Load a tune and firmware definition</h2>
          <p>
            The viewer will only enable INI-driven interpretation when the firmware signatures match
            exactly.
          </p>
        </section>
      )}

      {tuneError && (
        <section className="error-state">
          <h2>Could not read {tuneFileName || 'MSQ'}</h2>
          <p>{tuneError}</p>
        </section>
      )}

      {iniError && (
        <section className="error-state">
          <h2>Could not read {iniFileName || 'INI'}</h2>
          <p>{iniError}</p>
        </section>
      )}

      {(tune || ini) && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Firmware definition gate</p>
              <h2>
                {tune && ini
                  ? signatureMatch
                    ? 'Exact signature match'
                    : 'Signature mismatch'
                  : 'Waiting for matching pair'}
              </h2>
            </div>
            <span className={`badge ${signatureMatch ? 'badge-ok' : tune && ini ? 'badge-bad' : ''}`}>
              {signatureMatch ? 'Definition accepted' : tune && ini ? 'Interpretation blocked' : 'Incomplete'}
            </span>
          </div>

          <div className="details-grid">
            <Detail label="MSQ" value={tuneFileName || 'Not loaded'} />
            <Detail label="INI" value={iniFileName || 'Not loaded'} />
            <Detail
              label="Signature"
              value={tune?.details.signature || ini?.signature || '—'}
            />
            <Detail label="MSQ constants" value={tune?.constants.length ?? null} />
            <Detail label="INI definitions" value={ini?.constants.length ?? null} />
            <Detail label="INI tables" value={ini?.tables.length ?? null} />
          </div>

          {tune && ini && !signatureMatch && (
            <div className="mismatch">
              The MSQ signature is <code>{tune.details.signature}</code>, while the INI expects{' '}
              <code>{ini.signature}</code>. INI-driven values and tables are intentionally disabled.
            </div>
          )}
        </section>
      )}

      {tune && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Loaded tune</p>
              <h2>{tuneFileName}</h2>
            </div>
            <span className="badge">Prototype / Unverified</span>
          </div>

          <div className="details-grid">
            <Detail label="Firmware info" value={tune.details.firmwareInfo} />
            <Detail label="File format" value={tune.details.fileFormat} />
            <Detail label="Pages" value={tune.details.nPages} />
            <Detail label="Write date" value={tune.details.writeDate} />
            <Detail label="Author" value={tune.details.author} />
            <Detail label="Signature" value={tune.details.signature} />
          </div>
        </section>
      )}

      {tune && ini && signatureMatch && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">INI-driven interpretation</p>
                <h2>
                  {tune.constants.filter((constant) => definitionMap.has(constant.name)).length.toLocaleString()}
                  {' '}matched settings
                </h2>
              </div>
              <input
                className="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter setting name"
                aria-label="Filter interpreted settings"
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind / type</th>
                    <th>Value</th>
                    <th>Units</th>
                    <th>Shape</th>
                    <th>Offset</th>
                  </tr>
                </thead>
                <tbody>
                  {recognizedConstants.map((constant) => {
                    const definition = definitionMap.get(constant.name);
                    return (
                      <tr key={constant.name}>
                        <td><code>{constant.name}</code></td>
                        <td>{definition ? `${definition.kind} / ${definition.dataType}` : '—'}</td>
                        <td className="value">{displayValue(constant, definition)}</td>
                        <td>{definition?.units || constant.units || '—'}</td>
                        <td>{shapeLabel(constant, definition)}</td>
                        <td>{definition?.offset ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {recognizedConstants.length === 300 && (
              <p className="table-note">Showing 300 matched settings. Filter by name to inspect others.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">INI TableEditor</p>
                <h2>{recognizedTables.length} renderable tables</h2>
              </div>
              <select
                className="search"
                value={selectedTable?.id ?? ''}
                onChange={(event) => setSelectedTableId(event.target.value)}
                aria-label="Select calibration table"
              >
                {recognizedTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.title}
                  </option>
                ))}
              </select>
            </div>

            {selectedTable ? (
              <>
                <h3 className="table-title">{selectedTable.title}</h3>
                <TablePreview
                  table={selectedTable}
                  tuneMap={tuneMap}
                  definitionMap={definitionMap}
                />
              </>
            ) : (
              <p className="table-note">No complete INI table definitions were found in this MSQ.</p>
            )}
          </section>
        </>
      )}

      <footer>
        V0.1 prototype — exact-signature interpretation only. Opening files locally does not publish them.
      </footer>
    </main>
  );
}
