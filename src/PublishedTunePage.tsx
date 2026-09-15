import { useEffect, useMemo, useState } from 'react';
import {
  findRegisteredDefinition,
  loadRegisteredDefinition,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import { parseFirmwareIdentity } from './firmwareIdentity';
import { parseIni } from './ini';
import type {
  ParsedIni,
  ParsedTune,
  PublishedTuneMetadata,
} from './model';
import { parseMsq } from './msq';
import TuneBrowser from './TuneBrowser';
import {
  engineSummary,
  firmwareSummary,
  formatTuneDate,
  tuneIdentity,
  tuneMetrics,
  validationClass,
} from './tunePresentation';
import {
  ecuCollectionPath,
  engineCollectionPath,
  rankRelatedTunes,
  vehicleCollectionPath,
  type RelatedTune,
} from './tuneDiscovery';
import {
  findPublishedDescendants,
  findPublishedTune,
  loadPublishedText,
  loadTuneAncestors,
  loadTuneIndex,
  publicAssetUrl,
  type TuneDescendant,
} from './tuneLibrary';

type PublishedTunePageProps = {
  id: string;
  tab: 'info' | 'tune' | 'lineage' | 'download' | 'share';
  navigate: (path: string) => void;
};

function InfoCell({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number | null | undefined;
  onClick?: () => void;
}) {
  if (value === undefined || value === null || value === '') return null;

  return (
    <div className="detail">
      <span>{label}</span>
      {onClick ? (
        <button
          type="button"
          className="metadata-link detail-metadata-link button-reset"
          onClick={onClick}
        >
          {value}
        </button>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function formatHistoryDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function LineageTuneCard({
  tune,
  current = false,
  root = false,
  latest = false,
  depth = 0,
  navigate,
}: {
  tune: PublishedTuneMetadata;
  current?: boolean;
  root?: boolean;
  latest?: boolean;
  depth?: number;
  navigate: (path: string) => void;
}) {
  const marker = current
    ? 'Current'
    : depth > 0
      ? `Revision +${depth}`
      : 'Ancestor';

  return (
    <button
      type="button"
      className={[
        'lineage-tune-card',
        current ? 'current' : '',
        root ? 'root' : '',
        latest ? 'latest' : '',
      ].filter(Boolean).join(' ')}
      style={depth > 0 ? { marginLeft: `${Math.min(depth, 5) * 18}px` } : undefined}
      onClick={() => navigate(`/t/${encodeURIComponent(tune.id)}/lineage`)}
    >
      <span className="lineage-card-marker-row">
        <span className="lineage-card-marker">{marker}</span>
        {root && <span className="lineage-state-pill">Root</span>}
        {latest && <span className="lineage-state-pill latest">Latest</span>}
      </span>
      <strong>{tune.title}</strong>
      <small>
        {tune.versionLabel || tune.id}
        {' · Published '}
        {formatHistoryDate(tune.publishedAt)}
        {tune.updatedAt && (
          <>
            {' · Edited '}
            {formatHistoryDate(tune.updatedAt)}
          </>
        )}
      </small>
      <span className="lineage-card-badges">
        <span className="badge">{tune.classification}</span>
        <span className={`badge validation-badge ${validationClass(tune.validationStatus)}`}>
          {tune.validationStatus}
        </span>
      </span>
    </button>
  );
}

function RelatedTuneCard({
  related,
  navigate,
}: {
  related: RelatedTune;
  navigate: (path: string) => void;
}) {
  const { tune, reasons } = related;
  const vehicle = [
    tune.vehicle?.year,
    tune.vehicle?.make,
    tune.vehicle?.model,
  ].filter(Boolean).join(' ');

  return (
    <article className="related-tune-card">
      <div className="related-tune-card-top">
        <div>
          <p className="eyebrow">{vehicle || tune.ecuTarget}</p>
          <h3>{tune.title}</h3>
        </div>
        <div className="related-tune-badges">
          <span className="badge">{tune.classification}</span>
          <span className={`badge validation-badge ${validationClass(tune.validationStatus)}`}>
          {tune.validationStatus}
        </span>
        </div>
      </div>

      {tune.summary && <p>{tune.summary}</p>}

      <div className="related-reasons">
        {reasons.map((reason) => <span key={reason}>{reason}</span>)}
      </div>

      <button
        type="button"
        className="related-open button-reset"
        onClick={() => navigate(`/t/${encodeURIComponent(tune.id)}/info`)}
      >
        Open related tune
      </button>
    </article>
  );
}

function routeFor(id: string, tab: PublishedTunePageProps['tab']): string {
  return `/t/${encodeURIComponent(id)}/${tab}`;
}

export default function PublishedTunePage({
  id,
  tab,
  navigate,
}: PublishedTunePageProps) {
  const [metadata, setMetadata] = useState<PublishedTuneMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [metadataError, setMetadataError] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState('');
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [definitionSource, setDefinitionSource] = useState('');
  const [firmwareRegistryEntry, setFirmwareRegistryEntry] =
    useState<DefinitionRegistryEntry | null>(null);
  const [ancestors, setAncestors] = useState<PublishedTuneMetadata[]>([]);
  const [descendants, setDescendants] = useState<TuneDescendant[]>([]);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageError, setLineageError] = useState('');
  const [relatedTunes, setRelatedTunes] = useState<RelatedTune[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMetadataError('');
    setMetadata(null);
    setTune(null);
    setIni(null);
    setAssetError('');
    setDefinitionSource('');
    setFirmwareRegistryEntry(null);

    findPublishedTune(id)
      .then((found) => {
        if (!active) return;
        if (!found) {
          setMetadataError(`Published tune "${id}" was not found.`);
          setLoading(false);
          return;
        }

        setMetadata(found);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setMetadataError(caught instanceof Error ? caught.message : 'Unable to load published tune.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!metadata) return;

    let active = true;
    findRegisteredDefinition(metadata.firmwareSignature)
      .then((entry) => {
        if (active) setFirmwareRegistryEntry(entry);
      })
      .catch(() => {
        if (active) setFirmwareRegistryEntry(null);
      });

    return () => {
      active = false;
    };
  }, [metadata]);

  useEffect(() => {
    if (tab !== 'tune' || !metadata) return;

    let active = true;
    setAssetLoading(true);
    setAssetError('');
    setTune(null);
    setIni(null);
    setDefinitionSource('');

    const loadAssets = async () => {
      const msqText = await loadPublishedText(metadata.files.msq);
      const parsedTune = parseMsq(msqText);

      if (parsedTune.details.signature !== metadata.firmwareSignature) {
        throw new Error(
          'Published MSQ signature does not match its catalog metadata. Tune interpretation is blocked.',
        );
      }

      let parsedIni: ParsedIni;
      let source: string;

      if (metadata.files.ini) {
        parsedIni = parseIni(await loadPublishedText(metadata.files.ini));
        source = 'Published matching mainController.ini';
      } else {
        const registryEntry = await findRegisteredDefinition(metadata.firmwareSignature);
        if (!registryEntry) {
          throw new Error(
            'No exact firmware definition is available for this published tune. '
            + 'The catalog entry must include its matching mainController.ini or reference a registered definition.',
          );
        }

        parsedIni = await loadRegisteredDefinition(registryEntry);
        source = 'EpicEFI public definition registry';
      }

      if (parsedIni.signature !== metadata.firmwareSignature) {
        throw new Error(
          'Published firmware definition does not match the tune signature. Tune interpretation is blocked.',
        );
      }

      if (!active) return;
      setTune(parsedTune);
      setIni(parsedIni);
      setDefinitionSource(source);
      setAssetLoading(false);
    };

    loadAssets().catch((caught) => {
      if (!active) return;
      setAssetError(caught instanceof Error ? caught.message : 'Unable to load published tune assets.');
      setAssetLoading(false);
    });

    return () => {
      active = false;
    };
  }, [metadata, tab]);

  useEffect(() => {
    if (tab !== 'lineage' || !metadata) return;

    let active = true;
    setLineageLoading(true);
    setLineageError('');
    setAncestors([]);
    setDescendants([]);

    Promise.all([
      loadTuneAncestors(metadata),
      findPublishedDescendants(metadata.id),
    ])
      .then(async ([ancestorResult, descendantResult]) => {
        if (!active) return;

        const liveDescendants = await Promise.all(
          descendantResult.map(async (entry) => ({
            depth: entry.depth,
            tune: await findPublishedTune(entry.tune.id) ?? entry.tune,
          })),
        );

        if (!active) return;
        setAncestors(ancestorResult);
        setDescendants(liveDescendants);
        setLineageLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setLineageError(
          caught instanceof Error ? caught.message : 'Unable to load tune lineage.',
        );
        setLineageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [metadata, tab]);

  useEffect(() => {
    if (tab !== 'info' || !metadata) return;

    let active = true;
    setRelatedLoading(true);
    setRelatedError('');
    setRelatedTunes([]);

    loadTuneIndex()
      .then(async (index) => {
        const ranked = rankRelatedTunes(metadata, index.tunes, 6);
        const refreshed = await Promise.all(
          ranked.map(async (entry) => ({
            ...entry,
            tune: await findPublishedTune(entry.tune.id) ?? entry.tune,
          })),
        );

        if (!active) return;
        setRelatedTunes(refreshed);
        setRelatedLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setRelatedError(
          caught instanceof Error ? caught.message : 'Unable to load related tunes.',
        );
        setRelatedLoading(false);
      });

    return () => {
      active = false;
    };
  }, [metadata, tab]);

  const vehicleLabel = useMemo(() => {
    if (!metadata) return '';
    return [
      metadata.vehicle?.year,
      metadata.vehicle?.make,
      metadata.vehicle?.model,
      metadata.vehicle?.trim,
    ].filter(Boolean).join(' ');
  }, [metadata]);

  const engineLabel = useMemo(
    () => metadata ? engineSummary(metadata) : '',
    [metadata],
  );
  const quickMetrics = useMemo(
    () => metadata ? tuneMetrics(metadata) : [],
    [metadata],
  );
  const isBaseMap = metadata?.classification === 'Base Tune';
  const wasUpdated = Boolean(
    metadata?.updatedAt && metadata.updatedAt !== metadata.publishedAt,
  );

  const directChildren = useMemo(
    () => descendants
      .filter((entry) => entry.depth === 1)
      .map((entry) => entry.tune),
    [descendants],
  );

  const descendantParentIds = useMemo(
    () => new Set(
      descendants
        .map((entry) => entry.tune.parentTuneId)
        .filter((value): value is string => Boolean(value)),
    ),
    [descendants],
  );

  const previousRevision = ancestors.length
    ? ancestors[ancestors.length - 1]
    : null;
  const rootTune = metadata
    ? (ancestors[0] ?? metadata)
    : null;
  const currentIsLatest = descendants.length === 0;

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return (
      <main>
        <section className="empty-state">
          <h2>Loading published tune</h2>
          <p>Reading tune metadata from the repository catalog.</p>
        </section>
      </main>
    );
  }

  if (metadataError || !metadata) {
    return (
      <main>
        <section className="error-state">
          <h2>Tune not found</h2>
          <p>{metadataError || 'The requested tune is not available.'}</p>
          <button type="button" className="open-button button-reset" onClick={() => navigate('/')}>
            Return to Tune Hub
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="published-tune-hero">
        <div>
          <button type="button" className="back-link" onClick={() => navigate('/')}>
            ← Tune Hub
          </button>
          <p className="eyebrow">{vehicleLabel || 'Published EpicEFI tune'}</p>
          <h1>{metadata.title}</h1>
          {metadata.summary && <p className="lede">{metadata.summary}</p>}
          <div className="published-badges">
            <span className={`badge ${isBaseMap ? 'base-map-badge' : ''}`}>
              {metadata.classification}
            </span>
            <span className={`badge validation-badge ${validationClass(metadata.validationStatus)}`}>
              {metadata.validationStatus}
            </span>
            <span className="badge tune-identity-badge">{tuneIdentity(metadata)}</span>
            {metadata.lifecycleStatus === 'Archived' && (
              <span className="badge archived-badge">Archived</span>
            )}
          </div>
        </div>
        <div className="published-owner">
          <span>Published by</span>
          <button
            type="button"
            className="author-link button-reset"
            onClick={() => navigate(`/author/${encodeURIComponent(metadata.author)}`)}
          >
            {metadata.author}
          </button>
          <span>Published {formatTuneDate(metadata.publishedAt)}</span>
          {wasUpdated && <span>Updated {formatTuneDate(metadata.updatedAt)}</span>}
          {metadata.lifecycleStatus === 'Archived' && metadata.archivedAt && (
            <span>Archived {formatTuneDate(metadata.archivedAt)}</span>
          )}
          <div className="published-owner-actions">
            <button
              type="button"
              className="open-button secondary button-reset published-edit-button"
              onClick={() => navigate(`/compare?a=${encodeURIComponent(metadata.id)}`)}
            >
              Compare tune
            </button>
            {metadata.parentTuneId && (
              <button
                type="button"
                className="open-button secondary button-reset published-edit-button"
                onClick={() => navigate(
                  `/compare?a=${encodeURIComponent(metadata.parentTuneId!)}&b=${encodeURIComponent(metadata.id)}`,
                )}
              >
                Compare with parent
              </button>
            )}
            <button
              type="button"
              className="open-button secondary button-reset published-edit-button"
              onClick={() => navigate(`/t/${encodeURIComponent(metadata.id)}/edit`)}
            >
              Edit tune
            </button>
            <button
              type="button"
              className="open-button button-reset published-edit-button"
              onClick={() => navigate(`/t/${encodeURIComponent(metadata.id)}/revision`)}
            >
              Create revision
            </button>
          </div>
        </div>
      </header>

      <nav className="published-tabs" aria-label="Published tune views">
        {(['info', 'tune', 'lineage', 'download', 'share'] as const).map((candidate) => (
          <button
            type="button"
            key={candidate}
            className={tab === candidate ? 'active' : ''}
            onClick={() => navigate(routeFor(metadata.id, candidate))}
          >
            {candidate[0].toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'info' && (
        <>
          <section className={`panel tune-quick-summary ${isBaseMap ? 'base-map-summary' : ''}`}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{isBaseMap ? 'EpicEFI Base Map' : 'Tune summary'}</p>
                <h2>At a glance</h2>
              </div>
              <div className="quick-summary-badges">
                <span className={`badge validation-badge ${validationClass(metadata.validationStatus)}`}>
                  {metadata.validationStatus}
                </span>
                <span className="badge">{tuneIdentity(metadata)}</span>
              </div>
            </div>

            <div className="tune-summary-primary">
              {vehicleLabel && (
                <button
                  type="button"
                  className="summary-primary-link button-reset"
                  onClick={() => metadata.vehicle?.make && navigate(vehicleCollectionPath(metadata))}
                >
                  <span>Vehicle</span>
                  <strong>{vehicleLabel}</strong>
                </button>
              )}
              {engineLabel && (
                <button
                  type="button"
                  className="summary-primary-link button-reset"
                  onClick={() => navigate(engineCollectionPath(metadata))}
                >
                  <span>Engine</span>
                  <strong>{engineLabel}</strong>
                </button>
              )}
              <button
                type="button"
                className="summary-primary-link button-reset"
                onClick={() => navigate(ecuCollectionPath(metadata.ecuTarget))}
              >
                <span>ECU target</span>
                <strong>{metadata.ecuTarget}</strong>
              </button>
              {(metadata.fuel || metadata.engine?.aspiration) && (
                <div className="summary-primary-static">
                  <span>Setup</span>
                  <strong>
                    {[metadata.fuel, metadata.engine?.aspiration].filter(Boolean).join(' · ')}
                  </strong>
                </div>
              )}
            </div>

            {quickMetrics.length > 0 && (
              <div className="tune-summary-metrics">
                {quickMetrics.map((metric) => (
                  <div key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
            )}

            <div className="tune-summary-firmware">
              <div>
                <span>Firmware</span>
                <strong title={metadata.firmwareSignature}>
                  {firmwareSummary(metadata.firmwareSignature)}
                </strong>
              </div>
              <div>
                <span>Published</span>
                <strong>{formatTuneDate(metadata.publishedAt)}</strong>
                {wasUpdated && <small>Edited {formatTuneDate(metadata.updatedAt)}</small>}
              </div>
            </div>

            {isBaseMap && (
              <div className="base-map-safety-callout">
                <strong>Reference starting point</strong>
                <span>
                  A Base Map is not a ready-to-run guarantee. Confirm the exact firmware,
                  ECU/hardware configuration, injectors, fuel, trigger, ignition and sensors before use.
                </span>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Tune information</p>
                <h2>Vehicle and engine</h2>
              </div>
            </div>

            <div className="details-grid">
              <InfoCell
                label="Vehicle"
                value={vehicleLabel}
                onClick={
                  metadata.vehicle?.make
                    ? () => navigate(vehicleCollectionPath(metadata))
                    : undefined
                }
              />
              <InfoCell
                label="Engine make"
                value={metadata.engine?.make}
                onClick={
                  metadata.engine?.make || metadata.engine?.code
                    ? () => navigate(engineCollectionPath(metadata))
                    : undefined
                }
              />
              <InfoCell
                label="Engine code"
                value={metadata.engine?.code}
                onClick={
                  metadata.engine?.make || metadata.engine?.code
                    ? () => navigate(engineCollectionPath(metadata))
                    : undefined
                }
              />
              <InfoCell label="Displacement" value={metadata.engine?.displacementLiters ? `${metadata.engine.displacementLiters} L` : null} />
              <InfoCell label="Cylinders" value={metadata.engine?.cylinders} />
              <InfoCell label="Aspiration" value={metadata.engine?.aspiration} />
              <InfoCell label="Compression ratio" value={metadata.engine?.compressionRatio} />
              <InfoCell label="Fuel" value={metadata.fuel} />
              <InfoCell label="Ignition" value={metadata.ignition} />
              <InfoCell label="Injectors" value={metadata.injectorCc ? `${metadata.injectorCc} cc/min` : null} />
              <InfoCell label="Power" value={metadata.powerHp ? `${metadata.powerHp} hp` : null} />
              <InfoCell label="Stock power" value={metadata.stockPowerHp ? `${metadata.stockPowerHp} hp` : null} />
              <InfoCell label="Torque" value={metadata.torqueNm ? `${metadata.torqueNm} Nm` : null} />
              <InfoCell label="Boost" value={metadata.boostBar !== undefined ? `${metadata.boostBar} bar` : null} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Firmware</p>
                <h2>Exact compatibility</h2>
              </div>
            </div>
            <div className="details-grid">
              <InfoCell
                label="ECU target"
                value={metadata.ecuTarget}
                onClick={() => navigate(ecuCollectionPath(metadata.ecuTarget))}
              />
              <InfoCell label="Firmware summary" value={firmwareSummary(metadata.firmwareSignature)} />
              {parseFirmwareIdentity(metadata.firmwareSignature) && (
                <>
                  <InfoCell
                    label="Firmware family"
                    value={parseFirmwareIdentity(metadata.firmwareSignature)!.family}
                  />
                  <InfoCell
                    label="Firmware branch"
                    value={parseFirmwareIdentity(metadata.firmwareSignature)!.branch}
                  />
                  <InfoCell
                    label="Firmware build date"
                    value={parseFirmwareIdentity(metadata.firmwareSignature)!.date}
                  />
                  <InfoCell
                    label="Definition hash"
                    value={parseFirmwareIdentity(metadata.firmwareSignature)!.definitionHash}
                  />
                </>
              )}
              <InfoCell label="Exact firmware signature" value={metadata.firmwareSignature} />
              {firmwareRegistryEntry?.release && (
                <InfoCell label="Registry snapshot" value={firmwareRegistryEntry.release} />
              )}
              <InfoCell label="Validation" value={metadata.validationStatus} />
              <InfoCell label="Classification" value={metadata.classification} />
              <InfoCell label="Tune identity" value={tuneIdentity(metadata)} />
              <InfoCell label="Published" value={formatTuneDate(metadata.publishedAt)} />
              <InfoCell
                label="Last same-ID edit"
                value={wasUpdated ? formatTuneDate(metadata.updatedAt) : 'No later edit recorded'}
              />
            </div>
            {firmwareRegistryEntry && (
              <div className="firmware-source-history">
                <div>
                  <span>Firmware source history</span>
                  <strong>
                    {firmwareRegistryEntry.firmwareChanges?.length
                      ? 'Source-backed release notes available'
                      : 'No source-backed release notes catalogued'}
                  </strong>
                </div>
                {firmwareRegistryEntry.previousFirmwareRelease && (
                  <p>
                    Previous source firmware: <strong>{firmwareRegistryEntry.previousFirmwareRelease}</strong>
                  </p>
                )}
                {firmwareRegistryEntry.sourceRevision && (
                  <p>
                    Source revision: <code>{firmwareRegistryEntry.sourceRevision}</code>
                  </p>
                )}
                {firmwareRegistryEntry.firmwareChanges?.length ? (
                  <ul>
                    {firmwareRegistryEntry.firmwareChanges.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="table-note">
                    Tune Viewer can identify this firmware exactly from the signature, but the
                    signature does not contain a Git commit SHA. Source changes are only shown when
                    release/source evidence is explicitly attached to the firmware definition.
                  </p>
                )}
                {firmwareRegistryEntry.sourceHistoryUrl && (
                  <a
                    href={firmwareRegistryEntry.sourceHistoryUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source history / release notes
                  </a>
                )}
              </div>
            )}

            <div className="mismatch tune-safety-note">
              Reference tune only. Verify firmware, hardware, fuel system, trigger and ignition
              configuration, injectors, sensors and calibration before use on another engine.
            </div>
          </section>

          {(metadata.notes || metadata.tags.length > 0) && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Description</p>
                  <h2>Notes and tags</h2>
                </div>
              </div>
              {metadata.notes && <p className="published-notes">{metadata.notes}</p>}
              {metadata.tags.length > 0 && (
                <div className="tune-tags">
                  {metadata.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              )}
            </section>
          )}

          {(relatedLoading || relatedError || relatedTunes.length > 0) && (
            <section className="panel related-tunes-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Discovery</p>
                  <h2>Related tunes</h2>
                </div>
                {!relatedLoading && !relatedError && (
                  <span className="badge">{relatedTunes.length} suggestions</span>
                )}
              </div>

              <p className="table-note">
                Related tunes are ranked from published metadata such as engine, vehicle, ECU target,
                aspiration, fuel, tags and lineage. Similarity is not a compatibility guarantee.
              </p>

              {relatedLoading && (
                <div className="related-loading">Finding related published tunes…</div>
              )}

              {relatedError && (
                <div className="related-error">{relatedError}</div>
              )}

              {!relatedLoading && !relatedError && relatedTunes.length > 0 && (
                <div className="related-tune-grid">
                  {relatedTunes.map((related) => (
                    <RelatedTuneCard
                      key={related.tune.id}
                      related={related}
                      navigate={navigate}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'tune' && (
        <>
          {assetLoading && (
            <section className="empty-state">
              <h2>Loading tune definition</h2>
              <p>Checking the published MSQ against its exact firmware signature.</p>
            </section>
          )}

          {assetError && (
            <section className="error-state">
              <h2>Tune interpretation blocked</h2>
              <p>{assetError}</p>
            </section>
          )}

          {tune && ini && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Firmware definition gate</p>
                    <h2>Exact signature match</h2>
                  </div>
                  <span className="badge badge-ok">Definition accepted</span>
                </div>
                <div className="details-grid">
                  <InfoCell label="MSQ signature" value={tune.details.signature} />
                  <InfoCell label="Definition signature" value={ini.signature} />
                  <InfoCell label="Definition source" value={definitionSource} />
                  <InfoCell label="Settings" value={ini.constants.length} />
                  <InfoCell label="Tables" value={ini.tables.length} />
                  <InfoCell label="Curves" value={ini.curves.length} />
                </div>
              </section>

              <section className="panel tune-browser-panel">
                <div className="panel-heading browser-intro">
                  <div>
                    <p className="eyebrow">Published tune</p>
                    <h2>Browse calibration</h2>
                  </div>
                </div>
                <TuneBrowser ini={ini} tune={tune} />
              </section>
            </>
          )}
        </>
      )}

      {tab === 'lineage' && (
        <>
          {lineageLoading && (
            <section className="empty-state">
              <h2>Loading tune lineage</h2>
              <p>Resolving this tune's ancestors and derived revisions.</p>
            </section>
          )}

          {lineageError && (
            <section className="error-state">
              <h2>Could not resolve lineage</h2>
              <p>{lineageError}</p>
            </section>
          )}

          {!lineageLoading && !lineageError && (
            <>
              <section className="panel lineage-history-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Revision history</p>
                    <h2>Active lineage chain</h2>
                  </div>
                  <span className={`badge ${currentIsLatest ? 'badge-ok' : ''}`}>
                    {currentIsLatest
                      ? 'Latest revision'
                      : `${descendants.length} newer descendant${descendants.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                <div className="lineage-history-summary">
                  <div>
                    <span>Root tune</span>
                    <strong>{rootTune?.versionLabel || rootTune?.title || metadata.id}</strong>
                    <small>{rootTune?.id}</small>
                  </div>
                  <div>
                    <span>Chain position</span>
                    <strong>{ancestors.length + 1}</strong>
                    <small>{ancestors.length ? `${ancestors.length} previous revision${ancestors.length === 1 ? '' : 's'}` : 'Root of this lineage'}</small>
                  </div>
                  <div>
                    <span>Published</span>
                    <strong>{formatHistoryDate(metadata.publishedAt)}</strong>
                    <small>New Tune ID created</small>
                  </div>
                  <div>
                    <span>Same-ID edit</span>
                    <strong>{metadata.updatedAt ? formatHistoryDate(metadata.updatedAt) : 'None recorded'}</strong>
                    <small>{metadata.updatedAt ? 'Existing Tune ID updated' : 'No later edit date'}</small>
                  </div>
                </div>

                <div className="lineage-navigation">
                  <div className="lineage-nav-side">
                    {previousRevision ? (
                      <button
                        type="button"
                        className="lineage-nav-button button-reset"
                        onClick={() => navigate(`/t/${encodeURIComponent(previousRevision.id)}/lineage`)}
                      >
                        <span>← Previous revision</span>
                        <strong>{previousRevision.versionLabel || previousRevision.title}</strong>
                      </button>
                    ) : (
                      <div className="lineage-nav-static">
                        <span>Previous revision</span>
                        <strong>Root tune</strong>
                      </div>
                    )}
                  </div>

                  <div className="lineage-current-state">
                    <span>Current Tune ID</span>
                    <strong>{metadata.versionLabel || metadata.id}</strong>
                    <small>{metadata.id}</small>
                  </div>

                  <div className="lineage-nav-side next">
                    {directChildren.length === 1 ? (
                      <button
                        type="button"
                        className="lineage-nav-button button-reset"
                        onClick={() => navigate(`/t/${encodeURIComponent(directChildren[0].id)}/lineage`)}
                      >
                        <span>Next revision →</span>
                        <strong>{directChildren[0].versionLabel || directChildren[0].title}</strong>
                      </button>
                    ) : directChildren.length > 1 ? (
                      <div className="lineage-nav-static">
                        <span>Next revisions</span>
                        <strong>{directChildren.length} branches</strong>
                      </div>
                    ) : (
                      <div className="lineage-nav-static latest">
                        <span>Next revision</span>
                        <strong>Latest</strong>
                      </div>
                    )}
                  </div>
                </div>

                {directChildren.length > 1 && (
                  <div className="lineage-next-branches">
                    {directChildren.map((child) => (
                      <button
                        type="button"
                        key={child.id}
                        className="lineage-branch-link button-reset"
                        onClick={() => navigate(`/t/${encodeURIComponent(child.id)}/lineage`)}
                      >
                        <span>{child.versionLabel || child.id}</span>
                        <strong>{child.title}</strong>
                      </button>
                    ))}
                  </div>
                )}

                <div className="lineage-chain">
                  {ancestors.map((ancestor, index) => (
                    <LineageTuneCard
                      key={ancestor.id}
                      tune={ancestor}
                      root={index === 0}
                      navigate={navigate}
                    />
                  ))}
                  <LineageTuneCard
                    tune={metadata}
                    current
                    root={ancestors.length === 0}
                    latest={currentIsLatest}
                    navigate={navigate}
                  />
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Derived tunes</p>
                    <h2>Revisions based on this tune</h2>
                  </div>
                  <span className="badge">
                    {descendants.length} derived
                  </span>
                </div>

                {descendants.length === 0 ? (
                  <div className="lineage-empty">
                    <p>No published revisions currently descend from this tune.</p>
                    <button
                      type="button"
                      className="open-button button-reset"
                      onClick={() => navigate(`/t/${encodeURIComponent(metadata.id)}/revision`)}
                    >
                      Create first revision
                    </button>
                  </div>
                ) : (
                  <div className="lineage-descendants">
                    {descendants.map(({ tune: descendant, depth }) => (
                      <LineageTuneCard
                        key={descendant.id}
                        tune={descendant}
                        depth={depth}
                        latest={!descendantParentIds.has(descendant.id)}
                        navigate={navigate}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="panel lineage-explainer">
                <div>
                  <strong>Same-ID edit</strong>
                  <span>
                    Edit Tune updates the existing Tune ID. Its original publication date remains,
                    while the latest edit is represented by <code>updatedAt</code>.
                  </span>
                </div>
                <div>
                  <strong>New revision</strong>
                  <span>
                    Create Revision publishes a new Tune ID with <code>parentTuneId</code> pointing
                    to its source. That new identity appears in this lineage history.
                  </span>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {tab === 'download' && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Downloads</p>
              <h2>Original published files</h2>
            </div>
          </div>

          <div className="download-list">
            <a className="download-card" href={publicAssetUrl(metadata.files.msq)} download>
              <span>MSQ</span>
              <strong>Download tune</strong>
              <small>{metadata.files.msq}</small>
            </a>

            {metadata.files.ini && (
              <a className="download-card" href={publicAssetUrl(metadata.files.ini)} download>
                <span>INI</span>
                <strong>Download matching definition</strong>
                <small>{metadata.files.ini}</small>
              </a>
            )}
          </div>

          <div className="mismatch tune-safety-note">
            Downloading a tune does not make it safe for another vehicle. Confirm the exact firmware
            and hardware configuration before loading it into an ECU.
          </div>
        </section>
      )}

      {tab === 'share' && (
        <section className="panel share-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Permanent link</p>
              <h2>Share this tune page</h2>
            </div>
          </div>

          <div className="share-link-row">
            <code>{window.location.href}</code>
            <button type="button" className="open-button button-reset" onClick={() => void copyShareLink()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>

          <p className="table-note">
            This link points to the published catalog entry, not to a local file from your computer.
          </p>
        </section>
      )}

      <footer>
        Published tune metadata and files are repository-backed in the GitHub prototype.
      </footer>
    </main>
  );
}
