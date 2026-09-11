import {
  assertMetadataMatchesFinalFiles,
  assertTuneDeleteTargets,
  assertTuneMetadataIdentity,
  assertTuneWriteTargets,
  assertValidTuneId,
  TUNE_FILE_NAMES,
  tuneFilePath,
  type TuneFileName,
} from './publicationPolicy';

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

async function parseMetadataBlob(blob: Blob): Promise<unknown> {
  try {
    return JSON.parse(await blob.text()) as unknown;
  } catch (error) {
    throw new Error(
      `metadata.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function existingCanonicalTuneFiles(
  tuneId: string,
  entries: ContentEntry[],
): Set<TuneFileName> {
  const names = new Set<TuneFileName>();

  for (const name of TUNE_FILE_NAMES) {
    const expectedPath = tuneFilePath(tuneId, name);
    const entry = entries.find((candidate) => candidate.path === expectedPath);
    if (entry?.type === 'file') names.add(name);
  }

  return names;
}

async function ensureTuneIdIsUnused(token: string, tuneId: string) {
  assertValidTuneId(tuneId);
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

async function writeContentFile(
  token: string,
  file: GitHubSubmissionFile,
  message: string,
  sha?: string,
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
        ...(sha ? { sha } : {}),
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

async function getTuneFolderEntries(
  token: string,
  tuneId: string,
): Promise<ContentEntry[] | null> {
  assertValidTuneId(tuneId);
  const path = `/repos/${BASE_OWNER}/${BASE_REPO}/contents/public/tunes/`
    + `${encodeURIComponent(tuneId)}?ref=${encodeURIComponent(BASE_BRANCH)}`;

  return githubRequest<ContentEntry[] | null>(
    token,
    path,
    {},
    [404],
  );
}

function permissionError(error: unknown): Error | null {
  if (
    error instanceof Error
    && /Resource not accessible by personal access token/i.test(error.message)
  ) {
    return new Error(
      'This GitHub token can authenticate but cannot write repository contents. '
      + 'Repository owner PJawZK can use a fine-grained token limited to '
      + 'PJawZK-EpicEFI-Tune-Viewer with Contents → Read and write. '
      + 'Repository collaborators must use a GitHub token that GitHub permits to write '
      + 'this personal-account repository; a classic personal access token may be required.',
    );
  }

  return null;
}

export async function updateTuneOnGitHub({
  token,
  tuneId,
  title,
  firmwareSignature,
  files,
  deletePaths = [],
  onProgress,
}: {
  token: string;
  tuneId: string;
  title: string;
  firmwareSignature: string;
  files: GitHubSubmissionFile[];
  deletePaths?: string[];
  onProgress?: (progress: GitHubSubmissionProgress, detail?: string) => void;
}): Promise<GitHubSubmissionResult> {
  assertValidTuneId(tuneId);
  const writeNames = assertTuneWriteTargets(tuneId, files, 'edit');
  const deleteNames = assertTuneDeleteTargets(tuneId, deletePaths);

  for (const name of deleteNames) {
    if (writeNames.has(name)) {
      throw new Error(
        `Tune edit cannot write and delete "${name}" in the same operation.`,
      );
    }
  }

  const metadataPath = tuneFilePath(tuneId, 'metadata.json');
  const metadata = files.find((file) => file.path === metadataPath);
  if (!metadata) throw new Error('Edit submission is missing canonical metadata.json.');

  const metadataIdentity = assertTuneMetadataIdentity(
    await parseMetadataBlob(metadata.blob),
    tuneId,
    firmwareSignature,
  );

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
      + `${BASE_OWNER}/${BASE_REPO}. Editing published tunes is available only to `
      + 'the repository owner or a trusted writer with GitHub write access.',
    );
  }

  onProgress?.('checking-main', `${BASE_OWNER}/${BASE_REPO}`);
  const existingEntries = await getTuneFolderEntries(trimmedToken, tuneId);
  if (!existingEntries) {
    throw new Error(
      `Published tune folder "${tuneId}" no longer exists on ${BASE_BRANCH}.`,
    );
  }

  const byPath = new Map(
    existingEntries.map((entry) => [entry.path, entry]),
  );

  const metadataEntry = byPath.get(metadataPath);
  if (!metadataEntry || metadataEntry.type !== 'file') {
    throw new Error('Published tune metadata.json no longer exists on main.');
  }

  const existingNames = existingCanonicalTuneFiles(tuneId, existingEntries);
  if (!existingNames.has('tune.msq')) {
    throw new Error('Published tune tune.msq no longer exists on main.');
  }

  const finalNames = new Set<TuneFileName>(existingNames);
  for (const name of writeNames) finalNames.add(name);
  for (const name of deleteNames) finalNames.delete(name);
  assertMetadataMatchesFinalFiles(metadataIdentity, finalNames);

  const stagedFiles = files.filter((file) => file !== metadata);

  try {
    let completed = 0;
    const total = stagedFiles.length + deletePaths.length + 1;

    for (const file of stagedFiles) {
      completed += 1;
      onProgress?.(
        'uploading-files',
        `${completed}/${total} · ${file.path.split('/').pop()}`,
      );

      const existing = byPath.get(file.path);
      await writeContentFile(
        trimmedToken,
        file,
        `Update tune ${tuneId}: ${file.path.split('/').pop()} [skip ci]`,
        existing?.sha,
      );
    }

    for (const path of deletePaths) {
      const existing = byPath.get(path);
      if (!existing) continue;

      completed += 1;
      onProgress?.(
        'uploading-files',
        `${completed}/${total} · remove ${path.split('/').pop()}`,
      );

      await githubRequest(
        trimmedToken,
        `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            message: `Update tune ${tuneId}: remove ${path.split('/').pop()} [skip ci]`,
            sha: existing.sha,
            branch: BASE_BRANCH,
          }),
        },
      );
    }

    onProgress?.('publishing-main', `${total}/${total} · metadata.json`);
    const finalResult = await writeContentFile(
      trimmedToken,
      metadata,
      [
        `Update tune: ${title}`,
        '',
        `Tune ID: ${tuneId}`,
        `Firmware: ${firmwareSignature}`,
        `Updated by: @${user.login}`,
      ].join('\n'),
      metadataEntry.sha,
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
    const clearer = permissionError(error);
    if (clearer) throw clearer;
    throw error;
  }
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
  assertValidTuneId(tuneId);
  const writeNames = assertTuneWriteTargets(tuneId, files, 'create');

  const metadataPath = tuneFilePath(tuneId, 'metadata.json');
  const metadata = files.find((file) => file.path === metadataPath);
  if (!metadata) throw new Error('Submission is missing canonical metadata.json.');

  const metadataIdentity = assertTuneMetadataIdentity(
    await parseMetadataBlob(metadata.blob),
    tuneId,
    firmwareSignature,
  );
  assertMetadataMatchesFinalFiles(metadataIdentity, writeNames);

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
      + 'the repository owner or a trusted writer with GitHub write access.',
    );
  }

  onProgress?.('checking-main', `${BASE_OWNER}/${BASE_REPO}`);
  await ensureTuneIdIsUnused(trimmedToken, tuneId);

  const stagedFiles = files.filter((file) => file !== metadata);
  const created: Array<{ path: string; sha: string }> = [];

  try {
    for (let index = 0; index < stagedFiles.length; index += 1) {
      const file = stagedFiles[index];
      onProgress?.('uploading-files', `${index + 1}/${files.length} · ${file.path.split('/').pop()}`);

      const result = await writeContentFile(
        trimmedToken,
        file,
        `Stage tune ${tuneId}: ${file.path.split('/').pop()} [skip ci]`,
      );

      const sha = result.content?.sha;
      if (sha) created.push({ path: file.path, sha });
    }

    onProgress?.('publishing-main', `${files.length}/${files.length} · metadata.json`);
    const finalResult = await writeContentFile(
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

    const clearer = permissionError(error);
    if (clearer) throw clearer;
    throw error;
  }
}
