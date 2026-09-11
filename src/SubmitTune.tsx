import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import { findRegisteredDefinition, type DefinitionRegistryEntry } from './definitionRegistry';
import { parseIni } from './ini';
import {
  tuneClassifications,
  validationStatuses,
  type ParsedIni,
  type ParsedTune,
  type PublishedTuneMetadata,
  type TuneClassification,
  type ValidationStatus,
} from './model';
import { parseMsq } from './msq';
import { loadTuneIndex } from './tuneLibrary';

type SubmitTuneProps = {
  navigate: (path: string) => void;
};

type FormState = {
  id: string;
  title: string;
  summary: string;
  author: string;
  ecuTarget: string;
  validationStatus: '' | ValidationStatus;
  classification: '' | TuneClassification;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleTrim: string;
  engineMake: string;
  engineCode: string;
  displacementLiters: string;
  cylinders: string;
  aspiration: string;
  compressionRatio: string;
  fuel: string;
  ignition: string;
  injectorCc: string;
  powerHp: string;
  stockPowerHp: string;
  torqueNm: string;
  boostBar: string;
  tags: string;
  notes: string;
  versionLabel: string;
  parentTuneId: string;
};

const initialForm: FormState = {
  id: '',
  title: '',
  summary: '',
  author: '',
  ecuTarget: '',
  validationStatus: '',
  classification: '',
  vehicleMake: '',
  vehicleModel: '',
  vehicleYear: '',
  vehicleTrim: '',
  engineMake: '',
  engineCode: '',
  displacementLiters: '',
  cylinders: '',
  aspiration: '',
  compressionRatio: '',
  fuel: '',
  ignition: '',
  injectorCc: '',
  powerHp: '',
  stockPowerHp: '',
  torqueNm: '',
  boostBar: '',
  tags: '',
  notes: '',
  versionLabel: '',
  parentTuneId: '',
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function inferEcuTarget(signature: string): string {
  const mega = signature.match(/\b(MEGA[0-9A-Z_-]+)\b/i);
  if (mega) return mega[1].toUpperCase();

  const parts = signature.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] ?? '')) {
    return parts[parts.length - 2] ?? '';
  }

  return '';
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ''),
  ) as T;
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = 'text',
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'number';
  step?: string;
}) {
  return (
    <label className="submit-field">
      <span>{label}{required && <em> required</em>}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export default function SubmitTune({ navigate }: SubmitTuneProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [idTouched, setIdTouched] = useState(false);
  const [msqFile, setMsqFile] = useState<File | null>(null);
  const [msqText, setMsqText] = useState('');
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [iniFile, setIniFile] = useState<File | null>(null);
  const [iniText, setIniText] = useState('');
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [fileError, setFileError] = useState('');
  const [registryEntry, setRegistryEntry] = useState<DefinitionRegistryEntry | null>(null);
  const [registryStatus, setRegistryStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [catalogError, setCatalogError] = useState('');
  const [packaging, setPackaging] = useState(false);
  const [packageError, setPackageError] = useState('');

  useEffect(() => {
    let active = true;
    loadTuneIndex()
      .then((index) => {
        if (!active) return;
        setExistingIds(new Set(index.tunes.map((entry) => entry.id)));
      })
      .catch((caught) => {
        if (!active) return;
        setCatalogError(
          caught instanceof Error ? caught.message : 'Unable to check existing tune IDs.',
        );
      });

    return () => {
      active = false;
    };
  }, []);

  const signatureMatch = Boolean(
    tune && ini && tune.details.signature && tune.details.signature === ini.signature,
  );
  const definitionReady = Boolean(
    tune
    && (
      signatureMatch
      || (registryStatus === 'found' && registryEntry?.signature === tune.details.signature)
    ),
  );

  const metadata = useMemo<PublishedTuneMetadata | null>(() => {
    if (!tune || !form.validationStatus || !form.classification) return null;

    const vehicle = compactObject({
      make: form.vehicleMake.trim() || undefined,
      model: form.vehicleModel.trim() || undefined,
      year: optionalInteger(form.vehicleYear),
      trim: form.vehicleTrim.trim() || undefined,
    });
    const engine = compactObject({
      make: form.engineMake.trim() || undefined,
      code: form.engineCode.trim() || undefined,
      displacementLiters: optionalNumber(form.displacementLiters),
      cylinders: optionalInteger(form.cylinders),
      aspiration: form.aspiration.trim() || undefined,
      compressionRatio: optionalNumber(form.compressionRatio),
    });

    return compactObject({
      id: form.id.trim(),
      title: form.title.trim(),
      summary: form.summary.trim() || undefined,
      author: form.author.trim(),
      publishedAt: new Date().toISOString().slice(0, 10),
      ecuTarget: form.ecuTarget.trim(),
      firmwareSignature: tune.details.signature,
      validationStatus: form.validationStatus,
      classification: form.classification,
      vehicle: Object.keys(vehicle).length ? vehicle : undefined,
      engine: Object.keys(engine).length ? engine : undefined,
      fuel: form.fuel.trim() || undefined,
      ignition: form.ignition.trim() || undefined,
      injectorCc: optionalNumber(form.injectorCc),
      powerHp: optionalNumber(form.powerHp),
      stockPowerHp: optionalNumber(form.stockPowerHp),
      torqueNm: optionalNumber(form.torqueNm),
      boostBar: optionalNumber(form.boostBar),
      tags: [...new Set(
        form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      )],
      notes: form.notes.trim() || undefined,
      versionLabel: form.versionLabel.trim() || undefined,
      parentTuneId: form.parentTuneId.trim() || undefined,
      files: {
        msq: 'tune.msq',
        ...(iniFile ? { ini: 'mainController.ini' } : {}),
      },
    }) as PublishedTuneMetadata;
  }, [form, iniFile, tune]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!msqFile || !tune) errors.push('Load a valid EpicEFI MSQ.');
    if (!definitionReady) errors.push('Provide an exact matching firmware definition.');
    if (!form.title.trim()) errors.push('Title is required.');
    if (!form.id.trim()) {
      errors.push('Tune ID is required.');
    } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(form.id.trim())) {
      errors.push('Tune ID may contain lowercase letters, digits, ".", "_" and "-" only.');
    } else if (existingIds.has(form.id.trim())) {
      errors.push('Tune ID already exists in the public catalog.');
    }
    if (!form.author.trim()) errors.push('Author is required.');
    if (!form.ecuTarget.trim()) errors.push('ECU target is required.');
    if (!form.validationStatus) errors.push('Select a validation badge.');
    if (!form.classification) errors.push('Select a tune classification.');
    if (
      form.parentTuneId.trim()
      && !existingIds.has(form.parentTuneId.trim())
    ) {
      errors.push('Parent tune ID must already exist in the public catalog.');
    }
    return errors;
  }, [definitionReady, existingIds, form, msqFile, tune]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadMsq(file: File | undefined) {
    if (!file) return;

    setFileError('');
    setPackageError('');
    setRegistryEntry(null);
    setRegistryStatus('idle');
    setIniFile(null);
    setIniText('');
    setIni(null);

    try {
      const raw = await file.text();
      const parsed = parseMsq(raw);
      if (!parsed.details.signature) {
        throw new Error('MSQ has no firmware signature.');
      }

      setMsqFile(file);
      setMsqText(raw);
      setTune(parsed);

      const inferredTarget = inferEcuTarget(parsed.details.signature);
      if (inferredTarget) {
        setForm((current) => ({
          ...current,
          ecuTarget: current.ecuTarget || inferredTarget,
        }));
      }

      setRegistryStatus('checking');
      try {
        const entry = await findRegisteredDefinition(parsed.details.signature);
        setRegistryEntry(entry);
        setRegistryStatus(entry ? 'found' : 'missing');
        if (entry?.ecuTarget) {
          setForm((current) => ({
            ...current,
            ecuTarget: current.ecuTarget || entry.ecuTarget,
          }));
        }
      } catch {
        setRegistryStatus('missing');
      }
    } catch (caught) {
      setMsqFile(null);
      setMsqText('');
      setTune(null);
      setFileError(caught instanceof Error ? caught.message : 'Unable to parse this MSQ.');
    }
  }

  async function loadIni(file: File | undefined) {
    if (!file) return;

    setFileError('');
    setPackageError('');

    try {
      const raw = await file.text();
      const parsed = parseIni(raw);
      setIniFile(file);
      setIniText(raw);
      setIni(parsed);
    } catch (caught) {
      setIniFile(null);
      setIniText('');
      setIni(null);
      setFileError(caught instanceof Error ? caught.message : 'Unable to parse this INI.');
    }
  }

  async function createPackage() {
    if (!metadata || validationErrors.length || !msqFile || !tune) return;

    setPackaging(true);
    setPackageError('');

    try {
      const zip = new JSZip();
      const folder = zip.folder(metadata.id);
      if (!folder) throw new Error('Unable to create submission folder.');

      const packageMetadata: PublishedTuneMetadata = {
        ...metadata,
        files: {
          msq: 'tune.msq',
          ...(iniFile ? { ini: 'mainController.ini' } : {}),
        },
      };

      folder.file('metadata.json', JSON.stringify(packageMetadata, null, 2) + '\n');
      folder.file('tune.msq', msqText);
      if (iniFile) folder.file('mainController.ini', iniText);

      folder.file(
        'SUBMISSION.txt',
        [
          'EpicEFI Tune Viewer GitHub prototype submission',
          '',
          `Tune ID: ${metadata.id}`,
          `Firmware signature: ${metadata.firmwareSignature}`,
          '',
          'To publish during the GitHub prototype phase:',
          `1. Add this folder under public/tunes/${metadata.id}/ in the repository.`,
          '2. Open a pull request.',
          '3. GitHub Actions validates metadata/file references and regenerates the public Tune Hub index.',
          '4. Do not edit public/tunes/index.json manually.',
          '',
          'The tune remains reference material. Validation/classification badges describe the submission',
          'and do not guarantee that it is safe for a different vehicle or engine.',
        ].join('\n'),
      );

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      downloadBlob(blob, `${metadata.id}-epicefi-tune-submission.zip`);
    } catch (caught) {
      setPackageError(
        caught instanceof Error ? caught.message : 'Unable to create submission package.',
      );
    } finally {
      setPackaging(false);
    }
  }

  return (
    <main>
      <header className="hub-hero submit-hero">
        <div>
          <p className="eyebrow">EpicEFI Tune Hub</p>
          <h1>Prepare tune submission</h1>
          <p className="lede">
            Validate an EpicEFI MSQ against its exact firmware definition, add public metadata, and
            create a repository-ready submission package. Nothing is uploaded from this page.
          </p>
        </div>
        <button type="button" className="open-button secondary button-reset" onClick={() => navigate('/')}>
          Back to Tune Hub
        </button>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Tune and firmware definition</h2>
          </div>
          <span className={`badge ${definitionReady ? 'badge-ok' : ''}`}>
            {definitionReady ? 'Exact definition ready' : 'Definition required'}
          </span>
        </div>

        <div className="submit-file-grid">
          <label className="submit-file-card">
            <span>MSQ · required</span>
            <strong>{msqFile?.name || 'Choose EpicEFI tune'}</strong>
            <input
              type="file"
              accept=".msq,.xml,text/xml,application/xml"
              onChange={(event) => void loadMsq(event.target.files?.[0])}
            />
          </label>

          <label className="submit-file-card">
            <span>mainController.ini · {registryStatus === 'found' ? 'optional' : 'required'}</span>
            <strong>{iniFile?.name || 'Choose matching INI'}</strong>
            <input
              type="file"
              accept=".ini,text/plain"
              onChange={(event) => void loadIni(event.target.files?.[0])}
            />
          </label>
        </div>

        {fileError && <div className="mismatch">{fileError}</div>}

        {tune && (
          <div className="details-grid submit-signature-grid">
            <div className="detail">
              <span>MSQ signature</span>
              <strong>{tune.details.signature}</strong>
            </div>
            <div className="detail">
              <span>Registry</span>
              <strong>
                {registryStatus === 'checking'
                  ? 'Checking exact signature…'
                  : registryStatus === 'found'
                    ? 'Exact definition available'
                    : 'No exact public definition'}
              </strong>
            </div>
            <div className="detail">
              <span>Local INI</span>
              <strong>
                {!ini
                  ? 'Not loaded'
                  : signatureMatch
                    ? 'Exact signature match'
                    : 'Signature mismatch'}
              </strong>
            </div>
          </div>
        )}

        {tune && ini && !signatureMatch && (
          <div className="mismatch">
            MSQ signature <code>{tune.details.signature}</code> does not match INI signature{' '}
            <code>{ini.signature}</code>. Submission packaging is blocked.
          </div>
        )}

        {tune && registryStatus === 'missing' && !ini && (
          <div className="mismatch">
            This firmware is not in the public definition registry. Load its exact matching{' '}
            <code>mainController.ini</code> to continue.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Public tune identity and badges</h2>
          </div>
        </div>

        <div className="submit-grid two">
          <TextField
            label="Title"
            required
            value={form.title}
            onChange={(value) => {
              update('title', value);
              if (!idTouched) update('id', slugify(value));
            }}
            placeholder="Volvo B230FK 13T road tune"
          />
          <TextField
            label="Tune ID"
            required
            value={form.id}
            onChange={(value) => {
              setIdTouched(true);
              update('id', slugify(value));
            }}
            placeholder="volvo-b230fk-13t-road"
          />
          <TextField
            label="Author / uploader"
            required
            value={form.author}
            onChange={(value) => update('author', value)}
          />
          <TextField
            label="ECU target"
            required
            value={form.ecuTarget}
            onChange={(value) => update('ecuTarget', value)}
            placeholder="MEGA144H7"
          />

          <label className="submit-field">
            <span>Validation badge <em>required</em></span>
            <select
              value={form.validationStatus}
              onChange={(event) => update('validationStatus', event.target.value as FormState['validationStatus'])}
            >
              <option value="">Select validation…</option>
              {validationStatuses
                .filter((status) => status !== 'EpicEFI Verified')
                .map((status) => <option key={status}>{status}</option>)}
            </select>
            <small>EpicEFI Verified cannot be self-assigned.</small>
          </label>

          <label className="submit-field">
            <span>Classification <em>required</em></span>
            <select
              value={form.classification}
              onChange={(event) => update('classification', event.target.value as FormState['classification'])}
            >
              <option value="">Select classification…</option>
              {tuneClassifications.map((classification) => (
                <option key={classification}>{classification}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="submit-field full">
          <span>Summary</span>
          <textarea
            value={form.summary}
            onChange={(event) => update('summary', event.target.value)}
            placeholder="Short description shown in Tune Hub search results."
            rows={3}
          />
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>Vehicle and engine</h2>
          </div>
        </div>

        <div className="submit-grid four">
          <TextField label="Vehicle make" value={form.vehicleMake} onChange={(value) => update('vehicleMake', value)} />
          <TextField label="Vehicle model" value={form.vehicleModel} onChange={(value) => update('vehicleModel', value)} />
          <TextField label="Model year" type="number" value={form.vehicleYear} onChange={(value) => update('vehicleYear', value)} />
          <TextField label="Trim / variant" value={form.vehicleTrim} onChange={(value) => update('vehicleTrim', value)} />

          <TextField label="Engine make" value={form.engineMake} onChange={(value) => update('engineMake', value)} />
          <TextField label="Engine code" value={form.engineCode} onChange={(value) => update('engineCode', value)} />
          <TextField label="Displacement (L)" type="number" step="0.01" value={form.displacementLiters} onChange={(value) => update('displacementLiters', value)} />
          <TextField label="Cylinders" type="number" value={form.cylinders} onChange={(value) => update('cylinders', value)} />

          <TextField label="Aspiration" value={form.aspiration} onChange={(value) => update('aspiration', value)} placeholder="Turbo / NA / Supercharged" />
          <TextField label="Compression ratio" type="number" step="0.01" value={form.compressionRatio} onChange={(value) => update('compressionRatio', value)} />
          <TextField label="Fuel" value={form.fuel} onChange={(value) => update('fuel', value)} placeholder="95 RON E10 / E85 / ..." />
          <TextField label="Ignition" value={form.ignition} onChange={(value) => update('ignition', value)} placeholder="Sequential / wasted spark / ..." />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 4</p>
            <h2>Calibration summary</h2>
          </div>
        </div>

        <div className="submit-grid four">
          <TextField label="Injector flow (cc/min)" type="number" value={form.injectorCc} onChange={(value) => update('injectorCc', value)} />
          <TextField label="Power (hp)" type="number" value={form.powerHp} onChange={(value) => update('powerHp', value)} />
          <TextField label="Stock power (hp)" type="number" value={form.stockPowerHp} onChange={(value) => update('stockPowerHp', value)} />
          <TextField label="Torque (Nm)" type="number" value={form.torqueNm} onChange={(value) => update('torqueNm', value)} />
          <TextField label="Boost (bar)" type="number" step="0.01" value={form.boostBar} onChange={(value) => update('boostBar', value)} />
          <TextField label="Version label" value={form.versionLabel} onChange={(value) => update('versionLabel', value)} placeholder="v1 / 2026-09 / ..." />
          <TextField label="Parent tune ID" value={form.parentTuneId} onChange={(value) => update('parentTuneId', slugify(value))} placeholder="Optional lineage parent" />
          <TextField label="Tags" value={form.tags} onChange={(value) => update('tags', value)} placeholder="turbo, road, 13t, flex-fuel" />
        </div>

        <label className="submit-field full">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            placeholder="Hardware, known limitations, test conditions, special configuration, or anything another user should know."
            rows={6}
          />
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 5</p>
            <h2>Review and create package</h2>
          </div>
          <span className={`badge ${validationErrors.length === 0 ? 'badge-ok' : ''}`}>
            {validationErrors.length === 0 ? 'Ready to package' : `${validationErrors.length} item(s) required`}
          </span>
        </div>

        {catalogError && (
          <div className="mismatch">
            Public catalog check failed: {catalogError}. Packaging can still be reviewed, but duplicate-ID
            detection may be incomplete until the catalog is reachable.
          </div>
        )}

        {validationErrors.length > 0 && (
          <ul className="submit-errors">
            {validationErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}

        {metadata && (
          <>
            <div className="submission-preview">
              <div>
                <span>Public title</span>
                <strong>{metadata.title || '—'}</strong>
              </div>
              <div>
                <span>Firmware</span>
                <strong>{metadata.ecuTarget || '—'}</strong>
              </div>
              <div>
                <span>Validation</span>
                <strong>{metadata.validationStatus}</strong>
              </div>
              <div>
                <span>Classification</span>
                <strong>{metadata.classification}</strong>
              </div>
              <div className="submission-preview-wide">
                <span>Signature</span>
                <strong>{metadata.firmwareSignature}</strong>
              </div>
            </div>

            <details className="metadata-preview">
              <summary>Preview metadata.json</summary>
              <pre>{JSON.stringify(metadata, null, 2)}</pre>
            </details>
          </>
        )}

        {packageError && <div className="mismatch">{packageError}</div>}

        <div className="submission-actions">
          <button
            type="button"
            className="open-button button-reset"
            disabled={validationErrors.length > 0 || packaging}
            onClick={() => void createPackage()}
          >
            {packaging ? 'Creating package…' : 'Download submission ZIP'}
          </button>
          <a
            className="open-button secondary"
            href="https://github.com/PJawZK/PJawZK-EpicEFI-Tune-Viewer/tree/main/public/tunes"
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub tune catalog
          </a>
        </div>

        <p className="table-note">
          The ZIP contains one folder ready for <code>public/tunes/&lt;tune-id&gt;/</code>. GitHub
          Actions performs the repository-side validation and generates the public index after a pull request.
        </p>
      </section>

      <footer>
        Submission builder — local files are parsed and packaged in your browser. Nothing is uploaded automatically.
      </footer>
    </main>
  );
}
