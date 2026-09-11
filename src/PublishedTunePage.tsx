import { useEffect, useMemo, useState } from 'react';
import {
  findRegisteredDefinition,
  loadRegisteredDefinition,
} from './definitionRegistry';
import { parseIni } from './ini';
import type {
  ParsedIni,
  ParsedTune,
  PublishedTuneMetadata,
} from './model';
import { parseMsq } from './msq';
import TuneBrowser from './TuneBrowser';
import {
  findPublishedTune,
  loadPublishedText,
  publicAssetUrl,
} from './tuneLibrary';

type PublishedTunePageProps = {
  id: string;
  tab: 'info' | 'tune' | 'download' | 'share';
  navigate: (path: string) => void;
};

function InfoCell({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value === undefined || value === null || value === '') return null;

  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
    if (tab !== 'tune' || !metadata || tune || assetLoading || assetError) return;

    let active = true;
    setAssetLoading(true);
    setAssetError('');

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
  }, [assetError, assetLoading, metadata, tab, tune]);

  const vehicleLabel = useMemo(() => {
    if (!metadata) return '';
    return [
      metadata.vehicle?.year,
      metadata.vehicle?.make,
      metadata.vehicle?.model,
      metadata.vehicle?.trim,
    ].filter(Boolean).join(' ');
  }, [metadata]);

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
            <span className="badge">{metadata.classification}</span>
            <span className="badge badge-ok">{metadata.validationStatus}</span>
            {metadata.versionLabel && <span className="badge">{metadata.versionLabel}</span>}
          </div>
        </div>
        <div className="published-owner">
          <span>Published by</span>
          <strong>{metadata.author}</strong>
          <span>{metadata.publishedAt}</span>
        </div>
      </header>

      <nav className="published-tabs" aria-label="Published tune views">
        {(['info', 'tune', 'download', 'share'] as const).map((candidate) => (
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
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Tune information</p>
                <h2>Vehicle and engine</h2>
              </div>
            </div>

            <div className="details-grid">
              <InfoCell label="Vehicle" value={vehicleLabel} />
              <InfoCell label="Engine make" value={metadata.engine?.make} />
              <InfoCell label="Engine code" value={metadata.engine?.code} />
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
              <InfoCell label="ECU target" value={metadata.ecuTarget} />
              <InfoCell label="Firmware signature" value={metadata.firmwareSignature} />
              <InfoCell label="Validation" value={metadata.validationStatus} />
              <InfoCell label="Classification" value={metadata.classification} />
            </div>
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
