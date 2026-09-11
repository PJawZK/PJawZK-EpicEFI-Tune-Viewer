import { useMemo, useState } from 'react';
import type { ParsedTune } from './model';
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

export default function App() {
  const [fileName, setFileName] = useState('');
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const visibleConstants = useMemo(() => {
    if (!tune) return [];
    const query = filter.trim().toLowerCase();
    if (!query) return tune.constants.slice(0, 250);
    return tune.constants
      .filter((constant) => constant.name.toLowerCase().includes(query))
      .slice(0, 250);
  }, [filter, tune]);

  async function loadFile(file: File | undefined) {
    if (!file) return;

    setError('');
    setTune(null);
    setFileName(file.name);

    try {
      const raw = await file.text();
      setTune(parseMsq(raw));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to parse this MSQ.');
    }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Tune Viewer</h1>
          <p className="lede">
            V0.1 browser prototype. Files are parsed locally in your browser and are not uploaded.
          </p>
        </div>
        <label className="open-button">
          Open MSQ
          <input
            type="file"
            accept=".msq,.xml,text/xml,application/xml"
            onChange={(event) => void loadFile(event.target.files?.[0])}
          />
        </label>
      </header>

      {!tune && !error && (
        <section className="empty-state">
          <h2>Open an EpicEFI tune</h2>
          <p>
            The first milestone validates MSQ parsing and firmware metadata before INI-driven dialogs
            and tables are added.
          </p>
        </section>
      )}

      {error && (
        <section className="error-state">
          <h2>Could not read {fileName || 'file'}</h2>
          <p>{error}</p>
        </section>
      )}

      {tune && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Loaded locally</p>
                <h2>{fileName}</h2>
              </div>
              <span className="badge">Prototype / Unverified</span>
            </div>

            <div className="details-grid">
              <Detail label="Signature" value={tune.details.signature} />
              <Detail label="Firmware info" value={tune.details.firmwareInfo} />
              <Detail label="File format" value={tune.details.fileFormat} />
              <Detail label="Pages" value={tune.details.nPages} />
              <Detail label="Write date" value={tune.details.writeDate} />
              <Detail label="Author" value={tune.details.author} />
            </div>

            {tune.details.tuneComment && (
              <div className="comment">
                <span>Tune comment</span>
                <p>{tune.details.tuneComment}</p>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Raw MSQ evidence</p>
                <h2>{tune.constants.length.toLocaleString()} constants</h2>
              </div>
              <input
                className="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by constant name"
                aria-label="Filter constants"
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                    <th>Units</th>
                    <th>Shape</th>
                    <th>Page</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleConstants.map((constant) => (
                    <tr key={constant.name}>
                      <td><code>{constant.name}</code></td>
                      <td className="value">{constant.value || '—'}</td>
                      <td>{constant.units ?? '—'}</td>
                      <td>
                        {constant.rows && constant.cols
                          ? `${constant.rows}×${constant.cols}`
                          : constant.rows
                            ? `${constant.rows}`
                            : 'scalar'}
                      </td>
                      <td>{constant.page ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleConstants.length === 250 && !filter && (
              <p className="table-note">Showing the first 250 constants. Use the filter to inspect others.</p>
            )}
          </section>
        </>
      )}

      <footer>
        V0.1 foundation — local MSQ inspection only. No tune is published by opening it here.
      </footer>
    </main>
  );
}
