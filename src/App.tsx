import { useMemo, useRef, useState } from 'react';
import type {
  IniConstantDefinition,
  IniTableDefinition,
  ParsedIni,
  ParsedTune,
  TuneConstant,
} from './model';
import {
  findRegisteredDefinition,
  loadRegisteredDefinition,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import { parseIni } from './ini';
import { resolveIniText } from './iniExpression';
import { parseMsq } from './msq';
import './styles.css';

type DefinitionSource = 'none' | 'registry' | 'manual';
type RegistryStatus = 'idle' | 'loading' | 'unknown' | 'ready';

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
  ini,
}: {
  table: IniTableDefinition;
  tuneMap: Map<string, TuneConstant>;
  definitionMap: Map<string, IniConstantDefinition>;
  ini: ParsedIni;
}) {
  const x = tuneMap.get(table.xBins);
  const y = tuneMap.get(table.yBins);
  const z = tuneMap.get(table.zBins);

  if (!x || !y || !z) {
    return <p className="table-note">This table is defined but incomplete in the loaded MSQ.</p>;
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

  const xDefinition = definitionMap.get(table.xBins);
  const yDefinition = definitionMap.get(table.yBins);
  const zDefinition = definitionMap.get(table.zBins);
  const xLabel = resolveIniText(table.xLabel, ini, tuneMap, definitionMap) || 'X';
  const yLabel = resolveIniText(table.yLabel, ini, tuneMap, definitionMap) || 'Y';
  const xUnits = resolveIniText(xDefinition?.units || x.units || '', ini, tuneMap, definitionMap);
  const yUnits = resolveIniText(yDefinition?.units || y.units || '', ini, tuneMap, definitionMap);
  const units = resolveIniText(zDefinition?.units || z.units || '', ini, tuneMap, definitionMap);

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
      <p className="table-note">
        X axis follows definition order; Y is displayed high-to-low like a conventional tuning table.
      </p>
    </>
  );
}

export default function App() {
  const [tuneFileName, setTuneFileName] = useState('');
  const [definitionName, setDefinitionName] = useState('');
  const [definitionSource, setDefinitionSource] = useState<DefinitionSource>('none');
  const [registryEntry, setRegistryEntry] = useState<DefinitionRegistryEntry | null>(null);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>('idle');
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [tuneError, setTuneError] = useState('');
  const [iniError, setIniError] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const tuneLoadId = useRef(0);

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

  async function resolveRegisteredDefinition(parsedTune: ParsedTune, loadId: number) {
    setRegistryStatus('loading');

    try {
      const entry = await findRegisteredDefinition(parsedTune.details.signature);
      if (loadId !== tuneLoadId.current) return;

      if (!entry) {
        setRegistryEntry(null);
        setRegistryStatus('unknown');
        return;
      }

      setRegistryEntry(entry);
      const registeredIni = await loadRegisteredDefinition(entry);
      if (loadId !== tuneLoadId.current) return;

      if (registeredIni.signature !== parsedTune.details.signature) {
        throw new Error('Automatically loaded definition does not match the MSQ signature.');
      }

      setIni(registeredIni);
      setDefinitionName(entry.label);
      setDefinitionSource('registry');
      setRegistryStatus('ready');
    } catch (caught) {
      if (loadId !== tuneLoadId.current) return;
      setRegistryStatus('unknown');
      setIniError(
        caught instanceof Error
          ? `Automatic definition loading failed: ${caught.message}`
          : 'Automatic definition loading failed.',
      );
    }
  }

  async function loadTune(file: File | undefined) {
    if (!file) return;
    const loadId = ++tuneLoadId.current;

    setTuneError('');
    setIniError('');
    setTune(null);
    setIni(null);
    setTuneFileName(file.name);
    setDefinitionName('');
    setDefinitionSource('none');
    setRegistryEntry(null);
    setRegistryStatus('idle');
    setSelectedTableId('');

    try {
      const parsedTune = parseMsq(await file.text());
      if (loadId !== tuneLoadId.current) return;

      setTune(parsedTune);
      void resolveRegisteredDefinition(parsedTune, loadId);
    } catch (caught) {
      setTuneError(caught instanceof Error ? caught.message : 'Unable to parse this MSQ.');
    }
  }

  async function loadIni(file: File | undefined) {
    if (!file) return;
    ++tuneLoadId.current;
    setIniError('');
    setIni(null);
    setDefinitionName(file.name);
    setDefinitionSource('manual');
    setRegistryStatus('idle');
    setRegistryEntry(null);

    try {
      setIni(parseIni(await file.text()));
    } catch (caught) {
      setIniError(caught instanceof Error ? caught.message : 'Unable to parse this INI.');
    }
  }

  const gateTitle =
    registryStatus === 'loading'
      ? 'Loading registered definition'
      : tune && ini
        ? signatureMatch
          ? 'Exact signature match'
          : 'Signature mismatch'
        : tune && registryStatus === 'unknown'
          ? 'No registered definition'
          : 'Waiting for tune';

  const gateBadge =
    registryStatus === 'loading'
      ? 'Checking registry'
      : signatureMatch
        ? definitionSource === 'registry'
          ? 'Auto definition accepted'
          : 'Manual definition accepted'
        : tune && ini
          ? 'Interpretation blocked'
          : tune && registryStatus === 'unknown'
            ? 'Manual INI available'
            : 'Incomplete';

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Tune Viewer</h1>
          <p className="lede">
            Open an MSQ locally. Known EpicEFI firmware definitions are resolved automatically by exact
            signature; manual INI loading remains available for unknown or development builds.
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
            Load INI manually
            <input
              type="file"
              accept=".ini,text/plain"
              onChange={(event) => void loadIni(event.target.files?.[0])}
            />
          </label>
        </div>
      </header>

      {!tune && !tuneError && !iniError && (
        <section className="empty-state">
          <h2>Open an EpicEFI tune</h2>
          <p>
            The MSQ firmware signature is checked against the public EpicEFI definition registry. Files
            opened from your computer are not uploaded.
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
          <h2>Definition error</h2>
          <p>{iniError}</p>
        </section>
      )}

      {(tune || ini) && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Firmware definition gate</p>
              <h2>{gateTitle}</h2>
            </div>
            <span className={`badge ${signatureMatch ? 'badge-ok' : tune && ini ? 'badge-bad' : ''}`}>
              {gateBadge}
            </span>
          </div>

          <div className="details-grid">
            <Detail label="MSQ" value={tuneFileName || 'Not loaded'} />
            <Detail label="Definition" value={definitionName || 'Not loaded'} />
            <Detail
              label="Definition source"
              value={
                definitionSource === 'registry'
                  ? 'EpicEFI public registry'
                  : definitionSource === 'manual'
                    ? 'Local manual INI'
                    : '—'
              }
            />
            <Detail
              label="Signature"
              value={tune?.details.signature || ini?.signature || '—'}
            />
            <Detail label="MSQ constants" value={tune?.constants.length ?? null} />
            <Detail label="Definition settings" value={ini?.constants.length ?? registryEntry?.definitionCount ?? null} />
            <Detail label="Definition tables" value={ini?.tables.length ?? registryEntry?.tableCount ?? null} />
          </div>

          {tune && registryStatus === 'unknown' && !ini && (
            <div className="mismatch">
              No public definition is registered for <code>{tune.details.signature}</code>. Load the
              exact matching <code>mainController.ini</code> manually; the viewer will not guess or
              fall back to another firmware version.
            </div>
          )}

          {tune && ini && !signatureMatch && (
            <div className="mismatch">
              The MSQ signature is <code>{tune.details.signature}</code>, while the loaded definition
              expects <code>{ini.signature}</code>. Interpretation is intentionally disabled.
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
                <p className="eyebrow">Definition-driven interpretation</p>
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
                <p className="eyebrow">EpicEFI calibration tables</p>
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
                  ini={ini}
                />
              </>
            ) : (
              <p className="table-note">No complete table definitions were found in this MSQ.</p>
            )}
          </section>
        </>
      )}

      <footer>
        V0.2 prototype — exact-signature automatic definitions with manual fallback. Local MSQ/INI files
        are not published.
      </footer>
    </main>
  );
}
