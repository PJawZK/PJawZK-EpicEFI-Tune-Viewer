import { useEffect, useMemo, useState } from 'react';
import type { PublishedTuneMetadata } from './model';
import SelectMenu from './SelectMenu';
import {
  ecuCollectionPath,
  engineCollectionPath,
  isBaseTune,
  tuneEngineFacet,
  tuneVehicleMakeFacet,
  vehicleCollectionPath,
} from './tuneDiscovery';
import { loadTuneIndex } from './tuneLibrary';
import {
  firmwareSummary,
  formatTuneDate,
  tuneMetrics,
  validationClass,
} from './tunePresentation';

export type CollectionView =
  | { kind: 'overview' }
  | { kind: 'baseMaps' }
  | { kind: 'vehicles' }
  | { kind: 'vehicle'; make: string; model?: string }
  | { kind: 'engines' }
  | { kind: 'engine'; make: string; code: string }
  | { kind: 'ecus' }
  | { kind: 'ecu'; target: string }
  | { kind: 'authors' };

type CollectionPageProps = {
  view: CollectionView;
  navigate: (path: string) => void;
};

type GroupCard = {
  key: string;
  title: string;
  count: number;
  description: string;
  meta?: string;
  route: string;
  tone?: 'base' | 'default';
};

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right));
}

function searchText(tune: PublishedTuneMetadata): string {
  return [
    tune.title,
    tune.summary,
    tune.author,
    tune.ecuTarget,
    tune.vehicle?.make,
    tune.vehicle?.model,
    tune.vehicle?.year,
    tune.vehicle?.trim,
    tune.engine?.make,
    tune.engine?.code,
    tune.engine?.aspiration,
    tune.fuel,
    tune.ignition,
    tune.classification,
    tune.validationStatus,
    tune.versionLabel,
    ...tune.tags,
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' ')
    .toLowerCase();
}

function displayEngine(tune: PublishedTuneMetadata): string {
  const value = [
    tune.engine?.make,
    tune.engine?.code,
  ].filter(Boolean).join(' ');
  return value || 'Unspecified engine';
}

function displayVehicle(tune: PublishedTuneMetadata): string {
  const value = [
    tune.vehicle?.year,
    tune.vehicle?.make,
    tune.vehicle?.model,
  ].filter(Boolean).join(' ');
  return value || 'Unspecified vehicle';
}

function CollectionCard({
  card,
  navigate,
}: {
  card: GroupCard;
  navigate: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={`collection-card ${card.tone === 'base' ? 'base' : ''}`}
      onClick={() => navigate(card.route)}
    >
      <div>
        <span>{card.count} tune{card.count === 1 ? '' : 's'}</span>
        <h3>{card.title}</h3>
        <p>{card.description}</p>
      </div>
      {card.meta && <small>{card.meta}</small>}
      <strong>Open collection →</strong>
    </button>
  );
}

function CollectionTuneCard({
  tune,
  navigate,
}: {
  tune: PublishedTuneMetadata;
  navigate: (path: string) => void;
}) {
  const vehicle = displayVehicle(tune);
  const engine = displayEngine(tune);
  const metrics = tuneMetrics(tune);
  const updated = tune.updatedAt && tune.updatedAt !== tune.publishedAt;

  return (
    <article className={`collection-tune-card ${isBaseTune(tune) ? 'base' : ''}`}>
      <div className="collection-tune-top">
        <div>
          <p className="eyebrow">{isBaseTune(tune) ? 'EpicEFI Base Map' : vehicle}</p>
          <h3>{tune.title}</h3>
          <small>{tune.versionLabel || tune.id}</small>
        </div>
        <div className="tune-card-badges">
          <span className={`badge ${isBaseTune(tune) ? 'base-map-badge' : ''}`}>
            {tune.classification}
          </span>
          <span className={`badge validation-badge ${validationClass(tune.validationStatus)}`}>
            {tune.validationStatus}
          </span>
        </div>
      </div>

      {tune.summary && <p>{tune.summary}</p>}

      <div className="collection-tune-links">
        {tune.vehicle?.make && (
          <button
            type="button"
            className="metadata-link button-reset"
            onClick={() => navigate(vehicleCollectionPath(tune))}
          >
            Vehicle · {vehicle}
          </button>
        )}
        {(tune.engine?.make || tune.engine?.code) && (
          <button
            type="button"
            className="metadata-link button-reset"
            onClick={() => navigate(engineCollectionPath(tune))}
          >
            Engine · {engine}
          </button>
        )}
        <button
          type="button"
          className="metadata-link button-reset"
          onClick={() => navigate(ecuCollectionPath(tune.ecuTarget))}
        >
          ECU · {tune.ecuTarget}
        </button>
        <button
          type="button"
          className="metadata-link button-reset"
          onClick={() => navigate(`/author/${encodeURIComponent(tune.author)}`)}
        >
          Author · {tune.author}
        </button>
      </div>

      {metrics.length > 0 && (
        <div className="collection-tune-metrics">
          {metrics.slice(0, 3).map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="collection-tune-firmware" title={tune.firmwareSignature}>
        {firmwareSummary(tune.firmwareSignature)}
      </div>

      <div className="collection-tune-footer">
        <span>
          Published {formatTuneDate(tune.publishedAt)}
          {updated && <> · Edited {formatTuneDate(tune.updatedAt)}</>}
        </span>
        <button
          type="button"
          className="tune-card-open"
          onClick={() => navigate(`/t/${encodeURIComponent(tune.id)}/info`)}
        >
          Open tune
        </button>
      </div>
    </article>
  );
}

function GroupGrid({
  cards,
  query,
  navigate,
}: {
  cards: GroupCard[];
  query: string;
  navigate: (path: string) => void;
}) {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? cards.filter((card) => [
        card.title,
        card.description,
        card.meta,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalized))
    : cards;

  return (
    <>
      <div className="collection-results-row">
        <span>{filtered.length} collection{filtered.length === 1 ? '' : 's'}</span>
      </div>
      {filtered.length === 0 ? (
        <section className="empty-state">
          <h2>No collections match</h2>
          <p>Try a different search term.</p>
        </section>
      ) : (
        <section className="collection-grid">
          {filtered.map((card) => (
            <CollectionCard key={card.key} card={card} navigate={navigate} />
          ))}
        </section>
      )}
    </>
  );
}

export default function CollectionPage({ view, navigate }: CollectionPageProps) {
  const [tunes, setTunes] = useState<PublishedTuneMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [validation, setValidation] = useState('All');
  const [classification, setClassification] = useState('All');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');

    loadTuneIndex()
      .then((index) => {
        if (!active) return;
        setTunes(index.tunes);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(
          caught instanceof Error ? caught.message : 'Unable to load Tune Hub collections.',
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSearch('');
    setValidation('All');
    setClassification('All');
    setSort('newest');
  }, [view.kind, 'make' in view ? view.make : '', 'model' in view ? view.model : '', 'code' in view ? view.code : '', 'target' in view ? view.target : '']);

  const validationOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.validationStatus)),
    [tunes],
  );
  const classificationOptions = useMemo(
    () => uniqueSorted(tunes.map((tune) => tune.classification)),
    [tunes],
  );

  const overviewCards = useMemo<GroupCard[]>(() => {
    const vehicles = uniqueSorted(tunes.map(tuneVehicleMakeFacet));
    const engines = uniqueSorted(tunes.map(tuneEngineFacet));
    const ecus = uniqueSorted(tunes.map((tune) => tune.ecuTarget));
    const authors = uniqueSorted(tunes.map((tune) => tune.author));
    const baseMaps = tunes.filter(isBaseTune);

    return [
      {
        key: 'base-maps',
        title: 'EpicEFI Base Maps',
        count: baseMaps.length,
        description: 'Curated reference starting points from the EpicEFI base-map library.',
        meta: `${new Set(baseMaps.map((tune) => tune.ecuTarget)).size} ECU targets`,
        route: '/browse/base-maps',
        tone: 'base',
      },
      {
        key: 'vehicles',
        title: 'Vehicles',
        count: tunes.filter((tune) => tune.vehicle?.make).length,
        description: 'Browse tunes by vehicle make and model.',
        meta: `${vehicles.length} makes`,
        route: '/browse/vehicles',
      },
      {
        key: 'engines',
        title: 'Engines',
        count: tunes.filter((tune) => tune.engine?.make || tune.engine?.code).length,
        description: 'Browse calibrations by engine make and engine code.',
        meta: `${engines.length} engine groups`,
        route: '/browse/engines',
      },
      {
        key: 'ecus',
        title: 'ECU Targets',
        count: tunes.length,
        description: 'Browse published tunes by EpicEFI ECU target.',
        meta: `${ecus.length} targets`,
        route: '/browse/ecus',
      },
      {
        key: 'authors',
        title: 'Authors',
        count: tunes.length,
        description: 'Browse published tunes by tune author.',
        meta: `${authors.length} authors`,
        route: '/browse/authors',
      },
    ];
  }, [tunes]);

  const vehicleCards = useMemo<GroupCard[]>(() => {
    const byMake = new Map<string, PublishedTuneMetadata[]>();
    for (const tune of tunes) {
      const make = tuneVehicleMakeFacet(tune);
      if (!make) continue;
      const group = byMake.get(make) ?? [];
      group.push(tune);
      byMake.set(make, group);
    }

    return [...byMake.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([make, entries]) => {
        const models = uniqueSorted(entries.map((tune) => tune.vehicle?.model));
        return {
          key: make,
          title: make,
          count: entries.length,
          description: models.length
            ? models.slice(0, 4).join(' · ')
            : 'Model not specified',
          meta: `${models.length} model${models.length === 1 ? '' : 's'}`,
          route: vehicleCollectionPath(make),
        };
      });
  }, [tunes]);

  const engineCards = useMemo<GroupCard[]>(() => {
    const groups = new Map<string, {
      make: string;
      code: string;
      tunes: PublishedTuneMetadata[];
    }>();

    for (const tune of tunes) {
      const make = tune.engine?.make?.trim() ?? '';
      const code = tune.engine?.code?.trim() ?? '';
      if (!make && !code) continue;
      const key = `${make}\u0000${code}`;
      const group = groups.get(key) ?? { make, code, tunes: [] };
      group.tunes.push(tune);
      groups.set(key, group);
    }

    return [...groups.values()]
      .sort((left, right) =>
        [left.make, left.code].join(' ').localeCompare([right.make, right.code].join(' ')),
      )
      .map((group) => {
        const label = [group.make, group.code].filter(Boolean).join(' ') || 'Unspecified engine';
        const makes = uniqueSorted(group.tunes.map((tune) => tune.vehicle?.make));
        return {
          key: `${group.make}-${group.code}`,
          title: label,
          count: group.tunes.length,
          description: makes.length
            ? `Vehicles: ${makes.slice(0, 4).join(' · ')}`
            : 'Vehicle metadata not specified',
          meta: uniqueSorted(group.tunes.map((tune) => tune.engine?.aspiration)).join(' · ') || undefined,
          route: engineCollectionPath(group.make, group.code),
        };
      });
  }, [tunes]);

  const ecuCards = useMemo<GroupCard[]>(() => {
    const groups = new Map<string, PublishedTuneMetadata[]>();
    for (const tune of tunes) {
      const group = groups.get(tune.ecuTarget) ?? [];
      group.push(tune);
      groups.set(tune.ecuTarget, group);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, entries]) => ({
        key: target,
        title: target,
        count: entries.length,
        description: uniqueSorted(entries.map((tune) => tune.engine?.code))
          .slice(0, 5)
          .join(' · ') || 'Published EpicEFI tunes',
        meta: `${entries.filter(isBaseTune).length} base map${entries.filter(isBaseTune).length === 1 ? '' : 's'}`,
        route: ecuCollectionPath(target),
      }));
  }, [tunes]);

  const authorCards = useMemo<GroupCard[]>(() => {
    const groups = new Map<string, PublishedTuneMetadata[]>();
    for (const tune of tunes) {
      const group = groups.get(tune.author) ?? [];
      group.push(tune);
      groups.set(tune.author, group);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([author, entries]) => ({
        key: author,
        title: author,
        count: entries.length,
        description: uniqueSorted(entries.map((tune) => tune.engine?.code))
          .slice(0, 5)
          .join(' · ') || 'Published tune author',
        meta: uniqueSorted(entries.map((tune) => tune.ecuTarget)).slice(0, 3).join(' · '),
        route: `/author/${encodeURIComponent(author)}`,
      }));
  }, [tunes]);

  const vehicleModelCards = useMemo<GroupCard[]>(() => {
    if (view.kind !== 'vehicle' || view.model) return [];
    const entries = tunes.filter((tune) => tune.vehicle?.make === view.make);
    const groups = new Map<string, PublishedTuneMetadata[]>();

    for (const tune of entries) {
      const model = tune.vehicle?.model?.trim();
      if (!model) continue;
      const group = groups.get(model) ?? [];
      group.push(tune);
      groups.set(model, group);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, group]) => ({
        key: model,
        title: model,
        count: group.length,
        description: uniqueSorted(group.map((tune) => tune.engine?.code))
          .join(' · ') || 'Engine metadata not specified',
        meta: uniqueSorted(group.map((tune) => tune.ecuTarget)).slice(0, 3).join(' · '),
        route: vehicleCollectionPath(view.make, model),
      }));
  }, [tunes, view]);

  const detailTunes = useMemo(() => {
    let result: PublishedTuneMetadata[] = [];

    if (view.kind === 'baseMaps') {
      result = tunes.filter(isBaseTune);
    } else if (view.kind === 'vehicle') {
      result = tunes.filter((tune) => {
        if (tune.vehicle?.make !== view.make) return false;
        if (view.model && tune.vehicle?.model !== view.model) return false;
        return true;
      });
    } else if (view.kind === 'engine') {
      result = tunes.filter((tune) =>
        (tune.engine?.make?.trim() ?? '') === view.make
        && (tune.engine?.code?.trim() ?? '') === view.code,
      );
    } else if (view.kind === 'ecu') {
      result = tunes.filter((tune) => tune.ecuTarget === view.target);
    }

    const query = search.trim().toLowerCase();
    result = result.filter((tune) => {
      if (query && !searchText(tune).includes(query)) return false;
      if (validation !== 'All' && tune.validationStatus !== validation) return false;
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
  }, [classification, search, sort, tunes, validation, view]);

  const isDetail = ['baseMaps', 'vehicle', 'engine', 'ecu'].includes(view.kind);

  const heading = useMemo(() => {
    switch (view.kind) {
      case 'overview':
        return {
          eyebrow: 'Tune Hub collections',
          title: 'Browse the catalog',
          description: 'Explore published tunes by vehicle, engine, ECU target, author or EpicEFI Base Map status.',
        };
      case 'baseMaps':
        return {
          eyebrow: 'EpicEFI reference library',
          title: 'Base Maps',
          description: 'Curated reference starting points. Verify exact firmware, hardware and calibration before use.',
        };
      case 'vehicles':
        return {
          eyebrow: 'Tune Hub collections',
          title: 'Vehicles',
          description: 'Browse published tunes by vehicle make, then model.',
        };
      case 'vehicle':
        return {
          eyebrow: view.model ? `Vehicle · ${view.make}` : 'Vehicle make',
          title: view.model ? `${view.make} ${view.model}` : view.make,
          description: view.model
            ? 'Published tunes matching this exact vehicle make/model metadata.'
            : 'Published tunes and model collections for this vehicle make.',
        };
      case 'engines':
        return {
          eyebrow: 'Tune Hub collections',
          title: 'Engines',
          description: 'Browse published tunes by engine make and engine code.',
        };
      case 'engine':
        return {
          eyebrow: 'Engine collection',
          title: [view.make, view.code].filter(Boolean).join(' ') || 'Unspecified engine',
          description: 'Published tunes matching this exact engine make/code metadata.',
        };
      case 'ecus':
        return {
          eyebrow: 'Tune Hub collections',
          title: 'ECU Targets',
          description: 'Browse published tunes by EpicEFI ECU target.',
        };
      case 'ecu':
        return {
          eyebrow: 'ECU target collection',
          title: view.target,
          description: 'Published tunes using this ECU target metadata.',
        };
      case 'authors':
        return {
          eyebrow: 'Tune Hub collections',
          title: 'Authors',
          description: 'Browse tune authors represented in the public catalog.',
        };
    }
  }, [view]);

  let cards: GroupCard[] = [];
  if (view.kind === 'overview') cards = overviewCards;
  if (view.kind === 'vehicles') cards = vehicleCards;
  if (view.kind === 'engines') cards = engineCards;
  if (view.kind === 'ecus') cards = ecuCards;
  if (view.kind === 'authors') cards = authorCards;

  return (
    <main>
      <header className="collection-hero">
        <div>
          <button
            type="button"
            className="back-link"
            onClick={() => navigate(view.kind === 'overview' ? '/' : '/browse')}
          >
            ← {view.kind === 'overview' ? 'Tune Hub' : 'Browse collections'}
          </button>
          <p className="eyebrow">{heading.eyebrow}</p>
          <h1>{heading.title}</h1>
          <p className="lede">{heading.description}</p>
        </div>
        <div className="collection-hero-actions">
          <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/')}>
            All tunes
          </button>
          {view.kind !== 'overview' && (
            <button type="button" className="open-button button-reset" onClick={() => navigate('/browse')}>
              Collections
            </button>
          )}
        </div>
      </header>

      {loading && (
        <section className="empty-state">
          <h2>Loading collections</h2>
          <p>Reading the public Tune Hub catalog.</p>
        </section>
      )}

      {loadError && (
        <section className="error-state">
          <h2>Could not load collections</h2>
          <p>{loadError}</p>
        </section>
      )}

      {!loading && !loadError && !isDetail && (
        <>
          <section className="panel collection-search-panel">
            <input
              className="search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={view.kind === 'overview' ? 'Search collection types…' : `Search ${heading.title.toLowerCase()}…`}
              aria-label="Search collections"
            />
          </section>
          <GroupGrid cards={cards} query={search} navigate={navigate} />
        </>
      )}

      {!loading && !loadError && view.kind === 'vehicle' && !view.model && vehicleModelCards.length > 0 && (
        <section className="panel collection-subgroups">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Models</p>
              <h2>{view.make} model collections</h2>
            </div>
            <span className="badge">{vehicleModelCards.length} models</span>
          </div>
          <div className="collection-grid compact">
            {vehicleModelCards.map((card) => (
              <CollectionCard key={card.key} card={card} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {!loading && !loadError && isDetail && (
        <>
          <section className="panel collection-detail-controls">
            <input
              className="search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tunes in this collection…"
              aria-label="Search collection tunes"
            />
            <SelectMenu
              value={validation}
              onChange={setValidation}
              ariaLabel="Validation"
              options={[
                { value: 'All', label: 'All validation states' },
                ...validationOptions.map((value) => ({ value })),
              ]}
            />
            <SelectMenu
              value={classification}
              onChange={setClassification}
              ariaLabel="Classification"
              options={[
                { value: 'All', label: 'All classifications' },
                ...classificationOptions.map((value) => ({ value })),
              ]}
            />
            <SelectMenu
              value={sort}
              onChange={(value) => setSort(value as typeof sort)}
              ariaLabel="Sort collection tunes"
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'title', label: 'Title A–Z' },
              ]}
            />
          </section>

          <div className="collection-results-row">
            <span>{detailTunes.length} tune{detailTunes.length === 1 ? '' : 's'}</span>
          </div>

          {detailTunes.length === 0 ? (
            <section className="empty-state">
              <h2>No tunes match</h2>
              <p>Change the collection search or filters.</p>
            </section>
          ) : (
            <section className="collection-tune-grid">
              {detailTunes.map((tune) => (
                <CollectionTuneCard
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
        Collections are derived from published tune metadata. Exact firmware signature matching remains the compatibility authority.
      </footer>
    </main>
  );
}
