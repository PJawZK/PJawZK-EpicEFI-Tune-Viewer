import { useEffect, useMemo, useState } from 'react';
import {
  loadDefinitionRegistry,
  loadRegisteredDefinition,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import type { ParsedIni } from './model';
import SelectMenu from './SelectMenu';

type DefinitionHubProps = {
  navigate: (path: string) => void;
};


type DefinitionDiffItem = {
  id: string;
  label: string;
};

type DefinitionDiff = {
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

function displayRelease(entry: DefinitionRegistryEntry): string {
  return entry.release?.trim() || 'Release not recorded';
}

function definitionLabel(entry: DefinitionRegistryEntry): string {
  return `${entry.ecuTarget} · ${displayRelease(entry)} · ${entry.label}`;
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
    if (JSON.stringify(before) !== JSON.stringify(item)) {
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

function compareDefinitions(left: ParsedIni, right: ParsedIni): DefinitionDiff {
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

function diffCount(diff: DefinitionDiff): number {
  return Object.values(diff).reduce((sum, items) => sum + items.length, 0);
}

function DiffPreview({
  diff,
  left,
  right,
}: {
  diff: DefinitionDiff;
  left: DefinitionRegistryEntry;
  right: DefinitionRegistryEntry;
}) {
  const groups: Array<[string, DefinitionDiffItem[], string]> = [
    ['Added settings', diff.addedSettings, 'added'],
    ['Changed settings', diff.changedSettings, 'changed'],
    ['Removed settings', diff.removedSettings, 'removed'],
    ['Added tables', diff.addedTables, 'added'],
    ['Changed tables', diff.changedTables, 'changed'],
    ['Removed tables', diff.removedTables, 'removed'],
    ['Added curves', diff.addedCurves, 'added'],
    ['Changed curves', diff.changedCurves, 'changed'],
    ['Removed curves', diff.removedCurves, 'removed'],
    ['Added dialogs', diff.addedDialogs, 'added'],
    ['Changed dialogs', diff.changedDialogs, 'changed'],
    ['Removed dialogs', diff.removedDialogs, 'removed'],
    ['Added menus', diff.addedMenus, 'added'],
    ['Changed menus', diff.changedMenus, 'changed'],
    ['Removed menus', diff.removedMenus, 'removed'],
  ];

  return (
    <div className="definition-diff">
      <div className="definition-diff-heading">
        <div>
          <span>Baseline</span>
          <strong>{definitionLabel(left)}</strong>
        </div>
        <div>
          <span>Comparison</span>
          <strong>{definitionLabel(right)}</strong>
        </div>
        <div>
          <span>Total structural changes</span>
          <strong>{diffCount(diff)}</strong>
        </div>
      </div>

      <div className="definition-diff-grid">
        {groups.filter(([, items]) => items.length > 0).map(([title, items, tone]) => (
          <details className={`definition-diff-group ${tone}`} key={title}>
            <summary>{title} <strong>{items.length}</strong></summary>
            <ul>
              {items.slice(0, 40).map((item) => (
                <li key={item.id}>
                  <span>{item.label}</span>
                  {item.label !== item.id && <code>{item.id}</code>}
                </li>
              ))}
            </ul>
            {items.length > 40 && (
              <small>{items.length - 40} more not shown in this compact list.</small>
            )}
          </details>
        ))}
      </div>

      {diffCount(diff) === 0 && (
        <p className="table-note">No structural INI definition changes were detected.</p>
      )}
    </div>
  );
}

export default function DefinitionHub({ navigate }: DefinitionHubProps) {
  const [definitions, setDefinitions] = useState<DefinitionRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('All');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareDiff, setCompareDiff] = useState<DefinitionDiff | null>(null);
  const [historyDiffs, setHistoryDiffs] = useState<Record<string, DefinitionDiff>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});

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

  const sortedDefinitionOptions = useMemo(
    () => [...definitions].sort((a, b) => {
      const targetOrder = a.ecuTarget.localeCompare(b.ecuTarget);
      if (targetOrder) return targetOrder;
      const releaseOrder = (a.release ?? '').localeCompare(b.release ?? '');
      if (releaseOrder) return releaseOrder;
      return a.label.localeCompare(b.label);
    }),
    [definitions],
  );

  const previousBySignature = useMemo(() => {
    const result = new Map<string, DefinitionRegistryEntry>();
    const byTarget = new Map<string, DefinitionRegistryEntry[]>();

    for (const entry of definitions) {
      if (!entry.release) continue;
      const list = byTarget.get(entry.ecuTarget) ?? [];
      list.push(entry);
      byTarget.set(entry.ecuTarget, list);
    }

    for (const list of byTarget.values()) {
      list.sort((a, b) => (a.release ?? '').localeCompare(b.release ?? ''));
      for (let index = 1; index < list.length; index += 1) {
        result.set(list[index].signature, list[index - 1]);
      }
    }

    return result;
  }, [definitions]);

  async function runDefinitionCompare() {
    if (!compareA || !compareB || compareA === compareB) return;
    const left = definitions.find((entry) => entry.signature === compareA);
    const right = definitions.find((entry) => entry.signature === compareB);
    if (!left || !right) return;

    setCompareLoading(true);
    setCompareError('');
    setCompareDiff(null);
    try {
      const [leftDefinition, rightDefinition] = await Promise.all([
        loadRegisteredDefinition(left),
        loadRegisteredDefinition(right),
      ]);
      setCompareDiff(compareDefinitions(leftDefinition, rightDefinition));
    } catch (caught) {
      setCompareError(
        caught instanceof Error ? caught.message : 'Unable to compare these firmware definitions.',
      );
    } finally {
      setCompareLoading(false);
    }
  }

  async function loadHistoryDiff(entry: DefinitionRegistryEntry) {
    const previous = previousBySignature.get(entry.signature);
    if (!previous || historyDiffs[entry.signature] || historyLoading[entry.signature]) return;

    setHistoryLoading((current) => ({ ...current, [entry.signature]: true }));
    setHistoryErrors((current) => ({ ...current, [entry.signature]: '' }));
    try {
      const [previousDefinition, currentDefinition] = await Promise.all([
        loadRegisteredDefinition(previous),
        loadRegisteredDefinition(entry),
      ]);
      const diff = compareDefinitions(previousDefinition, currentDefinition);
      setHistoryDiffs((current) => ({ ...current, [entry.signature]: diff }));
    } catch (caught) {
      setHistoryErrors((current) => ({
        ...current,
        [entry.signature]: caught instanceof Error
          ? caught.message
          : 'Unable to compare firmware history.',
      }));
    } finally {
      setHistoryLoading((current) => ({ ...current, [entry.signature]: false }));
    }
  }

  return (
    <main>
      <header className="hub-hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Firmware Definitions</h1>
          <p className="lede">
            Browse exact EpicEFI firmware definitions, inspect what each release exposes, and
            compare structural changes between firmware versions. The registry remains a
            convenience layer only: unregistered or development firmware can still use its exact
            matching local <code>mainController.ini</code>.
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

      {!loading && !loadError && definitions.length > 1 && (
        <section className="panel definition-compare-panel">
          <div className="definition-compare-heading">
            <div>
              <p className="eyebrow">Firmware definition compare</p>
              <h2>Compare two firmware releases</h2>
              <p className="table-note">
                This compares the actual INI definition structures: settings, tables, curves,
                dialogs and menus. Release labels are used for chronology; registry insertion order
                is not used.
              </p>
            </div>
          </div>

          <div className="definition-compare-controls">
            <SelectMenu
              value={compareA}
              onChange={setCompareA}
              ariaLabel="Baseline firmware definition"
              options={[
                { value: '', label: 'Choose baseline firmware…' },
                ...sortedDefinitionOptions.map((entry) => ({
                  value: entry.signature,
                  label: definitionLabel(entry),
                })),
              ]}
            />
            <SelectMenu
              value={compareB}
              onChange={setCompareB}
              ariaLabel="Comparison firmware definition"
              options={[
                { value: '', label: 'Choose comparison firmware…' },
                ...sortedDefinitionOptions.map((entry) => ({
                  value: entry.signature,
                  label: definitionLabel(entry),
                })),
              ]}
            />
            <button
              type="button"
              className="open-button button-reset"
              disabled={!compareA || !compareB || compareA === compareB || compareLoading}
              onClick={() => void runDefinitionCompare()}
            >
              {compareLoading ? 'Comparing…' : 'Compare firmware'}
            </button>
          </div>

          {compareError && <div className="mismatch">{compareError}</div>}

          {compareDiff && compareA && compareB && (
            <DiffPreview
              diff={compareDiff}
              left={definitions.find((entry) => entry.signature === compareA)!}
              right={definitions.find((entry) => entry.signature === compareB)!}
            />
          )}
        </section>
      )}

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

              <div className="definition-history-summary">
                <div>
                  <span>Firmware release</span>
                  <strong>{displayRelease(entry)}</strong>
                </div>
                <div>
                  <span>Previous firmware milestone</span>
                  <strong>
                    {previousBySignature.get(entry.signature)?.release ?? 'No earlier milestone registered'}
                  </strong>
                </div>
              </div>

              {previousBySignature.has(entry.signature) && (
                <details
                  className="definition-history"
                  onToggle={(event) => {
                    if ((event.currentTarget as HTMLDetailsElement).open) {
                      void loadHistoryDiff(entry);
                    }
                  }}
                >
                  <summary>What changed in this firmware milestone?</summary>
                  <p className="table-note">
                    Compared by firmware release chronology for this ECU target, not by upload order.
                  </p>
                  {historyLoading[entry.signature] && <p className="table-note">Comparing definitions…</p>}
                  {historyErrors[entry.signature] && (
                    <div className="mismatch">{historyErrors[entry.signature]}</div>
                  )}
                  {historyDiffs[entry.signature] && (
                    <DiffPreview
                      diff={historyDiffs[entry.signature]}
                      left={previousBySignature.get(entry.signature)!}
                      right={entry}
                    />
                  )}
                </details>
              )}

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
