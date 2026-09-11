import { useEffect, useMemo, useState } from 'react';
import {
  loadDefinitionRegistry,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import SelectMenu from './SelectMenu';

type DefinitionHubProps = {
  navigate: (path: string) => void;
};

export default function DefinitionHub({ navigate }: DefinitionHubProps) {
  const [definitions, setDefinitions] = useState<DefinitionRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('All');

  useEffect(() => {
    let active = true;

    loadDefinitionRegistry()
      .then((registry) => {
        if (!active) return;
        setDefinitions(registry.definitions);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load firmware definition registry.',
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const targets = useMemo(
    () => [...new Set(definitions.map((entry) => entry.ecuTarget))].sort(),
    [definitions],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return definitions.filter((entry) => {
      if (target !== 'All' && entry.ecuTarget !== target) return false;
      if (!query) return true;

      return [
        entry.signature,
        entry.ecuTarget,
        entry.label,
        entry.source,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [definitions, search, target]);

  return (
    <main>
      <header className="hub-hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Firmware Definitions</h1>
          <p className="lede">
            Browse exact EpicEFI firmware definitions available for automatic MSQ resolution.
            The registry is a convenience layer only: unregistered or development firmware can
            still use its exact matching local <code>mainController.ini</code>.
          </p>
        </div>

        <button
          type="button"
          className="open-button button-reset"
          onClick={() => navigate('/definitions/submit')}
        >
          Submit definition
        </button>
      </header>

      <section className="panel definition-controls">
        <div className="hub-search-row">
          <input
            className="search hub-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search signature, ECU target, release or source…"
            aria-label="Search firmware definitions"
          />

          <SelectMenu
            className="search"
            value={target}
            onChange={setTarget}
            ariaLabel="Filter ECU target"
            options={[
              { value: 'All' },
              ...targets.map((option) => ({ value: option })),
            ]}
          />
        </div>

        <div className="definition-summary">
          <div>
            <span>Registered definitions</span>
            <strong>{definitions.length}</strong>
          </div>
          <div>
            <span>ECU targets</span>
            <strong>{targets.length}</strong>
          </div>
          <div>
            <span>Visible results</span>
            <strong>{filtered.length}</strong>
          </div>
        </div>
      </section>

      {loading && (
        <section className="empty-state">
          <h2>Loading firmware registry</h2>
          <p>Reading exact-signature definitions published with the site.</p>
        </section>
      )}

      {loadError && (
        <section className="error-state">
          <h2>Could not load firmware registry</h2>
          <p>{loadError}</p>
        </section>
      )}

      {!loading && !loadError && definitions.length === 0 && (
        <section className="empty-state hub-empty">
          <p className="eyebrow">Multi-firmware registry</p>
          <h2>No public firmware definitions have been registered yet</h2>
          <p>
            The V0.6 registry pipeline is active. Add any EpicEFI <code>mainController.ini</code>
            through the definition submission builder to create the first exact-signature entry.
          </p>
          <div className="hub-empty-actions">
            <button
              type="button"
              className="open-button button-reset"
              onClick={() => navigate('/definitions/submit')}
            >
              Prepare definition submission
            </button>
            <button
              type="button"
              className="open-button secondary button-reset"
              onClick={() => navigate('/local')}
            >
              Use local INI instead
            </button>
          </div>
        </section>
      )}

      {!loading && !loadError && definitions.length > 0 && filtered.length === 0 && (
        <section className="empty-state">
          <h2>No definitions match these filters</h2>
          <p>Change the signature search or ECU target filter.</p>
        </section>
      )}

      {!loading && !loadError && filtered.length > 0 && (
        <section className="definition-grid">
          {filtered.map((entry) => (
            <article className="definition-card" key={entry.signature}>
              <div className="definition-card-heading">
                <div>
                  <p className="eyebrow">{entry.ecuTarget}</p>
                  <h3>{entry.label}</h3>
                </div>
                <span className="badge badge-ok">Exact signature</span>
              </div>

              <code className="definition-signature">{entry.signature}</code>

              <div className="definition-counts">
                <div><span>Settings</span><strong>{entry.definitionCount.toLocaleString()}</strong></div>
                <div><span>Tables</span><strong>{entry.tableCount}</strong></div>
                <div><span>Curves</span><strong>{entry.curveCount ?? '—'}</strong></div>
                <div><span>Dialogs</span><strong>{entry.dialogCount ?? '—'}</strong></div>
                <div><span>Menus</span><strong>{entry.menuCount ?? '—'}</strong></div>
              </div>

              <div className="definition-source">
                <span>Source</span>
                <strong>{entry.source}</strong>
              </div>

              <details className="definition-integrity">
                <summary>Integrity metadata</summary>
                <div>
                  <span>SHA-256</span>
                  <code>{entry.sha256}</code>
                </div>
                <div>
                  <span>Pack</span>
                  <code>{entry.path}</code>
                </div>
              </details>
            </article>
          ))}
        </section>
      )}

      <footer>
        Exact-signature registry — no nearest-version or cross-target fallback is used.
      </footer>
    </main>
  );
}
