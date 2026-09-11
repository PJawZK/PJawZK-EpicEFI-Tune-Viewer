import type { PublishedTuneMetadata } from './model';

export type RelatedTune = {
  tune: PublishedTuneMetadata;
  score: number;
  reasons: string[];
};

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function same(left: string | undefined, right: string | undefined): boolean {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && a === b);
}

const genericDiscoveryTags = new Set([
  'epicefi',
  'epicefi base map',
  'base map',
  'base tune',
  'generic',
]);

function tagSet(tune: PublishedTuneMetadata): Set<string> {
  return new Set(
    tune.tags
      .map((tag) => normalized(tag))
      .filter((tag) => Boolean(tag) && !genericDiscoveryTags.has(tag)),
  );
}

function isDirectLineage(
  reference: PublishedTuneMetadata,
  candidate: PublishedTuneMetadata,
): boolean {
  return reference.parentTuneId === candidate.id
    || candidate.parentTuneId === reference.id;
}

export function tuneEngineFacet(tune: PublishedTuneMetadata): string {
  const code = tune.engine?.code?.trim();
  if (code) return code;

  const make = tune.engine?.make?.trim();
  return make || '';
}

export function tuneVehicleMakeFacet(tune: PublishedTuneMetadata): string {
  return tune.vehicle?.make?.trim() ?? '';
}

export function isBaseTune(tune: PublishedTuneMetadata): boolean {
  return tune.classification === 'Base Tune';
}

export function rankRelatedTunes(
  reference: PublishedTuneMetadata,
  candidates: PublishedTuneMetadata[],
  limit = 6,
): RelatedTune[] {
  const referenceTags = tagSet(reference);

  return candidates
    .filter((candidate) => candidate.id !== reference.id)
    .map((candidate) => {
      let score = 0;
      const reasons: string[] = [];

      if (isDirectLineage(reference, candidate)) {
        score += 40;
        reasons.push('Same lineage');
      }

      if (same(reference.engine?.code, candidate.engine?.code)) {
        score += 18;
        reasons.push(`Engine ${candidate.engine?.code}`);
      }

      if (same(reference.vehicle?.make, candidate.vehicle?.make)) {
        score += 8;
        reasons.push(`Vehicle make ${candidate.vehicle?.make}`);
      }

      if (same(reference.vehicle?.model, candidate.vehicle?.model)) {
        score += 12;
        reasons.push(`Vehicle model ${candidate.vehicle?.model}`);
      }

      if (same(reference.engine?.make, candidate.engine?.make)) {
        score += 6;
        reasons.push(`Engine make ${candidate.engine?.make}`);
      }

      if (same(reference.ecuTarget, candidate.ecuTarget)) {
        score += 8;
        reasons.push(`ECU ${candidate.ecuTarget}`);
      }

      if (same(reference.engine?.aspiration, candidate.engine?.aspiration)) {
        score += 4;
        reasons.push(candidate.engine?.aspiration ?? 'Same aspiration');
      }

      if (same(reference.fuel, candidate.fuel)) {
        score += 3;
        reasons.push(`Fuel ${candidate.fuel}`);
      }

      if (same(reference.author, candidate.author)) {
        score += 2;
        reasons.push('Same author');
      }

      const candidateTags = tagSet(candidate);
      const sharedTags = [...referenceTags]
        .filter((tag) => candidateTags.has(tag))
        .slice(0, 3);

      if (sharedTags.length) {
        score += sharedTags.length * 2;
        reasons.push(...sharedTags.map((tag) => `Tag: ${tag}`));
      }

      return {
        tune: candidate,
        score,
        reasons: [...new Set(reasons)].slice(0, 4),
      };
    })
    .filter((entry) => entry.score >= 6)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const leftTime = new Date(left.tune.publishedAt).getTime();
      const rightTime = new Date(right.tune.publishedAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, limit);
}
