import { useEffect, useMemo, useState } from 'react';
import type { PublishedTuneMetadata } from './model';
import {
  ecuCollectionPath,
  engineCollectionPath,
  isBaseTune,
  tuneEngineFacet,
  tuneVehicleMakeFacet,
  vehicleCollectionPath,
} from './tuneDiscovery';
import { loadTuneIndex } from './tuneLibrary';
import SelectMenu from './SelectMenu';

type TuneHubProps = {
  navigate: (path: string) => void;
};

type HubScope = 'all' | 'base' | 'community';

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

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right));
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

  const baseTune = isBaseTune(tune);

  return (
    <article className={`tune-card ${baseTune ? 'base-tune-card' : 'community-tune-card'}`}>
      <div className="tune-card-top">
        <div>
          <p className="eyebrow">
            {baseTune ? (
              <button
                type="button"
                className="metadata-link metadata-link-compact button-reset"
                onClick={() => navigate('/browse/base-maps')}
              >
                EpicEFI Base Map
              </button>
            ) : tune.vehicle?.make ? (
              <button
                type="button"
                className="metadata-link metadata-link-compact button-reset"
                onClick={() => navigate(vehicleCollectionPath(tune))}
              >
                {vehicle || 'Vehicle collection'}
              </button>
            ) : (
              'Community tune'
            )}
          </p>
          {baseTune && vehicle && (
            <button
              type="button"
              className="tune-card-context metadata-link button-reset"
              onClick={() => navigate(vehicleCollectionPath(tune))}
            >
              {vehicle}
            </button>
          )}
          <h3>{tune.title}</h3>
        </div>
        <div className="tune-card-badges">
          {tune.parentTuneId && <span className="badge lineage-badge">Revision</span>}
          {!tune.parentTuneId && hasChildren && <span className="badge lineage-badge">Root</span>}
          {tune.versionLabel && !baseTune && (
            <span className="badge lineage-version-badge">{tune.versionLabel}</span>
          )}
          <span className={`badge ${baseTune ? 'base-map-badge' : ''}`}>
            {tune.classification}
          </span>
          <span className="badge badge-ok">{tune.validationStatus}</span>
        </div>
      </div>

      {tune.summary && <p className="tune-card-summary">{tune.summary}</p>}

      {baseTune && (
        <div className="base-tune-notice">
          Reference starting point — verify firmware, hardware and calibration before use.
        </div>
      )}

      <div className="tune-card-specs">
        {engine && (
          <button
            type="button"
            className="metadata-link metadata-chip button-reset"
            onClick={() => navigate(engineCollectionPath(tune))}
          >
            {engine}
          </button>
        )}
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
          <button
            type="button"
            className="metadata-link button-reset"
            onClick={() => navigate(ecuCollectionPath(tune.ecuTarget))}
          >
            {tune.ecuTarget}
          </button>
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
          {tune.tags.slice(0, 7).map((tag) => <span key={tag}>{tag}</span>)}
          {tune.tags.length > 7 && <span>+{tune.tags.length - 7}</span>}
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
  const [scope, setScope] = useState<HubScope>('all');
  const [validation, setValidation] = useState('All');
  const [classification, setClassification] = useState('All');
  const [aspiration, setAspiration] = useState('All');
  const [ecuTarget, setEcuTarget] = useState('All');
  const [vehicleMake, setVehicleMake] = useState('All');
  const [engine, setEngine] = useState('All');
  const [author, setAuthor] = useState('All');
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
    () => uniqueSorted(tunes.map((tune) => tune.validationStatus)),
    [tunes],
  );
  const classificationOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.classification)),
    [tunes],
  );
  const aspirationOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.engine?.aspiration)),
    [tunes],
  );
  const ecuTargetOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.ecuTarget)),
    [tunes],
  );
  const vehicleMakeOptions = useMemo(
    () => uniqueSorted(tunes.map(tuneVehicleMakeFacet)),
    [tunes],
  );
  const engineOptions = useMemo(
    () => uniqueSorted(tunes.map(tuneEngineFacet)),
    [tunes],
  );
  const authorOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.author)),
    [tunes],
  );

  const baseTuneCount = useMemo(
    () => tunes.filter(isBaseTune).length,
    [tunes],
  );
  const communityTuneCount = tunes.length - baseTuneCount;
  const ecuCount = ecuTargetOptions.length;
  const vehicleMakeCount = vehicleMakeOptions.length;

  const parentIds = useMemo(
    () => new Set(
      tunes
        .map((tune) => tune.parentTuneId)
        .filter((value): value is string => Boolean(value)),
    ),
    [tunes],
  );

  const activeFilterCount = [
    search.trim() ? 'search' : '',
    scope !== 'all' ? scope : '',
    validation !== 'All' ? validation : '',
    classification !== 'All' ? classification : '',
    aspiration !== 'All' ? aspiration : '',
    ecuTarget !== 'All' ? ecuTarget : '',
    vehicleMake !== 'All' ? vehicleMake : '',
    engine !== 'All' ? engine : '',
    author !== 'All' ? author : '',
  ].filter(Boolean).length;

  const filteredTunes = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = tunes.filter((tune) => {
      if (query && !metadataSearchText(tune).includes(query)) return false;
      if (scope === 'base' && !isBaseTune(tune)) return false;
      if (scope === 'community' && isBaseTune(tune)) return false;
      if (validation !== 'All' && tune.validationStatus !== validation) return false;
      if (classification !== 'All' && tune.classification !== classification) return false;
      if (aspiration !== 'All' && tune.engine?.aspiration !== aspiration) return false;
      if (ecuTarget !== 'All' && tune.ecuTarget !== ecuTarget) return false;
      if (vehicleMake !== 'All' && tuneVehicleMakeFacet(tune) !== vehicleMake) return false;
      if (engine !== 'All' && tuneEngineFacet(tune) !== engine) return false;
      if (author !== 'All' && tune.author !== author) return false;
      return true;
    });

    result.sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title);
      const leftTime = new Date(left.publishedAt).getTime();
      const rightTime = new Date(right.publishedAt).getTime();
      return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
    });

    return result;
  }, [
    aspiration,
    author,
    classification,
    ecuTarget,
    engine,
    search,
    scope,
    sort,
    tunes,
    validation,
    vehicleMake,
  ]);

  const clearFilters = () => {
    setSearch('');
    setScope('all');
    setValidation('All');
    setClassification('All');
    setAspiration('All');
    setEcuTarget('All');
    setVehicleMake('All');
    setEngine('All');
    setAuthor('All');
    setSort('newest');
  };

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
          <button type="button" className="open-button button-reset" onClick={() => navigate('/browse')}>
            Browse collections
          </button>
          <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/local')}>
            Open local tune
          </button>
          <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/submit')}>
            Submit tune
          </button>
        </div>
      </header>

      {!loading && !loadError && tunes.length > 0 && (
        <section className="hub-catalog-summary" aria-label="Tune Hub catalog summary">
          <button type="button" className="hub-summary-card" onClick={() => setScope('all')}>
            <span>Published tunes</span>
            <strong>{tunes.length}</strong>
            <small>Entire public catalog</small>
          </button>
          <button type="button" className="hub-summary-card base" onClick={() => navigate('/browse/base-maps')}>
            <span>Base maps</span>
            <strong>{baseTuneCount}</strong>
            <small>Open structured Base Map collection</small>
          </button>
          <button type="button" className="hub-summary-card" onClick={() => setScope('community')}>
            <span>Community tunes</span>
            <strong>{communityTuneCount}</strong>
            <small>Published non-base calibrations</small>
          </button>
          <div className="hub-summary-card static">
            <span>ECU targets</span>
            <strong>{ecuCount}</strong>
            <small>{vehicleMakeCount} vehicle makes represented</small>
          </div>
        </section>
      )}

      <section className="hub-controls panel">
        <div className="hub-search-row">
          <input
            className="search hub-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search vehicle, engine, author, ECU, firmware, tags…"
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

        <div className="hub-scope-row" aria-label="Tune source scope">
          {([
            ['all', `All tunes (${tunes.length})`],
            ['base', `Base maps (${baseTuneCount})`],
            ['community', `Community (${communityTuneCount})`],
          ] as Array<[HubScope, string]>).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`hub-scope-button ${scope === value ? 'active' : ''}`}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="hub-filter-grid">
          <div className="hub-filter-control">
            <label htmlFor="hub-ecu">ECU target</label>
            <SelectMenu
              id="hub-ecu"
              value={ecuTarget}
              onChange={setEcuTarget}
              ariaLabel="ECU target"
              options={[
                { value: 'All', label: 'All ECU targets' },
                ...ecuTargetOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-filter-control">
            <label htmlFor="hub-vehicle">Vehicle make</label>
            <SelectMenu
              id="hub-vehicle"
              value={vehicleMake}
              onChange={setVehicleMake}
              ariaLabel="Vehicle make"
              options={[
                { value: 'All', label: 'All vehicle makes' },
                ...vehicleMakeOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-filter-control">
            <label htmlFor="hub-engine">Engine</label>
            <SelectMenu
              id="hub-engine"
              value={engine}
              onChange={setEngine}
              ariaLabel="Engine"
              options={[
                { value: 'All', label: 'All engines' },
                ...engineOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

          <div className="hub-filter-control">
            <label htmlFor="hub-author">Author</label>
            <SelectMenu
              id="hub-author"
              value={author}
              onChange={setAuthor}
              ariaLabel="Author"
              options={[
                { value: 'All', label: 'All authors' },
                ...authorOptions.map((option) => ({ value: option })),
              ]}
            />
          </div>

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

          <div className="hub-filter-actions">
            <span>Results</span>
            <strong>{filteredTunes.length}</strong>
            <button
              type="button"
              className="hub-clear-button button-reset"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
            >
              Clear {activeFilterCount ? `(${activeFilterCount})` : ''}
            </button>
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
          <p>Clear or change one of the active Tune Hub facets.</p>
          <button type="button" className="open-button button-reset" onClick={clearFilters}>
            Clear filters
          </button>
        </section>
      )}

      {!loading && !loadError && filteredTunes.length > 0 && (
        <>
          <div className="hub-results-heading">
            <div>
              <p className="eyebrow">
                {scope === 'base'
                  ? 'EpicEFI base maps'
                  : scope === 'community'
                    ? 'Community tunes'
                    : 'Published catalog'}
              </p>
              <h2>
                {filteredTunes.length} tune{filteredTunes.length === 1 ? '' : 's'}
              </h2>
            </div>
            {activeFilterCount > 0 && (
              <span>{activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}</span>
            )}
          </div>

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
        </>
      )}

      <footer>
        GitHub prototype catalog — published tunes are explicit repository entries. Local files remain local.
      </footer>
    </main>
  );
}
