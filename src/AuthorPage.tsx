import { useEffect, useMemo, useState } from 'react';
import type { PublishedTuneMetadata } from './model';
import SelectMenu from './SelectMenu';
import {
  ecuCollectionPath,
  engineCollectionPath,
  vehicleCollectionPath,
} from './tuneDiscovery';
import { findPublishedTune, loadTuneIndex } from './tuneLibrary';

type AuthorPageProps = {
  author: string;
  navigate: (path: string) => void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function searchText(tune: PublishedTuneMetadata): string {
  return [
    tune.title,
    tune.summary,
    tune.id,
    tune.ecuTarget,
    tune.firmwareSignature,
    tune.validationStatus,
    tune.classification,
    tune.vehicle?.make,
    tune.vehicle?.model,
    tune.vehicle?.year,
    tune.vehicle?.trim,
    tune.engine?.make,
    tune.engine?.code,
    tune.engine?.displacementLiters,
    tune.engine?.cylinders,
    tune.engine?.aspiration,
    tune.fuel,
    tune.ignition,
    tune.versionLabel,
    ...tune.tags,
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' ')
    .toLowerCase();
}

function labelSet(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right));
}

function AuthorTuneCard({
  tune,
  navigate,
}: {
  tune: PublishedTuneMetadata;
  navigate: (path: string) => void;
}) {
  const vehicle = [
    tune.vehicle?.year,
    tune.vehicle?.make,
    tune.vehicle?.model,
    tune.vehicle?.trim,
  ].filter(Boolean).join(' ');

  const engine = [
    tune.engine?.make,
    tune.engine?.code,
    tune.engine?.displacementLiters ? `${tune.engine.displacementLiters} L` : '',
    tune.engine?.cylinders ? `${tune.engine.cylinders} cyl` : '',
    tune.engine?.aspiration,
  ].filter(Boolean).join(' · ');

  return (
    <article className="author-tune-card">
      <div className="author-tune-card-top">
        <div>
          <p className="eyebrow">
            {tune.vehicle?.make ? (
              <button
                type="button"
                className="metadata-link metadata-link-compact button-reset"
                onClick={() => navigate(vehicleCollectionPath(tune))}
              >
                {vehicle || 'Vehicle collection'}
              </button>
            ) : (
              'EpicEFI tune'
            )}
          </p>
          <h3>{tune.title}</h3>
          <small>{tune.versionLabel || tune.id}</small>
        </div>
        <div className="tune-card-badges">
          <span className="badge">{tune.classification}</span>
          <span className="badge badge-ok">{tune.validationStatus}</span>
        </div>
      </div>

      {tune.summary && <p>{tune.summary}</p>}

      <div className="author-tune-meta">
        <button
          type="button"
          className="metadata-link button-reset"
          onClick={() => navigate(ecuCollectionPath(tune.ecuTarget))}
        >
          {tune.ecuTarget}
        </button>
        {engine && (
          <button
            type="button"
            className="metadata-link button-reset"
            onClick={() => navigate(engineCollectionPath(tune))}
          >
            {engine}
          </button>
        )}
        <span>{formatDate(tune.publishedAt)}</span>
        {tune.parentTuneId && <span>Revision of {tune.parentTuneId}</span>}
      </div>

      <button
        type="button"
        className="tune-card-open"
        onClick={() => navigate(`/t/${encodeURIComponent(tune.id)}/info`)}
      >
        Open tune
      </button>
    </article>
  );
}

export default function AuthorPage({ author, navigate }: AuthorPageProps) {
  const [tunes, setTunes] = useState<PublishedTuneMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [ecuTarget, setEcuTarget] = useState('All');
  const [classification, setClassification] = useState('All');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');

    loadTuneIndex()
      .then(async (index) => {
        const matches = index.tunes.filter((tune) => tune.author === author);
        const live = await Promise.all(
          matches.map(async (tune) => await findPublishedTune(tune.id) ?? tune),
        );

        if (!active) return;
        setTunes(live.filter((tune) => tune.author === author));
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(
          caught instanceof Error ? caught.message : 'Unable to load this author.',
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [author]);

  const ecuTargets = useMemo(
    () => labelSet(tunes.map((tune) => tune.ecuTarget)),
    [tunes],
  );

  const classifications = useMemo(
    () => labelSet(tunes.map((tune) => tune.classification)),
    [tunes],
  );

  const vehicles = useMemo(
    () => labelSet(
      tunes.map((tune) => {
        const value = [
          tune.vehicle?.make,
          tune.vehicle?.model,
        ].filter(Boolean).join(' ');
        return value || undefined;
      }),
    ),
    [tunes],
  );

  const engines = useMemo(
    () => labelSet(
      tunes.map((tune) => {
        const value = [
          tune.engine?.make,
          tune.engine?.code,
        ].filter(Boolean).join(' ');
        return value || undefined;
      }),
    ),
    [tunes],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = tunes.filter((tune) => {
      if (query && !searchText(tune).includes(query)) return false;
      if (ecuTarget !== 'All' && tune.ecuTarget !== ecuTarget) return false;
      if (classification !== 'All' && tune.classification !== classification) return false;
      return true;
    });

    result.sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title);
      const leftTime = new Date(left.publishedAt).getTime();
      const rightTime = new Date(right.publishedAt).getTime();
      return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
    });

    return result;
  }, [classification, ecuTarget, search, sort, tunes]);

  return (
    <main>
      <header className="author-hero">
        <div>
          <button type="button" className="back-link" onClick={() => navigate('/browse/authors')}>
            ← Browse authors
          </button>
          <p className="eyebrow">Tune author</p>
          <h1>{author}</h1>
          <p className="lede">
            Published EpicEFI tunes attributed to this author in the Tune Hub catalog.
          </p>
        </div>
      </header>

      {loading && (
        <section className="empty-state">
          <h2>Loading author</h2>
          <p>Reading published tune metadata.</p>
        </section>
      )}

      {loadError && (
        <section className="error-state">
          <h2>Could not load author</h2>
          <p>{loadError}</p>
        </section>
      )}

      {!loading && !loadError && tunes.length === 0 && (
        <section className="empty-state">
          <h2>Author not found</h2>
          <p>No currently published tunes use this exact author name.</p>
          <button type="button" className="open-button button-reset" onClick={() => navigate('/')}>
            Return to Tune Hub
          </button>
        </section>
      )}

      {!loading && !loadError && tunes.length > 0 && (
        <>
          <section className="author-stats">
            <div>
              <span>Published tunes</span>
              <strong>{tunes.length}</strong>
            </div>
            <div>
              <span>ECU targets</span>
              <strong>{ecuTargets.length}</strong>
              <small>{ecuTargets.join(' · ') || '—'}</small>
            </div>
            <div>
              <span>Vehicles</span>
              <strong>{vehicles.length}</strong>
              <small>{vehicles.join(' · ') || '—'}</small>
            </div>
            <div>
              <span>Engines</span>
              <strong>{engines.length}</strong>
              <small>{engines.join(' · ') || '—'}</small>
            </div>
          </section>

          <section className="panel author-controls">
            <input
              className="search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this author's tunes…"
              aria-label="Search author tunes"
            />
            <SelectMenu
              value={ecuTarget}
              onChange={setEcuTarget}
              ariaLabel="ECU target"
              options={[
                { value: 'All', label: 'All ECU targets' },
                ...ecuTargets.map((value) => ({ value })),
              ]}
            />
            <SelectMenu
              value={classification}
              onChange={setClassification}
              ariaLabel="Classification"
              options={[
                { value: 'All', label: 'All classifications' },
                ...classifications.map((value) => ({ value })),
              ]}
            />
            <SelectMenu
              value={sort}
              onChange={(value) => setSort(value as typeof sort)}
              ariaLabel="Sort author tunes"
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'title', label: 'Title A–Z' },
              ]}
            />
          </section>

          <div className="author-results-row">
            <span>{filtered.length} of {tunes.length} tune{tunes.length === 1 ? '' : 's'}</span>
          </div>

          {filtered.length === 0 ? (
            <section className="empty-state">
              <h2>No tunes match these filters</h2>
              <p>Change the search text or filter selections.</p>
            </section>
          ) : (
            <section className="author-tune-grid">
              {filtered.map((tune) => (
                <AuthorTuneCard
                  key={tune.id}
                  tune={tune}
                  navigate={navigate}
                />
              ))}
            </section>
          )}
        </>
      )}

      <footer>
        Author pages are derived from published tune metadata and are not user account profiles.
      </footer>
    </main>
  );
}
