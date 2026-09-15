import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import {
  findRegisteredDefinition,
  loadDefinitionRegistry,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import { parseFirmwareIdentity } from './firmwareIdentity';
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
import {
  findPublishedTune,
  forgetPublishedTune,
  invalidateTuneIndex,
  loadPublishedText,
  loadTuneIndex,
  rememberPublishedTune,
} from './tuneLibrary';
import {
  deleteTuneFromGitHub,
  setTuneArchiveStateOnGitHub,
  submitTuneToGitHub,
  updateTuneOnGitHub,
  type GitHubSubmissionProgress,
  type GitHubSubmissionResult,
} from './githubSubmission';
import SelectMenu from './SelectMenu';
import TurnstileWidget from './TurnstileWidget';
import { mergeEcuTargets } from './ecuTargets';
import {
  publicSubmissionEnabled,
  publicTurnstileSiteKey,
  submitTuneToPublicService,
  type PublicSubmissionResult,
} from './publicSubmission';
import { MAX_TUNE_ID_LENGTH, assertValidTuneId } from './publicationPolicy';

type SubmitTuneProps = {
  navigate: (path: string) => void;
  editId?: string;
  revisionOfId?: string;
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

const MAX_TITLE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 1000;
const MAX_AUTHOR_LENGTH = 120;
const MAX_ECU_TARGET_LENGTH = 120;
const MAX_FIRMWARE_SIGNATURE_LENGTH = 240;
const MAX_VEHICLE_MAKE_LENGTH = 80;
const MAX_VEHICLE_MODEL_LENGTH = 120;
const MAX_VEHICLE_TRIM_LENGTH = 120;
const MAX_ENGINE_MAKE_LENGTH = 80;
const MAX_ENGINE_CODE_LENGTH = 120;
const MAX_ASPIRATION_LENGTH = 120;
const MAX_FUEL_LENGTH = 120;
const MAX_IGNITION_LENGTH = 120;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 48;
const MAX_NOTES_LENGTH = 6000;
const MAX_VERSION_LABEL_LENGTH = 120;

type FormFieldErrors = Partial<Record<keyof FormState, string>>;

function textLengthError(
  label: string,
  value: string,
  maxLength: number,
): string {
  const length = value.trim().length;
  return length > maxLength
    ? label + ' is too long (' + length + '/' + maxLength + ' characters).'
    : '';
}

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
    'rolling-back': 'Restoring previous tune files',
  };

  return progress ? `${labels[progress]}${detail ? ` · ${detail}` : ''}` : '';
}

const initialForm: FormState = {
  id: '',
  title: '',
  summary: '',
  author: '',
  ecuTarget: '',
  validationStatus: 'Unverified',
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

function lineageRootId(
  tune: PublishedTuneMetadata,
  byId: Map<string, PublishedTuneMetadata>,
): string {
  const seen = new Set<string>([tune.id]);
  let cursor = tune;

  while (cursor.parentTuneId) {
    if (seen.has(cursor.parentTuneId)) break;
    seen.add(cursor.parentTuneId);
    const parent = byId.get(cursor.parentTuneId);
    if (!parent) break;
    cursor = parent;
  }

  return cursor.id;
}

function nextRevisionIdentity(
  rootId: string,
  ids: Set<string>,
): { id: string; label: string } {
  for (let revision = 2; revision < 1000; revision += 1) {
    const candidate = `${rootId}-r${revision}`;
    if (!ids.has(candidate)) {
      return { id: candidate, label: `R${revision}` };
    }
  }

  const stamp = Date.now();
  return {
    id: `${rootId}-revision-${stamp}`,
    label: `Revision ${stamp}`,
  };
}

function lineageWouldCycle(
  tuneId: string,
  parentTuneId: string,
  parentById: Map<string, string>,
): boolean {
  if (!tuneId || !parentTuneId) return false;
  if (tuneId === parentTuneId) return true;

  const seen = new Set<string>([tuneId]);
  let cursor = parentTuneId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentById.get(cursor) ?? '';
  }
  return false;
}

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


function formFromMetadata(metadata: PublishedTuneMetadata): FormState {
  return {
    id: metadata.id,
    title: metadata.title,
    summary: metadata.summary ?? '',
    author: metadata.author,
    ecuTarget: metadata.ecuTarget,
    validationStatus: metadata.validationStatus,
    classification: metadata.classification,
    vehicleMake: metadata.vehicle?.make ?? '',
    vehicleModel: metadata.vehicle?.model ?? '',
    vehicleYear: metadata.vehicle?.year !== undefined ? String(metadata.vehicle.year) : '',
    vehicleTrim: metadata.vehicle?.trim ?? '',
    engineMake: metadata.engine?.make ?? '',
    engineCode: metadata.engine?.code ?? '',
    displacementLiters:
      metadata.engine?.displacementLiters !== undefined
        ? String(metadata.engine.displacementLiters)
        : '',
    cylinders:
      metadata.engine?.cylinders !== undefined
        ? String(metadata.engine.cylinders)
        : '',
    aspiration: metadata.engine?.aspiration ?? '',
    compressionRatio:
      metadata.engine?.compressionRatio !== undefined
        ? String(metadata.engine.compressionRatio)
        : '',
    fuel: metadata.fuel ?? '',
    ignition: metadata.ignition ?? '',
    injectorCc: metadata.injectorCc !== undefined ? String(metadata.injectorCc) : '',
    powerHp: metadata.powerHp !== undefined ? String(metadata.powerHp) : '',
    stockPowerHp: metadata.stockPowerHp !== undefined ? String(metadata.stockPowerHp) : '',
    torqueNm: metadata.torqueNm !== undefined ? String(metadata.torqueNm) : '',
    boostBar: metadata.boostBar !== undefined ? String(metadata.boostBar) : '',
    tags: metadata.tags.join(', '),
    notes: metadata.notes ?? '',
    versionLabel: metadata.versionLabel ?? '',
    parentTuneId: metadata.parentTuneId ?? '',
  };
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
  maxLength,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'number';
  step?: string;
  maxLength?: number;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`submit-field ${error ? 'invalid' : ''}`}>
      <span>{label}{required && <em> required</em>}</span>
      <input
        type={type}
        step={step}
        maxLength={maxLength}
        value={value}
        aria-invalid={Boolean(error) || undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {error && <small className="submit-field-error">{error}</small>}
    </label>
  );
}

export default function SubmitTune({ navigate, editId, revisionOfId }: SubmitTuneProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const sourceTuneId = editId ?? revisionOfId;
  const isRevision = Boolean(revisionOfId);
  const [editLoading, setEditLoading] = useState(Boolean(sourceTuneId));
  const [editLoadError, setEditLoadError] = useState('');
  const [originalPublishedAt, setOriginalPublishedAt] = useState('');
  const [originalMetadataText, setOriginalMetadataText] = useState('');
  const [originalHadIni, setOriginalHadIni] = useState(false);
  const [msqChanged, setMsqChanged] = useState(false);
  const [iniChanged, setIniChanged] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const [msqFile, setMsqFile] = useState<File | null>(null);
  const [tune, setTune] = useState<ParsedTune | null>(null);
  const [iniFile, setIniFile] = useState<File | null>(null);
  const [ini, setIni] = useState<ParsedIni | null>(null);
  const [fileError, setFileError] = useState('');
  const [registryEntry, setRegistryEntry] = useState<DefinitionRegistryEntry | null>(null);
  const [registryStatus, setRegistryStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [parentById, setParentById] = useState<Map<string, string>>(new Map());
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
  const [lifecycleStatus, setLifecycleStatus] = useState<'Published' | 'Archived'>('Published');
  const [archivedAt, setArchivedAt] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [publicSubmitting, setPublicSubmitting] = useState(false);
  const [publicError, setPublicError] = useState('');
  const [publicResult, setPublicResult] = useState<PublicSubmissionResult | null>(null);
  const [publicTurnstileToken, setPublicTurnstileToken] = useState('');
  const [publicTurnstileResetKey, setPublicTurnstileResetKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadTuneIndex({ includeArchived: true })
      .then((index) => {
        if (!active) return;
        setExistingIds(new Set(index.tunes.map((entry) => entry.id)));
        setParentById(new Map(
          index.tunes
            .filter((entry) => Boolean(entry.parentTuneId))
            .map((entry) => [entry.id, entry.parentTuneId ?? '']),
        ));
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

  useEffect(() => {
    if (!sourceTuneId) {
      setEditLoading(false);
      return;
    }

    let active = true;
    setEditLoading(true);
    setEditLoadError('');

    const loadPublishedForEdit = async () => {
      const published = await findPublishedTune(sourceTuneId);
      if (!published) {
        throw new Error(`Published tune "${sourceTuneId}" was not found.`);
      }

      const metadataRaw = await loadPublishedText(
        `tunes/${encodeURIComponent(sourceTuneId)}/metadata.json`,
      );
      let repositoryMetadata: unknown;
      try {
        repositoryMetadata = JSON.parse(metadataRaw) as unknown;
      } catch (error) {
        throw new Error(
          `Published metadata is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        !repositoryMetadata
        || typeof repositoryMetadata !== 'object'
        || Array.isArray(repositoryMetadata)
        || (repositoryMetadata as Record<string, unknown>).id !== sourceTuneId
      ) {
        throw new Error(
          `Published metadata identity does not match tune "${sourceTuneId}". Editing is blocked.`,
        );
      }

      const msqRaw = await loadPublishedText(published.files.msq);
      const parsedTune = parseMsq(msqRaw);
      if (parsedTune.details.signature !== published.firmwareSignature) {
        throw new Error(
          'Published MSQ signature does not match its metadata. Editing is blocked.',
        );
      }

      let parsedIni: ParsedIni | null = null;
      let currentIniFile: File | null = null;

      if (published.files.ini) {
        const iniRaw = await loadPublishedText(published.files.ini);
        parsedIni = parseIni(iniRaw);
        if (parsedIni.signature !== parsedTune.details.signature) {
          throw new Error(
            'Published INI signature does not match the MSQ. Editing is blocked.',
          );
        }
        currentIniFile = new File(
          [iniRaw],
          'mainController.ini',
          { type: 'text/plain' },
        );
      }

      const registry = await findRegisteredDefinition(parsedTune.details.signature);

      if (!active) return;

      if (isRevision) {
        const index = await loadTuneIndex({ includeArchived: true });
        if (!active) return;
        const ids = new Set(index.tunes.map((entry) => entry.id));
        const byId = new Map(index.tunes.map((entry) => [entry.id, entry]));
        const rootId = lineageRootId(published, byId);
        const identity = nextRevisionIdentity(rootId, ids);
        const revisionForm = formFromMetadata(published);
        revisionForm.id = identity.id;
        revisionForm.parentTuneId = published.id;
        revisionForm.validationStatus = 'Unverified';
        revisionForm.versionLabel = identity.label;
        setForm(revisionForm);
        setOriginalPublishedAt('');
        setLifecycleStatus('Published');
        setArchivedAt('');
        setArchiveReason('');
      } else {
        setForm(formFromMetadata(published));
        setOriginalPublishedAt(published.publishedAt);
        setLifecycleStatus(
          published.lifecycleStatus === 'Archived' ? 'Archived' : 'Published',
        );
        setArchivedAt(published.archivedAt ?? '');
        setArchiveReason(published.archiveReason ?? '');
      }

      setIdTouched(true);
      setOriginalMetadataText(metadataRaw);
      setOriginalHadIni(Boolean(published.files.ini));
      setMsqFile(new File([msqRaw], 'tune.msq', { type: 'application/xml' }));
      setTune(parsedTune);
      setIniFile(currentIniFile);
      setIni(parsedIni);
      setRegistryEntry(registry);
      setRegistryStatus(registry ? 'found' : 'missing');
      setMsqChanged(false);
      setIniChanged(false);
      setAutoFilledFields([]);
      setEditLoading(false);
    };

    loadPublishedForEdit().catch((caught) => {
      if (!active) return;
      setEditLoadError(
        caught instanceof Error
          ? caught.message
          : 'Unable to load this published tune.',
      );
      setEditLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isRevision, sourceTuneId]);

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
    iniFile
    && signatureMatch
    && (
      registryStatus !== 'found'
      || Boolean(editId && originalHadIni && !msqChanged)
    ),
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
      publishedAt:
        editId && originalPublishedAt
          ? originalPublishedAt
          : new Date().toISOString().slice(0, 10),
      updatedAt: editId ? new Date().toISOString().slice(0, 10) : undefined,
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
      ...(editId && lifecycleStatus === 'Archived'
        ? {
            lifecycleStatus: 'Archived' as const,
            archivedAt: archivedAt || new Date().toISOString().slice(0, 10),
            archiveReason: archiveReason.trim() || undefined,
          }
        : {}),
      files: {
        msq: 'tune.msq',
        ...(shouldIncludeIni ? { ini: 'mainController.ini' } : {}),
      },
    }) as PublishedTuneMetadata;
  }, [
    archiveReason,
    archivedAt,
    editId,
    form,
    lifecycleStatus,
    originalPublishedAt,
    shouldIncludeIni,
    tune,
  ]);

  const fieldErrors = useMemo<FormFieldErrors>(() => {
    const errors: FormFieldErrors = {};

    if (!form.title.trim()) {
      errors.title = 'Title is required.';
    } else {
      const error = textLengthError('Title', form.title, MAX_TITLE_LENGTH);
      if (error) errors.title = error;
    }

    if (!form.id.trim()) {
      errors.id = 'Tune ID is required.';
    } else {
      try {
        assertValidTuneId(form.id.trim());
      } catch (error) {
        errors.id = error instanceof Error ? error.message : 'Tune ID is invalid.';
      }

      if (!errors.id && editId && form.id.trim() !== editId) {
        errors.id = 'Tune ID cannot be changed while editing a published tune.';
      } else if (
        !errors.id
        && existingIds.has(form.id.trim())
        && form.id.trim() !== editId
      ) {
        errors.id = 'Tune ID already exists in the public catalog.';
      }
    }

    if (!form.author.trim()) {
      errors.author = 'Author is required.';
    } else {
      const error = textLengthError('Author', form.author, MAX_AUTHOR_LENGTH);
      if (error) errors.author = error;
    }

    if (!form.ecuTarget.trim()) {
      errors.ecuTarget = 'ECU target is required.';
    } else {
      const error = textLengthError('ECU target', form.ecuTarget, MAX_ECU_TARGET_LENGTH);
      if (error) errors.ecuTarget = error;
    }

    if (!form.validationStatus) {
      errors.validationStatus = 'Select a validation badge.';
    }
    if (!form.classification) {
      errors.classification = 'Select a tune classification.';
    }

    const textFields: Array<[
      keyof FormState,
      string,
      string,
      number,
    ]> = [
      ['summary', 'Summary', form.summary, MAX_SUMMARY_LENGTH],
      ['vehicleMake', 'Vehicle make', form.vehicleMake, MAX_VEHICLE_MAKE_LENGTH],
      ['vehicleModel', 'Vehicle model', form.vehicleModel, MAX_VEHICLE_MODEL_LENGTH],
      ['vehicleTrim', 'Vehicle trim', form.vehicleTrim, MAX_VEHICLE_TRIM_LENGTH],
      ['engineMake', 'Engine make', form.engineMake, MAX_ENGINE_MAKE_LENGTH],
      ['engineCode', 'Engine code', form.engineCode, MAX_ENGINE_CODE_LENGTH],
      ['aspiration', 'Aspiration', form.aspiration, MAX_ASPIRATION_LENGTH],
      ['fuel', 'Fuel', form.fuel, MAX_FUEL_LENGTH],
      ['ignition', 'Ignition', form.ignition, MAX_IGNITION_LENGTH],
      ['notes', 'Notes', form.notes, MAX_NOTES_LENGTH],
      ['versionLabel', 'Version label', form.versionLabel, MAX_VERSION_LABEL_LENGTH],
    ];
    for (const [key, label, value, maxLength] of textFields) {
      const error = textLengthError(label, value, maxLength);
      if (error) errors[key] = error;
    }

    const tags = [...new Set(
      form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    )];
    if (tags.length > MAX_TAGS) {
      errors.tags = 'Too many tags (' + tags.length + '/' + MAX_TAGS + ').';
    } else {
      const longTag = tags.find((tag) => tag.length > MAX_TAG_LENGTH);
      if (longTag) {
        errors.tags = (
          'Tag "' + longTag + '" is too long ('
          + longTag.length + '/' + MAX_TAG_LENGTH + ' characters).'
        );
      }
    }

    const parentId = form.parentTuneId.trim();
    if (parentId) {
      try {
        assertValidTuneId(parentId, 'Parent tune ID');
      } catch (error) {
        errors.parentTuneId = (
          error instanceof Error ? error.message : 'Parent tune ID is invalid.'
        );
      }

      if (!errors.parentTuneId && parentId === form.id.trim()) {
        errors.parentTuneId = 'A tune cannot be its own lineage parent.';
      } else if (
        !errors.parentTuneId
        && !catalogError
        && !existingIds.has(parentId)
      ) {
        errors.parentTuneId = `Parent tune "${parentId}" does not exist in the public catalog.`;
      } else if (
        !errors.parentTuneId
        && lineageWouldCycle(form.id.trim(), parentId, parentById)
      ) {
        errors.parentTuneId = 'This parent selection would create circular tune lineage.';
      }
    }

    if (isRevision && form.parentTuneId !== revisionOfId) {
      errors.parentTuneId = 'Revision parent is fixed to the source tune.';
    }

    return errors;
  }, [
    archiveReason,
    catalogError,
    editId,
    existingIds,
    form,
    isRevision,
    parentById,
    revisionOfId,
  ]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!msqFile || !tune) errors.push('Load a valid EpicEFI MSQ.');
    if (!definitionReady) errors.push('Provide an exact matching firmware definition.');
    if (ini && !signatureMatch) {
      errors.push('The selected local INI does not match the MSQ firmware signature.');
    }

    if (tune) {
      const signatureError = textLengthError(
        'Firmware signature',
        tune.details.signature,
        MAX_FIRMWARE_SIGNATURE_LENGTH,
      );
      if (signatureError) errors.push(signatureError);
    }

    errors.push(
      ...Object.values(fieldErrors).filter(
        (error): error is string => Boolean(error),
      ),
    );
    return errors;
  }, [
    definitionReady,
    fieldErrors,
    ini,
    msqFile,
    signatureMatch,
    tune,
  ]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadMsq(file: File | undefined) {
    if (!file) return;
    if (editId) setMsqChanged(true);

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

      const firmwareIdentity = parseFirmwareIdentity(parsed.details.signature);
      const inferredTarget = firmwareIdentity?.ecuTarget || inferEcuTarget(parsed.details.signature);
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
    if (editId) setIniChanged(true);

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
      'EpicEFI Tune Viewer submission package',
      '',
      `Tune ID: ${metadata.id}`,
      `Firmware signature: ${metadata.firmwareSignature}`,
      '',
      'Repository package fallback:',
      `1. Place this folder under public/tunes/${metadata.id}/ in the repository.`,
      '2. Commit the folder to main.',
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

      const result = editId
        ? await updateTuneOnGitHub({
            token: githubToken,
            tuneId: editId,
            title: finalMetadata.title,
            firmwareSignature: finalMetadata.firmwareSignature,
            expectedMetadataText: originalMetadataText,
            files: [
              files[0],
              ...(msqChanged ? files.filter((entry) => entry.path.endsWith('/tune.msq')) : []),
              ...(iniChanged && shouldIncludeIni
                ? files.filter((entry) => entry.path.endsWith('/mainController.ini'))
                : []),
            ],
            deletePaths:
              originalHadIni && !shouldIncludeIni
                ? [`${basePath}/mainController.ini`]
                : [],
            onProgress: (progress, detail = '') => {
              setGitHubProgress(progress);
              setGitHubProgressDetail(detail);
            },
          })
        : await submitTuneToGitHub({
            token: githubToken,
            tuneId: finalMetadata.id,
            title: finalMetadata.title,
            firmwareSignature: finalMetadata.firmwareSignature,
            files,
            expectedParentMetadataText:
              isRevision ? originalMetadataText : undefined,
            onProgress: (progress, detail = '') => {
              setGitHubProgress(progress);
              setGitHubProgressDetail(detail);
            },
          });

      rememberPublishedTune(finalMetadata);
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


  async function changeArchiveState(archived: boolean) {
    if (!editId || !githubToken.trim()) return;

    setArchiveSubmitting(true);
    setArchiveError('');
    setDeleteError('');
    setGitHubError('');
    setGitHubResult(null);

    try {
      await setTuneArchiveStateOnGitHub({
        token: githubToken,
        tuneId: editId,
        expectedMetadataText: originalMetadataText,
        archived,
        reason: archiveReason,
      });
      invalidateTuneIndex();
      navigate(`/t/${encodeURIComponent(editId)}/info`);
    } catch (caught) {
      setArchiveError(
        caught instanceof Error
          ? caught.message
          : 'Unable to change this tune archive state.',
      );
    } finally {
      setArchiveSubmitting(false);
    }
  }
  async function removePublishedTune() {
    if (!editId || deleteConfirm !== editId || !githubToken.trim()) return;

    setDeleteSubmitting(true);
    setDeleteError('');
    setGitHubError('');
    setGitHubResult(null);

    try {
      await deleteTuneFromGitHub({
        token: githubToken,
        tuneId: editId,
        expectedMetadataText: originalMetadataText,
      });
      forgetPublishedTune(editId);
      navigate('/');
    } catch (caught) {
      setDeleteError(
        caught instanceof Error
          ? caught.message
          : 'Unable to remove this published tune.',
      );
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function submitPublicTune() {
    if (
      editId
      || !metadata
      || validationErrors.length
      || !msqFile
      || !tune
      || !publicSubmissionEnabled
    ) return;

    setPublicSubmitting(true);
    setPublicError('');
    setPublicResult(null);

    try {
      const packaged = packageMetadata(metadata);
      const publicMetadata: PublishedTuneMetadata = {
        ...packaged,
        updatedAt: undefined,
      };

      const result = await submitTuneToPublicService({
        metadata: publicMetadata,
        msq: msqFile,
        ini: shouldIncludeIni && iniFile ? iniFile : undefined,
        turnstileToken: publicTurnstileToken,
        parentMetadataSnapshot:
          isRevision ? originalMetadataText : undefined,
      });

      rememberPublishedTune(publicMetadata);
      setPublicResult(result);
      setPublicTurnstileToken('');
      setPublicTurnstileResetKey((value) => value + 1);
    } catch (caught) {
      setPublicError(
        caught instanceof Error
          ? caught.message
          : 'Unable to submit this tune through the public service.',
      );
      setPublicTurnstileToken('');
      setPublicTurnstileResetKey((value) => value + 1);
    } finally {
      setPublicSubmitting(false);
    }
  }

  return (
    <main>
      {editLoading && (
        <section className="empty-state">
          <h2>Loading published tune</h2>
          <p>Reading its current metadata and calibration files.</p>
        </section>
      )}

      {editLoadError && (
        <section className="error-state">
          <h2>Could not edit this tune</h2>
          <p>{editLoadError}</p>
          <button type="button" className="open-button button-reset" onClick={() => navigate('/')}>
            Return to Tune Hub
          </button>
        </section>
      )}

      {!editLoading && !editLoadError && (
      <>
      <header className="hub-hero submit-hero">
        <div>
          <p className="eyebrow">EpicEFI Tune Hub</p>
          <h1>
            {editId
              ? 'Edit published tune'
              : isRevision
                ? 'Create tune revision'
                : 'Prepare tune submission'}
          </h1>
          <p className="lede">
            {editId
              ? 'Update the published metadata and optionally replace the MSQ or matching firmware definition.'
              : isRevision
                ? 'Create a new published tune derived from this source while preserving its lineage.'
                : 'Validate an EpicEFI MSQ against its exact firmware definition, add public metadata, then use public community submission or the trusted-writer GitHub path when available.'}
          </p>
        </div>
        <button
          type="button"
          className="open-button secondary button-reset"
          onClick={() => navigate(
            sourceTuneId
              ? `/t/${encodeURIComponent(sourceTuneId)}/info`
              : '/',
          )}
        >
          {sourceTuneId ? 'Back to source tune' : 'Back to Tune Hub'}
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
            <span>MSQ · {sourceTuneId ? 'source / replace' : 'required'}</span>
            <strong>{msqFile?.name || 'Choose EpicEFI tune'}</strong>
            <input
              type="file"
              accept=".msq,.xml,text/xml,application/xml"
              onChange={(event) => void loadMsq(event.target.files?.[0])}
            />
          </label>

          <label className="submit-file-card">
            <span>mainController.ini · {sourceTuneId ? 'source / replace' : registryStatus === 'found' ? 'optional' : 'required'}</span>
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
            {parseFirmwareIdentity(tune.details.signature) && (
              <>
                <div className="detail">
                  <span>Firmware</span>
                  <strong>
                    {parseFirmwareIdentity(tune.details.signature)!.family}
                    {' · '}
                    {parseFirmwareIdentity(tune.details.signature)!.date}
                  </strong>
                </div>
                <div className="detail">
                  <span>Branch / ECU target</span>
                  <strong>
                    {parseFirmwareIdentity(tune.details.signature)!.branch}
                    {' · '}
                    {parseFirmwareIdentity(tune.details.signature)!.ecuTarget}
                  </strong>
                </div>
                <div className="detail">
                  <span>Definition hash</span>
                  <strong>{parseFirmwareIdentity(tune.details.signature)!.definitionHash}</strong>
                </div>
              </>
            )}
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
            {registryEntry?.release && (
              <div className="detail">
                <span>Registry snapshot</span>
                <strong>{registryEntry.release}</strong>
              </div>
            )}
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
            maxLength={MAX_TITLE_LENGTH}
            error={fieldErrors.title}
            value={form.title}
            onChange={(value) => {
              update('title', value);
              if (!idTouched) update('id', slugify(value));
            }}
            placeholder="Volvo B230FK 13T road tune"
          />
          <div className="submit-field-lock">
            <TextField
              label="Tune ID"
              required
              maxLength={MAX_TUNE_ID_LENGTH}
              error={fieldErrors.id}
              value={form.id}
              onChange={(value) => {
                setIdTouched(true);
                update('id', slugify(value));
              }}
              placeholder="volvo-b230fk-13t-road"
              disabled={Boolean(editId)}
            />
            {editId && <small>Published Tune IDs stay fixed so links and lineage remain stable.</small>}
            {isRevision && (
              <small>
                A lineage-wide revision ID is suggested automatically; the source tune stays unchanged.
              </small>
            )}
          </div>
          <TextField
            label="Author / uploader"
            required
            maxLength={MAX_AUTHOR_LENGTH}
            error={fieldErrors.author}
            value={form.author}
            onChange={(value) => update('author', value)}
          />
          <div className={`submit-field ${fieldErrors.ecuTarget ? 'invalid' : ''}`}>
            <label>ECU target <em>required</em></label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.ecuTarget)}
              value={form.ecuTarget}
              onChange={(value) => update('ecuTarget', value)}
              placeholder="Select supported ECU…"
              ariaLabel="ECU target"
              options={ecuTargetOptions}
            />
            {fieldErrors.ecuTarget && (
              <small className="submit-field-error">{fieldErrors.ecuTarget}</small>
            )}
            <small>Supported EpicEFI targets are listed, registered definition targets are merged in automatically, and the exact target detected from the loaded MSQ is added if needed.</small>
          </div>

          <div className={`submit-field ${fieldErrors.validationStatus ? 'invalid' : ''}`}>
            <label htmlFor="submit-validation">Validation badge <em>required</em></label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.validationStatus)}
              id="submit-validation"
              value={form.validationStatus}
              onChange={(value) => update('validationStatus', value as FormState['validationStatus'])}
              placeholder="Select validation…"
              ariaLabel="Validation badge"
              options={validationStatuses
                .filter(
                  (status) =>
                    status !== 'EpicEFI Verified'
                    || form.validationStatus === 'EpicEFI Verified',
                )
                .map((status) => ({ value: status }))}
            />
            {fieldErrors.validationStatus && (
              <small className="submit-field-error">{fieldErrors.validationStatus}</small>
            )}
            <small>
              {form.validationStatus === 'EpicEFI Verified' && editId
                ? 'Existing EpicEFI Verified status is preserved unless you deliberately change it.'
                : 'EpicEFI Verified cannot be self-assigned.'}
            </small>
          </div>

          <div className={`submit-field ${fieldErrors.classification ? 'invalid' : ''}`}>
            <label htmlFor="submit-classification">Classification <em>required</em></label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.classification)}
              id="submit-classification"
              value={form.classification}
              onChange={(value) => update('classification', value as FormState['classification'])}
              placeholder="Select classification…"
              ariaLabel="Tune classification"
              options={tuneClassifications.map((classification) => ({ value: classification }))}
            />
            {fieldErrors.classification && (
              <small className="submit-field-error">{fieldErrors.classification}</small>
            )}
          </div>
        </div>

        <label className={`submit-field full ${fieldErrors.summary ? 'invalid' : ''}`}>
          <span>Summary</span>
          <textarea
            value={form.summary}
            maxLength={MAX_SUMMARY_LENGTH}
            aria-invalid={Boolean(fieldErrors.summary) || undefined}
            onChange={(event) => update('summary', event.target.value)}
            placeholder="Short description shown in Tune Hub search results."
            rows={3}
          />
          <small>
            {form.summary.length}/{MAX_SUMMARY_LENGTH} characters
          </small>
          {fieldErrors.summary && (
            <small className="submit-field-error">{fieldErrors.summary}</small>
          )}
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
          <TextField label="Vehicle make" maxLength={MAX_VEHICLE_MAKE_LENGTH} error={fieldErrors.vehicleMake} value={form.vehicleMake} onChange={(value) => update('vehicleMake', value)} />
          <TextField label="Vehicle model" maxLength={MAX_VEHICLE_MODEL_LENGTH} error={fieldErrors.vehicleModel} value={form.vehicleModel} onChange={(value) => update('vehicleModel', value)} />
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
          <TextField label="Trim / variant" maxLength={MAX_VEHICLE_TRIM_LENGTH} error={fieldErrors.vehicleTrim} value={form.vehicleTrim} onChange={(value) => update('vehicleTrim', value)} />

          <TextField label="Engine make" maxLength={MAX_ENGINE_MAKE_LENGTH} error={fieldErrors.engineMake} value={form.engineMake} onChange={(value) => update('engineMake', value)} />
          <TextField label="Engine code" maxLength={MAX_ENGINE_CODE_LENGTH} error={fieldErrors.engineCode} value={form.engineCode} onChange={(value) => update('engineCode', value)} />
          <TextField label="Displacement (L)" type="number" step="0.01" value={form.displacementLiters} onChange={(value) => update('displacementLiters', value)} />
          <TextField label="Cylinders" type="number" value={form.cylinders} onChange={(value) => update('cylinders', value)} />

          <div className={`submit-field ${fieldErrors.aspiration ? 'invalid' : ''}`}>
            <label htmlFor="submit-aspiration">Aspiration</label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.aspiration)}
              id="submit-aspiration"
              value={form.aspiration}
              onChange={(value) => update('aspiration', value)}
              placeholder="Select aspiration…"
              ariaLabel="Aspiration"
              options={aspirationOptions.map((option) => ({ value: option }))}
            />
            {fieldErrors.aspiration && (
              <small className="submit-field-error">{fieldErrors.aspiration}</small>
            )}
            {form.aspiration === 'Forced induction (unspecified)' && (
              <small>EpicEFI reports forced induction but does not distinguish turbo from supercharger here.</small>
            )}
          </div>
          <TextField label="Compression ratio" type="number" step="0.01" value={form.compressionRatio} onChange={(value) => update('compressionRatio', value)} />
          <div className={`submit-field ${fieldErrors.fuel ? 'invalid' : ''}`}>
            <label htmlFor="submit-fuel">Fuel</label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.fuel)}
              id="submit-fuel"
              value={form.fuel}
              onChange={(value) => update('fuel', value)}
              placeholder="Select fuel…"
              ariaLabel="Fuel"
              options={selectableFuelOptions.map((option) => ({ value: option }))}
            />
            {fieldErrors.fuel && (
              <small className="submit-field-error">{fieldErrors.fuel}</small>
            )}
            {form.fuel.startsWith('Flex fuel (fallback ') && (
              <small>Auto-detected from the tune's flex-fuel state and configured fallback ethanol content.</small>
            )}
          </div>

          <div className={`submit-field ${fieldErrors.ignition ? 'invalid' : ''}`}>
            <label htmlFor="submit-ignition">Ignition</label>
            <SelectMenu
              ariaInvalid={Boolean(fieldErrors.ignition)}
              id="submit-ignition"
              value={form.ignition}
              onChange={(value) => update('ignition', value)}
              placeholder="Select ignition mode…"
              ariaLabel="Ignition"
              options={selectableIgnitionOptions.map((option) => ({ value: option }))}
            />
            {fieldErrors.ignition && (
              <small className="submit-field-error">{fieldErrors.ignition}</small>
            )}
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
          <div className="submit-field-lock">
            <TextField
              label="Version label"
              maxLength={MAX_VERSION_LABEL_LENGTH}
              error={fieldErrors.versionLabel}
              value={form.versionLabel}
              onChange={(value) => update('versionLabel', value)}
              placeholder="R2 / v2.1 / 2026-09 / ..."
            />
            {isRevision && <small>Suggested from the new revision number; editable before publishing.</small>}
          </div>
          <div className="submit-field-lock">
            <TextField
              label="Parent tune ID"
              maxLength={MAX_TUNE_ID_LENGTH}
              error={fieldErrors.parentTuneId}
              value={form.parentTuneId}
              onChange={(value) => update('parentTuneId', slugify(value))}
              placeholder="Optional lineage parent"
              disabled={isRevision}
            />
            {isRevision && <small>Locked to the source tune for this revision.</small>}
          </div>
          <TextField label="Tags" error={fieldErrors.tags} value={form.tags} onChange={(value) => update('tags', value)} placeholder="turbo, road, 13t, flex-fuel" />
        </div>

        <label className={`submit-field full ${fieldErrors.notes ? 'invalid' : ''}`}>
          <span>Notes</span>
          <textarea
            value={form.notes}
            maxLength={MAX_NOTES_LENGTH}
            aria-invalid={Boolean(fieldErrors.notes) || undefined}
            onChange={(event) => update('notes', event.target.value)}
            placeholder="Hardware, known limitations, test conditions, special configuration, or anything another user should know."
            rows={6}
          />
          <small>
            {form.notes.length}/{MAX_NOTES_LENGTH} characters
          </small>
          {fieldErrors.notes && (
            <small className="submit-field-error">{fieldErrors.notes}</small>
          )}
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

        {!editId && (
          <div className="github-submit-panel">
            <div className="github-submit-heading">
              <div>
                <p className="eyebrow">Public community submission</p>
                <h3>
                  {isRevision
                    ? 'Publish revision without a GitHub account'
                    : 'Publish tune without a GitHub account'}
                </h3>
              </div>
              <span className="badge">EpicEFI Verified reserved</span>
            </div>

            {publicSubmissionEnabled ? (
              <>
                <p className="submit-help">
                  This path does not require a GitHub account or repository access. The submission
                  service validates the MSQ, exact firmware definition, tune identity and lineage
                  again before creating a new tune folder on main. Normal validation states are
                  preserved, while EpicEFI Verified remains repository-controlled. Public
                  submissions can create tunes or revisions, but cannot edit or overwrite an
                  existing Tune ID.
                </p>

                <TurnstileWidget
                  siteKey={publicTurnstileSiteKey}
                  resetKey={publicTurnstileResetKey}
                  onToken={setPublicTurnstileToken}
                />

                {publicError && <div className="mismatch">{publicError}</div>}

                {publicResult && (
                  <div className="github-success">
                    <div>
                      <strong>Public tune submitted</strong>
                      <span>
                        {publicResult.tuneId} · {publicResult.validationStatus} · {publicResult.commitSha.slice(0, 12)}
                      </span>
                    </div>
                    <a
                      className="open-button"
                      href={publicResult.commitUrl}
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
                      || publicSubmitting
                      || !publicTurnstileToken
                    }
                    onClick={() => void submitPublicTune()}
                  >
                    {publicSubmitting
                      ? (isRevision ? 'Publishing revision…' : 'Publishing tune…')
                      : (isRevision ? 'Submit public revision' : 'Submit public tune')}
                  </button>
                </div>
              </>
            ) : (
              <div className="mismatch">
                Public no-account submission is implemented but not enabled on this deployment yet.
                The submission service endpoint and Turnstile site key must be configured first.
              </div>
            )}
          </div>
        )}

        <div className="github-submit-panel">
          <div className="github-submit-heading">
            <div>
              <p className="eyebrow">Trusted-writer GitHub upload</p>
              <h3>
                {editId
                  ? 'Save changes directly to main'
                  : isRevision
                    ? 'Publish revision directly to main'
                    : 'Publish tune directly to main'}
              </h3>
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
              Direct-to-main upload is currently for the repository owner and trusted writers.
              The owner <strong>PJawZK</strong> can use a fine-grained personal access token limited to
              <strong>PJawZK-EpicEFI-Tune-Viewer</strong> with <strong>Contents: Read and write</strong>.
              Repository collaborators must use a GitHub token that can write this repository; GitHub may require
              a classic personal access token for collaborator access to a personal-account repository.
              Public community submission is available above without a GitHub account or access token.
              This trusted-writer token is held only in page memory.
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
                <strong>
                  {editId
                    ? 'Updated directly on main'
                    : isRevision
                      ? 'Revision published directly to main'
                      : 'Published directly to main'}
                </strong>
                <span>
                  @{githubResult.login} · write access confirmed · {githubResult.targetRepository} · {githubResult.commitSha.slice(0, 12)}
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
              {githubSubmitting
                ? (editId
                    ? 'Saving changes…'
                    : isRevision
                      ? 'Publishing revision…'
                      : 'Uploading to main…')
                : (editId
                    ? 'Save changes to main'
                    : isRevision
                      ? 'Publish revision to main'
                      : 'Upload to main')}
            </button>
            <a
              className="open-button secondary"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Create owner fine-grained token
            </a>
          </div>
        </div>

        {editId && (
          <div className="github-submit-panel danger-zone">
            <div className="github-submit-heading">
              <div>
                <p className="eyebrow">Trusted-writer administration</p>
                <h3>Archive or remove published tune</h3>
              </div>
              <span className="badge">
                {lifecycleStatus === 'Archived' ? 'Currently archived' : 'Administrative actions'}
              </span>
            </div>

            <p className="submit-help">
              Archiving keeps the tune and its direct URL/lineage intact but removes it from normal
              Tune Hub discovery. Public/anonymous submission cannot archive, restore, edit, or remove
              existing Tune IDs.
            </p>

            {lifecycleStatus !== 'Archived' && (
              <label className="submit-field full">
                <span>Archive reason · optional</span>
                <textarea
                  value={archiveReason}
                  maxLength={500}
                  onChange={(event) => setArchiveReason(event.target.value)}
                  placeholder="Superseded, unsafe, obsolete hardware setup, duplicate, or other reason."
                  rows={3}
                />
                <small>{archiveReason.length}/500 characters</small>
              </label>
            )}

            {archiveError && <div className="mismatch">{archiveError}</div>}

            <div className="submission-actions">
              <button
                type="button"
                className="open-button secondary button-reset"
                disabled={archiveSubmitting || deleteSubmitting || !githubToken.trim()}
                onClick={() => void changeArchiveState(lifecycleStatus !== 'Archived')}
              >
                {archiveSubmitting
                  ? (lifecycleStatus === 'Archived' ? 'Restoring tune…' : 'Archiving tune…')
                  : (lifecycleStatus === 'Archived' ? 'Restore tune to Tune Hub' : 'Archive tune')}
              </button>
            </div>

            <div className="danger-divider" />

            <p className="submit-help">
              Permanent removal deletes the tune folder from <code>main</code>. Removal is blocked
              if live published revisions still depend on this Tune ID or if the tune is
              repository-authorized as EpicEFI Verified.
            </p>

            <label className="submit-field full">
              <span>Type the Tune ID to confirm permanent removal</span>
              <input
                type="text"
                value={deleteConfirm}
                autoComplete="off"
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder={editId}
              />
              <small>Enter <strong>{editId}</strong> exactly.</small>
            </label>

            {deleteError && <div className="mismatch">{deleteError}</div>}

            <div className="submission-actions">
              <button
                type="button"
                className="open-button danger button-reset"
                disabled={
                  deleteSubmitting
                  || archiveSubmitting
                  || githubSubmitting
                  || !githubToken.trim()
                  || deleteConfirm !== editId
                }
                onClick={() => void removePublishedTune()}
              >
                {deleteSubmitting ? 'Removing tune…' : 'Remove tune from main'}
              </button>
            </div>
          </div>
        )}

        <div className="submission-actions">
          <button
            type="button"
            className="open-button secondary button-reset"
            disabled={validationErrors.length > 0 || packaging}
            onClick={() => void createPackage()}
          >
            {packaging
              ? 'Creating package…'
              : editId
                ? 'Download edited tune ZIP'
                : isRevision
                  ? 'Download revision ZIP'
                  : 'Download submission ZIP instead'}
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
        {editId
          ? 'Published tune editor — changes are written only when you explicitly choose Save changes to main.'
          : isRevision
            ? 'Revision builder — the source tune remains unchanged; publishing creates a new linked Tune ID.'
            : 'Submission builder — local files remain in your browser unless you explicitly choose Upload to main.'}
      </footer>
      </>
      )}
    </main>
  );
}
