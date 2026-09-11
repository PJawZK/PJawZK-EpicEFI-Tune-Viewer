const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const BASE_OWNER = 'PJawZK';
const BASE_REPO = 'PJawZK-EpicEFI-Tune-Viewer';
const BASE_BRANCH = 'main';

export type GitHubSubmissionFile = {
  path: string;
  blob: Blob;
};

export type GitHubSubmissionProgress =
  | 'authenticating'
  | 'checking-main'
  | 'uploading-files'
  | 'publishing-main';

export type GitHubSubmissionResult = {
  commitSha: string;
  commitUrl: string;
  targetRepository: string;
  login: string;
};

type GitHubUser = {
  login: string;
};

type GitHubRepo = {
  full_name: string;
  permissions?: {
    push?: boolean;
  };
};

type ContentEntry = {
  name: string;
  path: string;
  sha: string;
  type: string;
};

type ContentWriteResult = {
  content?: {
    sha?: string;
    path?: string;
  };
  commit: {
    sha: string;
    html_url?: string;
  };
};

function apiHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

async function githubRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  allowStatuses: number[] = [],
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      ...apiHeaders(token),
      ...(init.headers ?? {}),
    },
  });

  if (allowStatuses.includes(response.status)) {
    return undefined as T;
  }

  if (!response.ok) {
    let message = `GitHub API returned ${response.status} ${response.statusText}.`;
    try {
      const payload = await response.json() as {
        message?: string;
        documentation_url?: string;
      };
      if (payload.message) message = payload.message;
      if (payload.documentation_url) message += ` (${payload.documentation_url})`;
    } catch {
      // Keep the HTTP status when GitHub did not return JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function ensureTuneIdIsUnused(token: string, tuneId: string) {
  const path = `/repos/${BASE_OWNER}/${BASE_REPO}/contents/public/tunes/`
    + `${encodeURIComponent(tuneId)}?ref=${encodeURIComponent(BASE_BRANCH)}`;

  const existing = await githubRequest<ContentEntry[] | undefined>(
    token,
    path,
    {},
    [404],
  );

  if (existing !== undefined) {
    throw new Error(
      `Tune folder "${tuneId}" already exists on ${BASE_BRANCH}. Choose another tune ID.`,
    );
  }
}

async function createContentFile(
  token: string,
  file: GitHubSubmissionFile,
  message: string,
): Promise<ContentWriteResult> {
  const content = await blobToBase64(file.blob);
  return githubRequest<ContentWriteResult>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${file.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content,
        branch: BASE_BRANCH,
      }),
    },
  );
}

async function deleteContentFile(
  token: string,
  path: string,
  sha: string,
) {
  await githubRequest(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Cleanup failed tune upload [skip ci]`,
        sha,
        branch: BASE_BRANCH,
      }),
    },
  );
}

export async function submitTuneToGitHub({
  token,
  tuneId,
  title,
  firmwareSignature,
  files,
  onProgress,
}: {
  token: string;
  tuneId: string;
  title: string;
  firmwareSignature: string;
  files: GitHubSubmissionFile[];
  onProgress?: (progress: GitHubSubmissionProgress, detail?: string) => void;
}): Promise<GitHubSubmissionResult> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Enter a GitHub access token.');

  onProgress?.('authenticating');
  const user = await githubRequest<GitHubUser>(trimmedToken, '/user');
  const repository = await githubRequest<GitHubRepo>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}`,
  );

  if (!repository.permissions?.push) {
    throw new Error(
      `GitHub user @${user.login} does not have write permission to `
      + `${BASE_OWNER}/${BASE_REPO}. Direct upload to main is available only to `
      + 'trusted repository writers.',
    );
  }

  onProgress?.('checking-main', `${BASE_OWNER}/${BASE_REPO}`);
  await ensureTuneIdIsUnused(trimmedToken, tuneId);

  const metadata = files.find((file) => file.path.endsWith('/metadata.json'));
  if (!metadata) throw new Error('Submission is missing metadata.json.');

  const stagedFiles = files.filter((file) => file !== metadata);
  const created: Array<{ path: string; sha: string }> = [];

  try {
    for (let index = 0; index < stagedFiles.length; index += 1) {
      const file = stagedFiles[index];
      onProgress?.('uploading-files', `${index + 1}/${files.length} · ${file.path.split('/').pop()}`);

      const result = await createContentFile(
        trimmedToken,
        file,
        `Stage tune ${tuneId}: ${file.path.split('/').pop()} [skip ci]`,
      );

      const sha = result.content?.sha;
      if (sha) created.push({ path: file.path, sha });
    }

    onProgress?.('publishing-main', `${files.length}/${files.length} · metadata.json`);
    const finalResult = await createContentFile(
      trimmedToken,
      metadata,
      [
        `Tune: ${title}`,
        '',
        `Tune ID: ${tuneId}`,
        `Firmware: ${firmwareSignature}`,
        `Uploaded by: @${user.login}`,
      ].join('\n'),
    );

    return {
      commitSha: finalResult.commit.sha,
      commitUrl:
        finalResult.commit.html_url
        || `https://github.com/${BASE_OWNER}/${BASE_REPO}/commit/${finalResult.commit.sha}`,
      targetRepository: repository.full_name,
      login: user.login,
    };
  } catch (error) {
    for (const staged of [...created].reverse()) {
      try {
        await deleteContentFile(trimmedToken, staged.path, staged.sha);
      } catch {
        // Best-effort cleanup only. Preserve the original upload error.
      }
    }

    if (
      error instanceof Error
      && /Resource not accessible by personal access token/i.test(error.message)
    ) {
      throw new Error(
        'This GitHub token can read the repository but cannot write repository contents. '
        + 'Edit or recreate the fine-grained token with Repository access set to '
        + 'PJawZK-EpicEFI-Tune-Viewer and Repository permissions → Contents → Read and write.',
      );
    }

    throw error;
  }
}
