import type { PublishedTuneIndex, PublishedTuneMetadata } from './model';

const RAW_MAIN_ROOT =
  'https://raw.githubusercontent.com/PJawZK/PJawZK-EpicEFI-Tune-Viewer/main/';

let indexPromise: Promise<PublishedTuneIndex> | null = null;
const tuneOverrides = new Map<string, PublishedTuneMetadata>();

export function publicAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), document.baseURI).toString();
}

function rawMainUrl(path: string): string {
  const encoded = path
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  return `${RAW_MAIN_ROOT}${encoded}?v=${Date.now()}`;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isTuneRecord(value: unknown): value is PublishedTuneMetadata {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const files = record.files as Record<string, unknown> | undefined;

  return (
    isString(record.id)
    && isString(record.title)
    && isString(record.author)
    && isString(record.publishedAt)
    && isString(record.ecuTarget)
    && isString(record.firmwareSignature)
    && isString(record.validationStatus)
    && isString(record.classification)
    && Array.isArray(record.tags)
    && record.tags.every(isString)
    && Boolean(files && isString(files.msq))
  );
}

function publicTuneRecord(record: PublishedTuneMetadata): PublishedTuneMetadata {
  const prefix = `tunes/${record.id}/`;
  const msq = record.files.msq.includes('/')
    ? record.files.msq
    : prefix + record.files.msq;
  const ini = record.files.ini
    ? (record.files.ini.includes('/') ? record.files.ini : prefix + record.files.ini)
    : undefined;

  return {
    ...record,
    files: {
      msq,
      ...(ini ? { ini } : {}),
    },
  };
}

function applyTuneOverrides(index: PublishedTuneIndex): PublishedTuneIndex {
  if (!tuneOverrides.size) return index;

  const seen = new Set<string>();
  const tunes = index.tunes.map((tune) => {
    seen.add(tune.id);
    return tuneOverrides.get(tune.id) ?? tune;
  });

  for (const [id, tune] of tuneOverrides) {
    if (!seen.has(id)) tunes.push(tune);
  }

  return {
    ...index,
    tunes,
  };
}

export function rememberPublishedTune(metadata: PublishedTuneMetadata) {
  const normalized = publicTuneRecord(metadata);
  tuneOverrides.set(normalized.id, normalized);

  if (indexPromise) {
    indexPromise = indexPromise.then(applyTuneOverrides);
  }
}

export function invalidateTuneIndex() {
  indexPromise = null;
}

export async function loadTuneIndex(): Promise<PublishedTuneIndex> {
  if (!indexPromise) {
    indexPromise = fetch(publicAssetUrl('tunes/index.json'), {
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Tune index request failed with HTTP ${response.status}.`);
      }

      const raw = await response.json() as unknown;
      if (!raw || typeof raw !== 'object') {
        throw new Error('Tune index is not a JSON object.');
      }

      const candidate = raw as Record<string, unknown>;
      if (!Number.isInteger(candidate.schema) || !Array.isArray(candidate.tunes)) {
        throw new Error('Tune index schema is invalid.');
      }

      if (!candidate.tunes.every(isTuneRecord)) {
        throw new Error('Tune index contains an invalid tune record.');
      }

      const ids = new Set<string>();
      for (const tune of candidate.tunes) {
        if (ids.has(tune.id)) {
          throw new Error(`Tune index contains duplicate id "${tune.id}".`);
        }
        ids.add(tune.id);
      }

      return applyTuneOverrides({
        schema: Number(candidate.schema),
        tunes: candidate.tunes as PublishedTuneMetadata[],
      });
    });
  }

  return indexPromise;
}

async function loadPublishedTuneFromMain(
  id: string,
): Promise<PublishedTuneMetadata | null> {
  const safeId = id.trim();
  if (!safeId || safeId.includes('/') || safeId.includes('\\') || safeId.includes('..')) {
    return null;
  }

  const response = await fetch(
    rawMainUrl(`public/tunes/${safeId}/metadata.json`),
    { cache: 'no-store' },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Live tune metadata request failed with HTTP ${response.status}.`,
    );
  }

  const raw = await response.json() as unknown;
  if (!isTuneRecord(raw)) {
    throw new Error('Live tune metadata is invalid.');
  }

  if (raw.id !== safeId) {
    throw new Error(
      `Live tune metadata id "${raw.id}" does not match folder "${safeId}".`,
    );
  }

  return publicTuneRecord(raw);
}

export async function findPublishedChildren(
  parentTuneId: string,
): Promise<PublishedTuneMetadata[]> {
  const index = await loadTuneIndex();
  return index.tunes
    .filter((tune) => tune.parentTuneId === parentTuneId)
    .sort((left, right) => {
      const leftTime = new Date(left.publishedAt).getTime();
      const rightTime = new Date(right.publishedAt).getTime();
      return leftTime - rightTime;
    });
}

export async function loadTuneAncestors(
  tune: PublishedTuneMetadata,
): Promise<PublishedTuneMetadata[]> {
  const ancestors: PublishedTuneMetadata[] = [];
  const seen = new Set<string>([tune.id]);
  let parentId = tune.parentTuneId;

  while (parentId) {
    if (seen.has(parentId)) {
      throw new Error(`Circular lineage detected at "${parentId}".`);
    }

    seen.add(parentId);
    const parent = await findPublishedTune(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentTuneId;
  }

  return ancestors;
}

export async function findPublishedTune(id: string): Promise<PublishedTuneMetadata | null> {
  try {
    const live = await loadPublishedTuneFromMain(id);
    if (live) return live;
  } catch {
    // Fall back to the deployed catalog if GitHub raw content is temporarily unavailable.
  }

  const index = await loadTuneIndex();
  return index.tunes.find((tune) => tune.id === id) ?? null;
}

export async function loadPublishedText(path: string): Promise<string> {
  const clean = path.replace(/^\/+/, '');

  if (clean.startsWith('tunes/') && !clean.includes('..')) {
    try {
      const live = await fetch(
        rawMainUrl(`public/${clean}`),
        { cache: 'no-store' },
      );
      if (live.ok) return live.text();
    } catch {
      // Fall through to the deployed Pages asset.
    }
  }

  const response = await fetch(publicAssetUrl(clean), {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Published tune asset request failed with HTTP ${response.status}.`);
  }
  return response.text();
}
