import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import {
  findRegisteredDefinition,
  loadDefinitionRegistry,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
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
import {
  submitTuneToGitHub,
  type GitHubSubmissionProgress,
  type GitHubSubmissionResult,
} from './githubSubmission';
import SelectMenu from './SelectMenu';
import { mergeEcuTargets } from './ecuTargets';

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

const aspirationOptions = [
  'Naturally Aspirated',
  'Turbocharged',
  'Supercharged',
  'Twincharged',
  'Forced induction (unspecified)',
  'Other',
] as const;

const fuelOptions = [
  'Gasoline / Petrol (unspecified)',
  'E0',
  'E5',
  'E10',
  'E15',
  'E20',
  'E30',
  'E40',
  'E50',
  'E60',
  'E70',
  'E85',
  'E100',
  'Flex fuel',
  'Methanol',
  'M85',
  'LPG',
  'CNG',
  'Race gasoline',
  'Other / Custom',
] as const;

const fallbackIgnitionOptions = [
  'Single Coil',
  'Individual Coils',
  'Wasted Spark',
  'Two Distributors',
] as const;

const MAX_RAW_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_BYTES = 128 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function githubProgressLabel(
  progress: GitHubSubmissionProgress | '',
  detail: string,
): string {
  const labels: Record<GitHubSubmissionProgress, string> = {
    authenticating: 'Authenticating with GitHub',
    'checking-main': 'Checking main and tune ID',
    'uploading-files': 'Uploading tune files',
    'publishing-main': 'Publishing tune metadata to main',
  };

  return progress ? `${labels[progress]}${detail ? ` · ${detail}` : ''}` : '';
}

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

function tuneValue(tune: ParsedTune, name: string): string {
  return tune.constants.find((constant) => constant.name === name)?.value.trim() ?? '';
}

function parseBooleanish(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['false', '0', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

function configuredFuelLabel(tune: ParsedTune): string {
  const ethanolRaw = tuneValue(tune, 'defaultEthanolContent');
  const ethanol = Number(ethanolRaw);
  if (!Number.isFinite(ethanol) || ethanol < 0 || ethanol > 100) return '';

  const rounded = Number.isInteger(ethanol) ? ethanol.toFixed(0) : ethanol.toFixed(1);
  const flex = parseBooleanish(tuneValue(tune, 'flexEnabled'));
  return flex === true ? `Flex fuel (fallback E${rounded})` : `E${rounded}`;
}

function configuredAspiration(tune: ParsedTune): string {
  const forced = parseBooleanish(tuneValue(tune, 'isForcedInduction'));
  if (forced === false) return 'Naturally Aspirated';
  if (forced === true) return 'Forced induction (unspecified)';
  return '';
}

function injectorFlowCc(tune: ParsedTune): string {
  const unit = tuneValue(tune, 'injectorFlowAsMassFlow').toLowerCase();
  const massFlow = ['grams per second', 'g/s', 'true', '1'].includes(unit);
  if (massFlow) return '';

  const flow = Number(tuneValue(tune, 'injector_flow'));
  return Number.isFinite(flow) && flow > 0 ? String(flow) : '';
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
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [iniFile, setIniFile] = useState<File | null>(null);
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [fileError, setFileError] = useState('');
  const [registryEntry, setRegistryEntry] = useState<DefinitionRegistryEntry | null>(null);
  const [registryStatus, setRegistryStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [registryTargets, setRegistryTargets] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [packaging, setPackaging] = useState(false);
  const [packageError, setPackageError] = useState('');
  const [packageStats, setPackageStats] = useState<{ raw: number; zip: number } | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<string[]>([]);
  const [githubToken, setGitHubToken] = useState('');
  const [githubSubmitting, setGitHubSubmitting] = useState(false);
  const [githubProgress, setGitHubProgress] = useState<GitHubSubmissionProgress | ''>('');
  const [githubProgressDetail, setGitHubProgressDetail] = useState('');
  const [githubError, setGitHubError] = useState('');
  const [githubResult, setGitHubResult] = useState<GitHubSubmissionResult | null>(null);

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

    loadDefinitionRegistry()
      .then((registry) => {
        if (!active) return;
        setRegistryTargets([
          ...new Set(
            registry.definitions
              .map((entry) => entry.ecuTarget?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        ]);
      })
      .catch(() => {
        // The built-in supported target list remains available if the registry is unreachable.
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
  const shouldIncludeIni = Boolean(
    registryStatus !== 'found'
    && iniFile
    && signatureMatch,
  );

  const modelYearOptions = useMemo(() => {
    const newest = new Date().getFullYear() + 1;
    return Array.from({ length: newest - 1899 }, (_, index) => String(newest - index));
  }, []);

  const ecuTargetOptions = useMemo(
    () => mergeEcuTargets(
      form.ecuTarget,
      inferEcuTarget(tune?.details.signature ?? ''),
      ...registryTargets,
    ),
    [form.ecuTarget, registryTargets, tune],
  );

  const selectableFuelOptions = useMemo(() => {
    const options = [...fuelOptions] as string[];
    const current = form.fuel.trim();
    if (current && !options.includes(current)) options.unshift(current);
    return options;
  }, [form.fuel]);

  const selectableIgnitionOptions = useMemo(() => {
    const fromIni = ini?.constants
      .find((definition) => definition.name === 'ignitionMode')
      ?.options
      .map((option) => option.trim())
      .filter((option) => option && option.toUpperCase() !== 'INVALID') ?? [];

    const options = fromIni.length
      ? [...new Set(fromIni)]
      : [...fallbackIgnitionOptions];

    const current = form.ignition.trim();
    if (current && !options.includes(current)) options.unshift(current);
    return options;
  }, [form.ignition, ini]);

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
        ...(shouldIncludeIni ? { ini: 'mainController.ini' } : {}),
      },
    }) as PublishedTuneMetadata;
  }, [form, shouldIncludeIni, tune]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!msqFile || !tune) errors.push('Load a valid EpicEFI MSQ.');
    if (!definitionReady) errors.push('Provide an exact matching firmware definition.');
    if (ini && !signatureMatch) {
      errors.push('The selected local INI does not match the MSQ firmware signature.');
    }
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
  }, [definitionReady, existingIds, form, ini, msqFile, signatureMatch, tune]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadMsq(file: File | undefined) {
    if (!file) return;

    setFileError('');
    setPackageError('');
    setPackageStats(null);
    setGitHubError('');
    setGitHubResult(null);
    setRegistryEntry(null);
    setRegistryStatus('idle');
    setIniFile(null);
    setIni(null);

    try {
      const raw = await file.text();
      const parsed = parseMsq(raw);
      if (!parsed.details.signature) {
        throw new Error('MSQ has no firmware signature.');
      }

      setMsqFile(file);
      setTune(parsed);

      const inferredTarget = inferEcuTarget(parsed.details.signature);
      const candidates: Array<[keyof FormState, string, string]> = [
        ['summary', parsed.details.tuneComment.trim(), 'Summary'],
        ['ecuTarget', inferredTarget, 'ECU target'],
        ['displacementLiters', tuneValue(parsed, 'displacement'), 'Displacement'],
        ['cylinders', tuneValue(parsed, 'cylindersCount'), 'Cylinders'],
        ['compressionRatio', tuneValue(parsed, 'compressionRatio'), 'Compression ratio'],
        ['aspiration', configuredAspiration(parsed), 'Aspiration'],
        ['fuel', configuredFuelLabel(parsed), 'Fuel'],
        ['ignition', tuneValue(parsed, 'ignitionMode'), 'Ignition mode'],
        ['injectorCc', injectorFlowCc(parsed), 'Injector flow'],
      ];

      const filled: string[] = [];
      setForm((current) => {
        const next = { ...current };

        for (const [key, value, label] of candidates) {
          if (!value || String(next[key]).trim()) continue;
          next[key] = value as never;
          filled.push(label);
        }

        return next;
      });
      setAutoFilledFields(filled);

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
      setTune(null);
      setFileError(caught instanceof Error ? caught.message : 'Unable to parse this MSQ.');
    }
  }

  async function loadIni(file: File | undefined) {
    if (!file) return;

    setFileError('');
    setPackageError('');
    setPackageStats(null);
    setGitHubError('');
    setGitHubResult(null);

    try {
      const raw = await file.text();
      const parsed = parseIni(raw);
      setIniFile(file);
      setIni(parsed);
    } catch (caught) {
      setIniFile(null);
      setIni(null);
      setFileError(caught instanceof Error ? caught.message : 'Unable to parse this INI.');
    }
  }

  function submissionText(metadata: PublishedTuneMetadata): string {
    return [
      'EpicEFI Tune Viewer GitHub prototype submission',
      '',
      `Tune ID: ${metadata.id}`,
      `Firmware signature: ${metadata.firmwareSignature}`,
      '',
      'To publish during the GitHub prototype phase:',
      `1. Add this folder under public/tunes/${metadata.id}/ in the repository.`,
      '2. Open a pull request.',
      '3. GitHub Actions validates the submission and regenerates the public Tune Hub index.',
      '4. Do not edit public/tunes/index.json manually.',
      '',
      'The tune remains reference material. Validation/classification badges describe the submission',
      'and do not guarantee that it is safe for a different vehicle or engine.',
    ].join('\n');
  }

  function packageMetadata(metadata: PublishedTuneMetadata): PublishedTuneMetadata {
    return {
      ...metadata,
      files: {
        msq: 'tune.msq',
        ...(shouldIncludeIni ? { ini: 'mainController.ini' } : {}),
      },
    };
  }

  async function createPackage() {
    if (!metadata || validationErrors.length || !msqFile || !tune) return;

    setPackaging(true);
    setPackageError('');
    setPackageStats(null);

    try {
      const finalMetadata = packageMetadata(metadata);
      const metadataBlob = new Blob(
        [JSON.stringify(finalMetadata, null, 2) + '\n'],
        { type: 'application/json' },
      );
      const instructionsBlob = new Blob(
        [submissionText(finalMetadata)],
        { type: 'text/plain' },
      );

      const rawBytes =
        metadataBlob.size
        + instructionsBlob.size
        + msqFile.size
        + (shouldIncludeIni && iniFile ? iniFile.size : 0);

      if (rawBytes > MAX_RAW_PACKAGE_BYTES) {
        throw new Error(
          `Submission inputs total ${formatBytes(rawBytes)}, above the `
          + `${formatBytes(MAX_RAW_PACKAGE_BYTES)} browser packaging limit.`,
        );
      }

      const zip = new JSZip();
      const folder = zip.folder(finalMetadata.id);
      if (!folder) throw new Error('Unable to create submission folder.');

      folder.file('metadata.json', metadataBlob);
      folder.file('tune.msq', msqFile);
      if (shouldIncludeIni && iniFile) {
        folder.file('mainController.ini', iniFile);
      }
      folder.file('SUBMISSION.txt', instructionsBlob);

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const expansionLimit = Math.max(
        16 * 1024 * 1024,
        rawBytes * 4 + 2 * 1024 * 1024,
      );

      if (blob.size > MAX_ZIP_BYTES || blob.size > expansionLimit) {
        throw new Error(
          `Generated ZIP is unexpectedly large (${formatBytes(blob.size)}) from `
          + `${formatBytes(rawBytes)} of input. Download was blocked instead of producing `
          + 'a potentially corrupt archive.',
        );
      }

      setPackageStats({ raw: rawBytes, zip: blob.size });
      downloadBlob(blob, `${finalMetadata.id}-epicefi-tune-submission.zip`);
    } catch (caught) {
      setPackageError(
        caught instanceof Error ? caught.message : 'Unable to create submission package.',
      );
    } finally {
      setPackaging(false);
    }
  }

  async function submitToGitHub() {
    if (!metadata || validationErrors.length || !msqFile || !tune) return;

    setGitHubSubmitting(true);
    setGitHubError('');
    setGitHubResult(null);
    setGitHubProgress('');
    setGitHubProgressDetail('');

    try {
      const finalMetadata = packageMetadata(metadata);
      const basePath = `public/tunes/${finalMetadata.id}`;
      const files = [
        {
          path: `${basePath}/metadata.json`,
          blob: new Blob(
            [JSON.stringify(finalMetadata, null, 2) + '\n'],
            { type: 'application/json' },
          ),
        },
        {
          path: `${basePath}/tune.msq`,
          blob: msqFile,
        },
      ];

      if (shouldIncludeIni && iniFile) {
        files.push({
          path: `${basePath}/mainController.ini`,
          blob: iniFile,
        });
      }

      const rawBytes = files.reduce((sum, entry) => sum + entry.blob.size, 0);
      if (rawBytes > MAX_RAW_PACKAGE_BYTES) {
        throw new Error(
          `GitHub submission inputs total ${formatBytes(rawBytes)}, above the `
          + `${formatBytes(MAX_RAW_PACKAGE_BYTES)} browser upload limit.`,
        );
      }

      const result = await submitTuneToGitHub({
        token: githubToken,
        tuneId: finalMetadata.id,
        title: finalMetadata.title,
        firmwareSignature: finalMetadata.firmwareSignature,
        files,
        onProgress: (progress, detail = '') => {
          setGitHubProgress(progress);
          setGitHubProgressDetail(detail);
        },
      });

      setGitHubResult(result);
      setGitHubProgress('');
      setGitHubProgressDetail('');
    } catch (caught) {
      setGitHubError(
        caught instanceof Error ? caught.message : 'Unable to submit this tune to GitHub.',
      );
    } finally {
      setGitHubSubmitting(false);
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
            publish it directly to the Tune Hub repository when you explicitly choose Upload to main.
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

        {autoFilledFields.length > 0 && (
          <div className="autofill-note">
            <strong>Auto-filled from MSQ:</strong>
            <span>{autoFilledFields.join(' · ')}</span>
            <small>Only previously empty fields were filled; every value can still be edited.</small>
          </div>
        )}

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

        {tune && registryStatus === 'found' && iniFile && signatureMatch && (
          <div className="autofill-note">
            <strong>Public definition available:</strong>
            <span>The selected INI is used for local metadata choices but will not be duplicated in the tune package.</span>
            <small>The published tune references the exact registered firmware signature instead.</small>
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
          <div className="submit-field">
            <label>ECU target <em>required</em></label>
            <SelectMenu
              value={form.ecuTarget}
              onChange={(value) => update('ecuTarget', value)}
              placeholder="Select supported ECU…"
              ariaLabel="ECU target"
              options={ecuTargetOptions}
            />
            <small>Supported EpicEFI targets are listed, registered definition targets are merged in automatically, and the exact target detected from the loaded MSQ is added if needed.</small>
          </div>

          <div className="submit-field">
            <label htmlFor="submit-validation">Validation badge <em>required</em></label>
            <SelectMenu
              id="submit-validation"
              value={form.validationStatus}
              onChange={(value) => update('validationStatus', value as FormState['validationStatus'])}
              placeholder="Select validation…"
              ariaLabel="Validation badge"
              options={validationStatuses
                .filter((status) => status !== 'EpicEFI Verified')
                .map((status) => ({ value: status }))}
            />
            <small>EpicEFI Verified cannot be self-assigned.</small>
          </div>

          <div className="submit-field">
            <label htmlFor="submit-classification">Classification <em>required</em></label>
            <SelectMenu
              id="submit-classification"
              value={form.classification}
              onChange={(value) => update('classification', value as FormState['classification'])}
              placeholder="Select classification…"
              ariaLabel="Tune classification"
              options={tuneClassifications.map((classification) => ({ value: classification }))}
            />
          </div>
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
          <div className="submit-field">
            <label htmlFor="submit-model-year">Model year</label>
            <SelectMenu
              id="submit-model-year"
              value={form.vehicleYear}
              onChange={(value) => update('vehicleYear', value)}
              placeholder="Not specified"
              ariaLabel="Model year"
              options={modelYearOptions.map((year) => ({ value: year }))}
            />
          </div>
          <TextField label="Trim / variant" value={form.vehicleTrim} onChange={(value) => update('vehicleTrim', value)} />

          <TextField label="Engine make" value={form.engineMake} onChange={(value) => update('engineMake', value)} />
          <TextField label="Engine code" value={form.engineCode} onChange={(value) => update('engineCode', value)} />
          <TextField label="Displacement (L)" type="number" step="0.01" value={form.displacementLiters} onChange={(value) => update('displacementLiters', value)} />
          <TextField label="Cylinders" type="number" value={form.cylinders} onChange={(value) => update('cylinders', value)} />

          <div className="submit-field">
            <label htmlFor="submit-aspiration">Aspiration</label>
            <SelectMenu
              id="submit-aspiration"
              value={form.aspiration}
              onChange={(value) => update('aspiration', value)}
              placeholder="Select aspiration…"
              ariaLabel="Aspiration"
              options={aspirationOptions.map((option) => ({ value: option }))}
            />
            {form.aspiration === 'Forced induction (unspecified)' && (
              <small>EpicEFI reports forced induction but does not distinguish turbo from supercharger here.</small>
            )}
          </div>
          <TextField label="Compression ratio" type="number" step="0.01" value={form.compressionRatio} onChange={(value) => update('compressionRatio', value)} />
          <div className="submit-field">
            <label htmlFor="submit-fuel">Fuel</label>
            <SelectMenu
              id="submit-fuel"
              value={form.fuel}
              onChange={(value) => update('fuel', value)}
              placeholder="Select fuel…"
              ariaLabel="Fuel"
              options={selectableFuelOptions.map((option) => ({ value: option }))}
            />
            {form.fuel.startsWith('Flex fuel (fallback ') && (
              <small>Auto-detected from the tune's flex-fuel state and configured fallback ethanol content.</small>
            )}
          </div>

          <div className="submit-field">
            <label htmlFor="submit-ignition">Ignition</label>
            <SelectMenu
              id="submit-ignition"
              value={form.ignition}
              onChange={(value) => update('ignition', value)}
              placeholder="Select ignition mode…"
              ariaLabel="Ignition"
              options={selectableIgnitionOptions.map((option) => ({ value: option }))}
            />
            <small>
              {ini
                ? 'Options are taken from this firmware definition.'
                : 'Fallback EpicEFI ignition modes are shown until the matching INI is loaded.'}
            </small>
          </div>
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
            <h2>Review and publish</h2>
          </div>
          <span className={`badge ${validationErrors.length === 0 ? 'badge-ok' : ''}`}>
            {validationErrors.length === 0 ? 'Ready to publish' : `${validationErrors.length} item(s) required`}
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

        {packageStats && (
          <div className="package-size-check">
            <span>Raw package input <strong>{formatBytes(packageStats.raw)}</strong></span>
            <span>Generated ZIP <strong>{formatBytes(packageStats.zip)}</strong></span>
          </div>
        )}

        <div className="github-submit-panel">
          <div className="github-submit-heading">
            <div>
              <p className="eyebrow">Direct GitHub upload</p>
              <h3>Publish tune directly to main</h3>
            </div>
            <span className="badge">Token stays in page memory</span>
          </div>

          <label className="submit-field full">
            <span>GitHub access token</span>
            <input
              type="password"
              value={githubToken}
              autoComplete="off"
              onChange={(event) => setGitHubToken(event.target.value)}
              placeholder="github_pat_… or ghp_…"
            />
            <small>
              Use a fine-grained personal access token with resource owner <strong>PJawZK</strong>,
              repository access limited to <strong>PJawZK-EpicEFI-Tune-Viewer</strong>, and
              <strong>Contents: Read and write</strong>. Uploads now use GitHub's Contents API rather than
              the Git Data blob API for fine-grained-token compatibility. The token is held only in page memory.
            </small>
          </label>

          {githubProgress && (
            <div className="github-progress">
              {githubProgressLabel(githubProgress, githubProgressDetail)}
            </div>
          )}

          {githubError && <div className="mismatch">{githubError}</div>}

          {githubResult && (
            <div className="github-success">
              <div>
                <strong>Published directly to main</strong>
                <span>
                  {githubResult.targetRepository} · {githubResult.commitSha.slice(0, 12)}
                </span>
              </div>
              <a
                className="open-button"
                href={githubResult.commitUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open commit
              </a>
            </div>
          )}

          <div className="submission-actions">
            <button
              type="button"
              className="open-button button-reset"
              disabled={
                validationErrors.length > 0
                || githubSubmitting
                || !githubToken.trim()
              }
              onClick={() => void submitToGitHub()}
            >
              {githubSubmitting ? 'Uploading to main…' : 'Upload to main'}
            </button>
            <a
              className="open-button secondary"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Create fine-grained token
            </a>
          </div>
        </div>

        <div className="submission-actions">
          <button
            type="button"
            className="open-button secondary button-reset"
            disabled={validationErrors.length > 0 || packaging}
            onClick={() => void createPackage()}
          >
            {packaging ? 'Creating package…' : 'Download submission ZIP instead'}
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
          Direct upload writes the tune files straight into <code>main</code> under
          <code>public/tunes/&lt;tune-id&gt;/</code>. File staging commits are marked to skip CI;
          <code>metadata.json</code> is written last and triggers the normal catalog/build validation.
          No branch, fork, or pull request is created.
        </p>
      </section>

      <footer>
        Submission builder — local files remain in your browser unless you explicitly choose Upload to main.
      </footer>
    </main>
  );
}
