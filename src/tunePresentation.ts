import type {
  PublishedTuneMetadata,
  ValidationStatus,
} from './model';

export type TuneMetric = {
  label: string;
  value: string;
};

export function formatTuneDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function firmwareSummary(signature: string): string {
  const trimmed = signature.trim();
  const match = trimmed.match(
    /^rusEFI\s+(.+?\.\d{4}\.\d{2}\.\d{2})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/,
  );

  if (match) {
    return `${match[1]} · ${match[2]} · build ${match[3]}`;
  }

  if (trimmed.length <= 54) return trimmed;
  return `${trimmed.slice(0, 51)}…`;
}

export function validationClass(status: ValidationStatus): string {
  if (status === 'EpicEFI Verified') return 'validation-official';
  if (status === 'Unverified') return 'validation-unverified';
  if (status === 'Starts/Idles') return 'validation-basic';
  if (status === 'Driven' || status === 'Road Tested') return 'validation-road';
  return 'validation-performance';
}

export function tuneMetrics(tune: PublishedTuneMetadata): TuneMetric[] {
  const metrics: TuneMetric[] = [];

  if (tune.powerHp !== undefined) {
    metrics.push({ label: 'Power', value: `${tune.powerHp} hp` });
  }
  if (tune.torqueNm !== undefined) {
    metrics.push({ label: 'Torque', value: `${tune.torqueNm} Nm` });
  }
  if (tune.boostBar !== undefined) {
    metrics.push({ label: 'Boost', value: `${tune.boostBar} bar` });
  }
  if (tune.injectorCc !== undefined) {
    metrics.push({ label: 'Injectors', value: `${tune.injectorCc} cc/min` });
  }

  return metrics;
}

export function engineSummary(tune: PublishedTuneMetadata): string {
  return [
    tune.engine?.make,
    tune.engine?.code,
    tune.engine?.displacementLiters !== undefined
      ? `${tune.engine.displacementLiters} L`
      : '',
    tune.engine?.cylinders !== undefined
      ? `${tune.engine.cylinders} cyl`
      : '',
    tune.engine?.aspiration,
  ].filter(Boolean).join(' · ');
}

export function vehicleSummary(tune: PublishedTuneMetadata): string {
  return [
    tune.vehicle?.year,
    tune.vehicle?.make,
    tune.vehicle?.model,
    tune.vehicle?.trim,
  ].filter(Boolean).join(' ');
}

export function tuneIdentity(tune: PublishedTuneMetadata): string {
  if (tune.versionLabel) return tune.versionLabel;
  if (tune.parentTuneId) return 'Revision';
  return tune.classification === 'Base Tune' ? 'Base Map' : 'Original';
}
