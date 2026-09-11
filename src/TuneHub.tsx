import { useEffect, useMemo, useState } from 'react';
import type { PublishedTuneMetadata } from './model';
import { loadTuneIndex } from './tuneLibrary';
import SelectMenu from './SelectMenu';

type TuneHubProps = {
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

function metadataSearchText(tune: PublishedTuneMetadata): string {
  return [
    tune.title,
    tune.summary,
    tune.author,
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
    tune.injectorCc,
    tune.powerHp,
    tune.stockPowerHp,
    tune.torqueNm,
    tune.boostBar,
    tune.versionLabel,
    ...tune.tags,
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' ')
    .toLowerCase();
}

function TuneCard({
  tune,
  hasChildren,
  navigate,
}: {
  tune: PublishedTuneMetadata;
  hasChildren: boolean;
  navigate: (path: string) => void;
}) {
  const vehicle = [
    tune.vehicle?.year,
    tune.vehicle?.make,
    tune.vehicle?.model,
  ].filter(Boolean).join(' ');

  const engine = [
    tune.engine?.make,
    tune.engine?.code,
    tune.engine?.displacementLiters ? `${tune.engine.displacementLiters} L` : '',
    tune.engine?.cylinders ? `${tune.engine.cylinders} cyl` : '',
    tune.engine?.aspiration,
  ].filter(Boolean).join(' · ');

  return (
    <article className="tune-card">
      <div className="tune-card-top">
        <div>
          <p className="eyebrow">{vehicle || 'EpicEFI tune'}</p>
          <h3>{tune.title}</h3>
        </div>
        <div className="tune-card-badges">
          {tune.parentTuneId && <span className="badge lineage-badge">Revision</span>}
          {!tune.parentTuneId && hasChildren && <span className="badge lineage-badge">Root</span>}
          {tune.versionLabel && <span className="badge lineage-version-badge">{tune.versionLabel}</span>}
          <span className="badge">{tune.classification}</span>
          <span className="badge badge-ok">{tune.validationStatus}</span>
        </div>
      </div>

      {tune.summary && <p className="tune-card-summary">{tune.summary}</p>}

      <div className="tune-card-specs">
        {engine && <span>{engine}</span>}
        {tune.fuel && <span>{tune.fuel}</span>}
        {tune.powerHp && <span>{tune.powerHp} hp</span>}
        {tune.boostBar !== undefined && <span>{tune.boostBar} bar</span>}
        {tune.parentTuneId && (
          <button
            type="button"
            className="lineage-inline-link button-reset"
            onClick={() => navigate(`/t/${encodeURIComponent(tune.id)}/lineage`)}
          >
            Lineage
          </button>
        )}
      </div>

      <div className="tune-card-meta">
        <div>
          <span>ECU</span>
          <strong>{tune.ecuTarget}</strong>
        </div>
        <div>
          <span>Author</span>
          <button
            type="button"
            className="author-link button-reset"
            onClick={() => navigate(`/author/${encodeURIComponent(tune.author)}`)}
          >
            {tune.author}
          </button>
        </div>
        <div>
          <span>Published</span>
          <strong>{formatDate(tune.publishedAt)}</strong>
        </div>
      </div>

      {tune.tags.length > 0 && (
        <div className="tune-tags">
          {tune.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}

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

export default function TuneHub({ navigate }: TuneHubProps) {
  const [tunes, setTunes] = useState<PublishedTuneMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [validation, setValidation] = useState('All');
  const [classification, setClassification] = useState('All');
  const [aspiration, setAspiration] = useState('All');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest');

  useEffect(() => {
    let active = true;

    loadTuneIndex()
      .then((index) => {
        if (!active) return;
        setTunes(index.tunes);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(caught instanceof Error ? caught.message : 'Unable to load tune catalog.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const validationOptions = useMemo(
    () => [...new Set(tunes.map((tune) => tune.validationStatus))].sort(),
    [tunes],
  );
  const classificationOptions = useMemo(
    () => [...new Set(tunes.map((tune) => tune.classification))].sort(),
    [tunes],
  );
  const aspirationOptions = useMemo(
    () => [...new Set(tunes.map((tune) => tune.engine?.aspiration).filter(Boolean) as string[])].sort(),
    [tunes],
  );

  const parentIds = useMemo(
    () => new Set(
      tunes
        .map((tune) => tune.parentTuneId)
        .filter((value): value is string => Boolean(value)),
    ),
    [tunes],
  );

  const filteredTunes = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = tunes.filter((tune) => {
      if (query && !metadataSearchText(tune).includes(query)) return false;
      if (validation !== 'All' && tune.validationStatus !== validation) return false;
      if (classification !== 'All' && tune.classification !== classification) return false;
      if (aspiration !== 'All' && tune.engine?.aspiration !== aspiration) return false;
      return true;
    });

    result.sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title);
      const leftTime = new Date(left.publishedAt).getTime();
      const rightTime = new Date(right.publishedAt).getTime();
      return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
    });

    return result;
  }, [aspiration, classification, search, sort, tunes, validation]);

  return (
    <main>
      <header className="hub-hero">
        <div>
          <p className="eyebrow">EpicEFI</p>
          <h1>Tune Hub</h1>
          <p className="lede">
            Browse published EpicEFI tunes, inspect their exact firmware definition, and open the tune
            tables in the browser. Published tunes are reference material, not a guarantee of safe
            calibration for another engine.
          </p>
        </div>
        <div className="hub-hero-actions">
          <button type="button" className="open-button button-reset" onClick={() => navigate('/local')}>
            Open local tune
          </button>
          <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/submit')}>
            Submit tune
          </button>
        </div>
      </header>

      <section className="hub-controls panel">
        <div className="hub-search-row">
          <input
            className="search hub-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search vehicle, engine, author, firmware, tags…"
            aria-label="Search published tunes"
          />
          <SelectMenu
            className="search"
            value={sort}
            onChange={(value) => setSort(value as typeof sort)}
            ariaLabel="Sort tunes"
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
        </div>

        <div className="hub-filter-row">
          <div className="hub-filter-control">
            <label htmlFor="hub-validation">Validation</label>
            <SelectMenu
              id="hub-validation"
              value={validation}
              onChange={setValidation}
              ariaLabel="Validation"
              options={[
                { value: 'All' },
                ...validationOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-filter-control">
            <label htmlFor="hub-classification">Classification</label>
            <SelectMenu
              id="hub-classification"
              value={classification}
              onChange={setClassification}
              ariaLabel="Classification"
              options={[
                { value: 'All' },
                ...classificationOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-filter-control">
            <label htmlFor="hub-aspiration">Aspiration</label>
            <SelectMenu
              id="hub-aspiration"
              value={aspiration}
              onChange={setAspiration}
              ariaLabel="Aspiration"
              options={[
                { value: 'All' },
                ...aspirationOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-count">
            <span>Results</span>
            <strong>{filteredTunes.length}</strong>
          </div>
        </div>
      </section>

      {loading && (
        <section className="empty-state">
          <h2>Loading Tune Hub</h2>
          <p>Reading the repository-backed public tune index.</p>
        </section>
      )}

      {loadError && (
        <section className="error-state">
          <h2>Could not load Tune Hub</h2>
          <p>{loadError}</p>
        </section>
      )}

      {!loading && !loadError && tunes.length === 0 && (
        <section className="empty-state hub-empty">
          <p className="eyebrow">Public catalog</p>
          <h2>No public tunes have been published yet</h2>
          <p>
            The Tune Hub is operational, but the GitHub prototype catalog intentionally starts empty.
            Opening a tune locally does not publish it.
          </p>
          <div className="hub-empty-actions">
            <button type="button" className="open-button button-reset" onClick={() => navigate('/local')}>
              Open a local EpicEFI tune
            </button>
            <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/submit')}>
              Prepare first tune submission
            </button>
          </div>
        </section>
      )}

      {!loading && !loadError && tunes.length > 0 && filteredTunes.length === 0 && (
        <section className="empty-state">
          <h2>No tunes match these filters</h2>
          <p>Change the search terms or filter selections.</p>
        </section>
      )}

      {!loading && !loadError && filteredTunes.length > 0 && (
        <section className="tune-grid">
          {filteredTunes.map((tune) => (
            <TuneCard
              key={tune.id}
              tune={tune}
              hasChildren={parentIds.has(tune.id)}
              navigate={navigate}
            />
          ))}
        </section>
      )}

      <footer>
        GitHub prototype catalog — published tunes are explicit repository entries. Local files remain local.
      </footer>
    </main>
  );
}
