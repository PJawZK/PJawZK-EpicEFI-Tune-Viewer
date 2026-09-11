export type PublicSubmissionResult = {
  ok: boolean;
  tuneId: string;
  validationStatus: 'Unverified';
  commitSha: string;
  commitUrl: string;
};

function envValue(name: 'VITE_PUBLIC_SUBMISSION_ENDPOINT' | 'VITE_TURNSTILE_SITE_KEY'): string {
  return String(import.meta.env[name] ?? '').trim();
}

export const publicSubmissionEndpoint = envValue('VITE_PUBLIC_SUBMISSION_ENDPOINT').replace(/\/$/, '');
export const publicTurnstileSiteKey = envValue('VITE_TURNSTILE_SITE_KEY');
export const publicSubmissionEnabled = Boolean(
  publicSubmissionEndpoint && publicTurnstileSiteKey,
);

export async function submitTuneToPublicService({
  metadata,
  msq,
  ini,
  turnstileToken,
}: {
  metadata: unknown;
  msq: File;
  ini?: File;
  turnstileToken: string;
}): Promise<PublicSubmissionResult> {
  if (!publicSubmissionEnabled) {
    throw new Error('Public submission service is not configured on this deployment.');
  }
  if (!turnstileToken.trim()) {
    throw new Error('Complete the anti-bot verification before submitting.');
  }

  const body = new FormData();
  body.append('metadata', JSON.stringify(metadata));
  body.append('msq', msq, 'tune.msq');
  if (ini) body.append('ini', ini, 'mainController.ini');
  body.append('turnstileToken', turnstileToken);

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
