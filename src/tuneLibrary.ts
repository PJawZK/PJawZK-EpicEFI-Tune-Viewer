import type { PublishedTuneIndex, PublishedTuneMetadata } from './model';

let indexPromise: Promise<PublishedTuneIndex> | null = null;

export function publicAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), document.baseURI).toString();
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

export async function loadTuneIndex(): Promise<PublishedTuneIndex> {
  if (!indexPromise) {
    indexPromise = fetch(publicAssetUrl('tunes/index.json')).then(async (response) => {
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

      return {
        schema: Number(candidate.schema),
        tunes: candidate.tunes as PublishedTuneMetadata[],
      };
    });
  }

  return indexPromise;
}

export async function findPublishedTune(id: string): Promise<PublishedTuneMetadata | null> {
  const index = await loadTuneIndex();
  return index.tunes.find((tune) => tune.id === id) ?? null;
}

export async function loadPublishedText(path: string): Promise<string> {
  const response = await fetch(publicAssetUrl(path));
  if (!response.ok) {
    throw new Error(`Published tune asset request failed with HTTP ${response.status}.`);
  }
  return response.text();
}
