import type { ValidationStatus } from './model';

export type PublicSubmissionResult = {
  ok: boolean;
  tuneId: string;
  validationStatus: ValidationStatus;
  commitSha: string;
  commitUrl: string;
};

export const publicSubmissionEndpoint = String(
  import.meta.env.VITE_PUBLIC_SUBMISSION_ENDPOINT ?? '',
).trim().replace(/\/$/, '');
export const publicTurnstileSiteKey = String(
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
).trim();
export const publicSubmissionEnabled = Boolean(
  publicSubmissionEndpoint && publicTurnstileSiteKey,
);

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_MSQ_BYTES = 16 * 1024 * 1024;
const MAX_INI_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function assertPublicSubmissionSize({
  metadataText,
  parentMetadataSnapshot,
  msq,
  ini,
}: {
  metadataText: string;
  parentMetadataSnapshot?: string;
  msq: File;
  ini?: File;
}): void {
  const metadataBytes = textBytes(metadataText);
  const parentSnapshotBytes = parentMetadataSnapshot
    ? textBytes(parentMetadataSnapshot)
    : 0;
  const iniBytes = ini?.size ?? 0;
  const totalBytes = metadataBytes + parentSnapshotBytes + msq.size + iniBytes;

  const problems: string[] = [];
  if (metadataBytes > MAX_METADATA_BYTES) {
    problems.push(
      `metadata ${formatBytes(metadataBytes)} / ${formatBytes(MAX_METADATA_BYTES)}`,
    );
  }
  if (parentSnapshotBytes > MAX_METADATA_BYTES) {
    problems.push(
      `revision snapshot ${formatBytes(parentSnapshotBytes)} / ${formatBytes(MAX_METADATA_BYTES)}`,
    );
  }
  if (msq.size > MAX_MSQ_BYTES) {
    problems.push(`MSQ ${formatBytes(msq.size)} / ${formatBytes(MAX_MSQ_BYTES)}`);
  }
  if (iniBytes > MAX_INI_BYTES) {
    problems.push(`INI ${formatBytes(iniBytes)} / ${formatBytes(MAX_INI_BYTES)}`);
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    problems.push(
      `total ${formatBytes(totalBytes)} / ${formatBytes(MAX_TOTAL_BYTES)}`,
    );
  }

  if (problems.length) {
    throw new Error(
      `Public submission exceeds the service file-size limits: ${problems.join('; ')}.`,
    );
  }
}

export async function submitTuneToPublicService({
  metadata,
  msq,
  ini,
  turnstileToken,
  parentMetadataSnapshot,
}: {
  metadata: unknown;
  msq: File;
  ini?: File;
  turnstileToken: string;
  parentMetadataSnapshot?: string;
}): Promise<PublicSubmissionResult> {
  if (!publicSubmissionEnabled) {
    throw new Error('Public submission service is not configured on this deployment.');
  }
  if (!turnstileToken.trim()) {
    throw new Error('Complete the anti-bot verification before submitting.');
  }

  const metadataText = JSON.stringify(metadata);
  assertPublicSubmissionSize({
    metadataText,
    parentMetadataSnapshot,
    msq,
    ini,
  });

  const body = new FormData();
  body.append('metadata', metadataText);
  body.append('msq', msq, 'tune.msq');
  if (ini) body.append('ini', ini, 'mainController.ini');
  body.append('turnstileToken', turnstileToken);
  if (parentMetadataSnapshot) {
    body.append('parentMetadataSnapshot', parentMetadataSnapshot);
  }

  const response = await fetch(
    `${publicSubmissionEndpoint}/v1/submissions`,
    {
      method: 'POST',
      body,
    },
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof (payload as { error?: unknown }).error === 'string'
    )
      ? (payload as { error: string }).error
      : `Public submission service returned ${response.status} ${response.statusText}.`;
    throw new Error(message);
  }

  if (
    !payload
    || typeof payload !== 'object'
    || (payload as { ok?: unknown }).ok !== true
    || typeof (payload as { tuneId?: unknown }).tuneId !== 'string'
    || typeof (payload as { commitSha?: unknown }).commitSha !== 'string'
    || typeof (payload as { commitUrl?: unknown }).commitUrl !== 'string'
  ) {
    throw new Error('Public submission service returned an invalid success response.');
  }

  return payload as PublicSubmissionResult;
}
