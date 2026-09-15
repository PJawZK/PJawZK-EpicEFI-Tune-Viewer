import {
  assertMetadataMatchesFinalFiles,
  assertMetadataSnapshotMatches,
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
  | 'publishing-main'
  | 'rolling-back';

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

type FileSnapshot = {
  path: string;
  sha: string;
  contentBase64: string;
};

type AppliedMutation =
  | {
      kind: 'write';
      path: string;
      before?: FileSnapshot;
      afterSha: string;
    }
  | {
      kind: 'delete';
      path: string;
      before: FileSnapshot;
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

async function writeContentBase64(
  token: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<ContentWriteResult> {
  return githubRequest<ContentWriteResult>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: content.replace(/\s+/g, ''),
        branch: BASE_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
  );
}

async function writeContentFile(
  token: string,
  file: GitHubSubmissionFile,
  message: string,
  sha?: string,
): Promise<ContentWriteResult> {
  return writeContentBase64(
    token,
    file.path,
    await blobToBase64(file.blob),
    message,
    sha,
  );
}

async function deleteContentFile(
  token: string,
  path: string,
  sha: string,
  message = 'Cleanup failed tune upload [skip ci]',
): Promise<ContentWriteResult> {
  return githubRequest<ContentWriteResult>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        message,
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

async function getContentEntry(
  token: string,
  path: string,
): Promise<ContentEntry | null> {
  const encodedPath = path
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const entry = await githubRequest<ContentEntry | undefined>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(BASE_BRANCH)}`,
    {},
    [404],
  );

  return entry ?? null;
}

async function resolvedWriteSha(
  token: string,
  path: string,
  result: ContentWriteResult,
): Promise<string> {
  if (result.content?.sha) return result.content.sha;

  const current = await getContentEntry(token, path);
  if (current?.type === 'file') return current.sha;

  throw new Error(
    `GitHub accepted a write for "${path}" but did not return a resulting file identity.`,
  );
}

async function readContentBase64(token: string, path: string): Promise<string> {
  const encodedPath = path
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const response = await fetch(
    `${API_ROOT}/repos/${BASE_OWNER}/${BASE_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(BASE_BRANCH)}`,
    {
      headers: {
        ...apiHeaders(token),
        Accept: 'application/vnd.github.raw+json',
      },
    },
  );

  if (!response.ok) {
    let message = `GitHub API returned ${response.status} ${response.statusText} while reading "${path}".`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) message = payload.message;
    } catch {
      // Preserve the HTTP status when the response was not JSON.
    }
    throw new Error(message);
  }

  return blobToBase64(await response.blob());
}

function base64ToUtf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function assertCanonicalLiveFolder(tuneId: string, entries: ContentEntry[]): void {
  for (const entry of entries) {
    if (
      entry.type !== 'file'
      || !(TUNE_FILE_NAMES as readonly string[]).includes(entry.name)
      || entry.path !== tuneFilePath(tuneId, entry.name as TuneFileName)
    ) {
      throw new Error(
        `Published tune folder "${tuneId}" contains unexpected repository entry "${entry.path}". `
        + 'Reload after repository validation has been repaired.',
      );
    }
  }
}

async function captureTuneSnapshot(
  token: string,
  tuneId: string,
  entries: ContentEntry[],
): Promise<Map<string, FileSnapshot>> {
  const snapshot = new Map<string, FileSnapshot>();

  for (const entry of entries) {
    if (
      entry.type !== 'file'
      || !(TUNE_FILE_NAMES as readonly string[]).includes(entry.name)
    ) {
      continue;
    }

    snapshot.set(entry.path, {
      path: entry.path,
      sha: entry.sha,
      contentBase64: await readContentBase64(token, entry.path),
    });
  }

  if (!snapshot.has(tuneFilePath(tuneId, 'metadata.json'))) {
    throw new Error('Published tune metadata.json no longer exists on main.');
  }
  if (!snapshot.has(tuneFilePath(tuneId, 'tune.msq'))) {
    throw new Error('Published tune tune.msq no longer exists on main.');
  }

  return snapshot;
}

async function rollbackEditMutations(
  token: string,
  tuneId: string,
  mutations: AppliedMutation[],
  onProgress?: (progress: GitHubSubmissionProgress, detail?: string) => void,
): Promise<string[]> {
  const failures: string[] = [];

  if (mutations.length === 0) return failures;
  onProgress?.('rolling-back', `0/${mutations.length}`);

  let completed = 0;
  for (const mutation of [...mutations].reverse()) {
    completed += 1;
    const fileName = mutation.path.split('/').pop() ?? mutation.path;
    onProgress?.('rolling-back', `${completed}/${mutations.length} · ${fileName}`);

    try {
      const current = await getContentEntry(token, mutation.path);

      if (mutation.kind === 'write') {
        if (!current || current.type !== 'file' || current.sha !== mutation.afterSha) {
          failures.push(
            `${fileName}: current file changed after this edit; automatic rollback did not overwrite it`,
          );
          continue;
        }

        if (mutation.before) {
          await writeContentBase64(
            token,
            mutation.path,
            mutation.before.contentBase64,
            `Rollback failed tune edit ${tuneId}: restore ${fileName} [skip ci]`,
            current.sha,
          );
        } else {
          await deleteContentFile(
            token,
            mutation.path,
            current.sha,
            `Rollback failed tune edit ${tuneId}: remove ${fileName} [skip ci]`,
          );
        }
      } else {
        if (current) {
          failures.push(
            `${fileName}: file was recreated after this edit; automatic rollback did not overwrite it`,
          );
          continue;
        }

        await writeContentBase64(
          token,
          mutation.path,
          mutation.before.contentBase64,
          `Rollback failed tune edit ${tuneId}: restore ${fileName} [skip ci]`,
        );
      }
    } catch (error) {
      failures.push(
        `${fileName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return failures;
}

async function readLiveTuneMetadata(
  token: string,
  tuneId: string,
): Promise<{ raw: string; metadata: Record<string, unknown> }> {
  const entries = await getTuneFolderEntries(token, tuneId);
  if (!entries) {
    throw new Error(`Lineage tune "${tuneId}" no longer exists on ${BASE_BRANCH}.`);
  }

  assertCanonicalLiveFolder(tuneId, entries);
  const existingNames = existingCanonicalTuneFiles(tuneId, entries);
  if (!existingNames.has('metadata.json') || !existingNames.has('tune.msq')) {
    throw new Error(
      `Lineage tune "${tuneId}" is missing required metadata.json or tune.msq.`,
    );
  }

  const metadataPath = tuneFilePath(tuneId, 'metadata.json');
  const raw = base64ToUtf8(await readContentBase64(token, metadataPath));

  let metadata: unknown;
  try {
    metadata = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Lineage tune "${tuneId}" metadata is invalid JSON: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || (metadata as Record<string, unknown>).id !== tuneId
  ) {
    throw new Error(
      `Lineage tune "${tuneId}" metadata identity no longer matches its folder.`,
    );
  }

  return {
    raw,
    metadata: metadata as Record<string, unknown>,
  };
}

async function assertLiveLineage(
  token: string,
  tuneId: string,
  parentTuneId: string,
  expectedParentMetadataText?: string,
): Promise<void> {
  const seen = new Set([tuneId]);
  let cursor: string | undefined = parentTuneId;
  let first = true;

  while (cursor) {
    assertValidTuneId(cursor, 'Lineage parent Tune ID');
    if (seen.has(cursor)) {
      throw new Error(
        `Live lineage would create a cycle through tune "${cursor}".`,
      );
    }
    seen.add(cursor);

    const live = await readLiveTuneMetadata(token, cursor);
    if (first && expectedParentMetadataText) {
      assertMetadataSnapshotMatches(live.raw, expectedParentMetadataText, cursor);
    }
    first = false;

    const next = live.metadata.parentTuneId;
    if (next === undefined) break;
    if (typeof next !== 'string' || next.trim() === '') {
      throw new Error(
        `Lineage tune "${cursor}" has an invalid parentTuneId on ${BASE_BRANCH}.`,
      );
    }
    cursor = next;
  }
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

async function findLiveChildTuneIds(
  token: string,
  tuneId: string,
): Promise<string[]> {
  const entries = await githubRequest<ContentEntry[]>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/contents/public/tunes?ref=${encodeURIComponent(BASE_BRANCH)}`,
  );

  const directories = entries.filter(
    (entry) => entry.type === 'dir' && entry.name !== tuneId,
  );

  const children = await Promise.all(
    directories.map(async (entry) => {
      const live = await readLiveTuneMetadata(token, entry.name);
      return live.metadata.parentTuneId === tuneId ? entry.name : null;
    }),
  );

  return children.filter((id): id is string => Boolean(id)).sort();
}

export async function setTuneArchiveStateOnGitHub({
  token,
  tuneId,
  expectedMetadataText,
  archived,
  reason = '',
}: {
  token: string;
  tuneId: string;
  expectedMetadataText: string;
  archived: boolean;
  reason?: string;
}): Promise<GitHubSubmissionResult> {
  assertValidTuneId(tuneId);

  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Enter a GitHub access token.');
  if (reason.trim().length > 500) {
    throw new Error('Archive reason exceeds the 500-character publication limit.');
  }

  const user = await githubRequest<GitHubUser>(trimmedToken, '/user');
  const repository = await githubRequest<GitHubRepo>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}`,
  );

  if (!repository.permissions?.push) {
    throw new Error(
      `GitHub user @${user.login} does not have write permission to `
      + `${BASE_OWNER}/${BASE_REPO}. Archiving published tunes is available only to `
      + 'the repository owner or a trusted writer with GitHub write access.',
    );
  }

  const existingEntries = await getTuneFolderEntries(trimmedToken, tuneId);
  if (!existingEntries) {
    throw new Error(
      `Published tune folder "${tuneId}" no longer exists on ${BASE_BRANCH}.`,
    );
  }

  assertCanonicalLiveFolder(tuneId, existingEntries);
  const snapshot = await captureTuneSnapshot(trimmedToken, tuneId, existingEntries);
  const metadataPath = tuneFilePath(tuneId, 'metadata.json');
  const metadataEntry = existingEntries.find((entry) => entry.path === metadataPath);
  const metadataBefore = snapshot.get(metadataPath);

  if (!metadataEntry || metadataEntry.type !== 'file' || !metadataBefore) {
    throw new Error('Published tune metadata.json no longer exists on main.');
  }
  if (typeof expectedMetadataText !== 'string' || !expectedMetadataText.trim()) {
    throw new Error(
      'Archive collision check is missing the metadata snapshot loaded by this page.',
    );
  }

  const currentMetadataText = base64ToUtf8(metadataBefore.contentBase64);
  assertMetadataSnapshotMatches(currentMetadataText, expectedMetadataText, tuneId);

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(currentMetadataText) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Published tune metadata is invalid JSON: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  metadata.updatedAt = today;

  if (archived) {
    metadata.lifecycleStatus = 'Archived';
    metadata.archivedAt = today;
    if (reason.trim()) {
      metadata.archiveReason = reason.trim();
    } else {
      delete metadata.archiveReason;
    }
  } else {
    delete metadata.lifecycleStatus;
    delete metadata.archivedAt;
    delete metadata.archiveReason;
  }

  const nextText = JSON.stringify(metadata, null, 2) + '\n';
  const result = await writeContentFile(
    trimmedToken,
    {
      path: metadataPath,
      blob: new Blob([nextText], { type: 'application/json' }),
    },
    [
      archived
        ? `Archive tune: ${String(metadata.title ?? tuneId)}`
        : `Restore tune: ${String(metadata.title ?? tuneId)}`,
      '',
      `Tune ID: ${tuneId}`,
      `${archived ? 'Archived' : 'Restored'} by: @${user.login}`,
    ].join('\n'),
    metadataEntry.sha,
  );

  return {
    commitSha: result.commit.sha,
    commitUrl:
      result.commit.html_url
      || `https://github.com/${BASE_OWNER}/${BASE_REPO}/commit/${result.commit.sha}`,
    targetRepository: repository.full_name,
    login: user.login,
  };
}
export async function deleteTuneFromGitHub({
  token,
  tuneId,
  expectedMetadataText,
}: {
  token: string;
  tuneId: string;
  expectedMetadataText: string;
}): Promise<GitHubSubmissionResult> {
  assertValidTuneId(tuneId);

  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Enter a GitHub access token.');

  const user = await githubRequest<GitHubUser>(trimmedToken, '/user');
  const repository = await githubRequest<GitHubRepo>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}`,
  );

  if (!repository.permissions?.push) {
    throw new Error(
      `GitHub user @${user.login} does not have write permission to `
      + `${BASE_OWNER}/${BASE_REPO}. Removing published tunes is available only to `
      + 'the repository owner or a trusted writer with GitHub write access.',
    );
  }

  const existingEntries = await getTuneFolderEntries(trimmedToken, tuneId);
  if (!existingEntries) {
    throw new Error(
      `Published tune folder "${tuneId}" no longer exists on ${BASE_BRANCH}.`,
    );
  }

  assertCanonicalLiveFolder(tuneId, existingEntries);
  const snapshot = await captureTuneSnapshot(trimmedToken, tuneId, existingEntries);
  const metadataPath = tuneFilePath(tuneId, 'metadata.json');
  const metadataEntry = existingEntries.find((entry) => entry.path === metadataPath);
  const metadataBefore = snapshot.get(metadataPath);

  if (!metadataEntry || metadataEntry.type !== 'file' || !metadataBefore) {
    throw new Error('Published tune metadata.json no longer exists on main.');
  }
  if (typeof expectedMetadataText !== 'string' || !expectedMetadataText.trim()) {
    throw new Error(
      'Delete collision check is missing the metadata snapshot loaded by this page.',
    );
  }

  const currentMetadataText = base64ToUtf8(metadataBefore.contentBase64);
  assertMetadataSnapshotMatches(currentMetadataText, expectedMetadataText, tuneId);

  let currentMetadata: Record<string, unknown>;
  try {
    currentMetadata = JSON.parse(currentMetadataText) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Published tune metadata is invalid JSON: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (currentMetadata.validationStatus === 'EpicEFI Verified') {
    throw new Error(
      'EpicEFI Verified tunes cannot be removed from this screen while their '
      + 'repository validation-authority entry still exists.',
    );
  }

  const children = await findLiveChildTuneIds(trimmedToken, tuneId);
  if (children.length > 0) {
    throw new Error(
      `Tune "${tuneId}" cannot be removed because published revisions still depend on it: `
      + children.join(', '),
    );
  }

  const mutations: AppliedMutation[] = [];
  const assetEntries = existingEntries.filter((entry) => entry.path !== metadataPath);

  try {
    for (const entry of assetEntries) {
      const before = snapshot.get(entry.path);
      if (!before) {
        throw new Error(`Unable to snapshot "${entry.path}" before deletion.`);
      }

      await deleteContentFile(
        trimmedToken,
        entry.path,
        entry.sha,
        `Remove tune ${tuneId}: ${entry.name} [skip ci]`,
      );
      mutations.push({
        kind: 'delete',
        path: entry.path,
        before,
      });
    }

    const finalResult = await deleteContentFile(
      trimmedToken,
      metadataPath,
      metadataEntry.sha,
      [
        `Remove tune: ${String(currentMetadata.title ?? tuneId)}`,
        '',
        `Tune ID: ${tuneId}`,
        `Removed by: @${user.login}`,
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
    const original = permissionError(error) ?? (
      error instanceof Error ? error : new Error(String(error))
    );

    if (mutations.length === 0) throw original;

    const rollbackFailures = await rollbackEditMutations(
      trimmedToken,
      tuneId,
      mutations,
    );

    if (rollbackFailures.length > 0) {
      throw new Error(
        `${original.message} Automatic rollback could not fully restore the tune: `
        + rollbackFailures.join('; ')
        + '. Repair the published tune before trying another removal.',
      );
    }

    throw new Error(
      `${original.message} The published tune files were restored automatically.`,
    );
  }
}

export async function updateTuneOnGitHub({
  token,
  tuneId,
  title,
  firmwareSignature,
  files,
  expectedMetadataText,
  deletePaths = [],
  onProgress,
}: {
  token: string;
  tuneId: string;
  title: string;
  firmwareSignature: string;
  files: GitHubSubmissionFile[];
  expectedMetadataText: string;
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

  assertCanonicalLiveFolder(tuneId, existingEntries);

  const byPath = new Map(
    existingEntries.map((entry) => [entry.path, entry]),
  );
  const snapshot = await captureTuneSnapshot(trimmedToken, tuneId, existingEntries);

  const metadataEntry = byPath.get(metadataPath);
  const metadataBefore = snapshot.get(metadataPath);
  if (!metadataEntry || metadataEntry.type !== 'file' || !metadataBefore) {
    throw new Error('Published tune metadata.json no longer exists on main.');
  }

  if (typeof expectedMetadataText !== 'string' || !expectedMetadataText.trim()) {
    throw new Error('Edit collision check is missing the metadata snapshot loaded by this page.');
  }
  assertMetadataSnapshotMatches(
    base64ToUtf8(metadataBefore.contentBase64),
    expectedMetadataText,
    tuneId,
  );

  const existingNames = existingCanonicalTuneFiles(tuneId, existingEntries);
  if (!existingNames.has('tune.msq')) {
    throw new Error('Published tune tune.msq no longer exists on main.');
  }

  if (metadataIdentity.parentTuneId) {
    await assertLiveLineage(
      trimmedToken,
      tuneId,
      metadataIdentity.parentTuneId,
    );
  }

  const finalNames = new Set<TuneFileName>(existingNames);
  for (const name of writeNames) finalNames.add(name);
  for (const name of deleteNames) finalNames.delete(name);
  assertMetadataMatchesFinalFiles(metadataIdentity, finalNames);

  const stagedFiles = files.filter((file) => file !== metadata);
  const mutations: AppliedMutation[] = [];

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
      const result = await writeContentFile(
        trimmedToken,
        file,
        `Update tune ${tuneId}: ${file.path.split('/').pop()} [skip ci]`,
        existing?.sha,
      );
      mutations.push({
        kind: 'write',
        path: file.path,
        before: snapshot.get(file.path),
        afterSha: await resolvedWriteSha(trimmedToken, file.path, result),
      });
    }

    for (const path of deletePaths) {
      const existing = byPath.get(path);
      const before = snapshot.get(path);
      if (!existing || !before) continue;

      completed += 1;
      onProgress?.(
        'uploading-files',
        `${completed}/${total} · remove ${path.split('/').pop()}`,
      );

      await deleteContentFile(
        trimmedToken,
        path,
        existing.sha,
        `Update tune ${tuneId}: remove ${path.split('/').pop()} [skip ci]`,
      );
      mutations.push({
        kind: 'delete',
        path,
        before,
      });
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
    const original = clearer ?? (
      error instanceof Error ? error : new Error(String(error))
    );

    if (mutations.length === 0) throw original;

    const rollbackFailures = await rollbackEditMutations(
      trimmedToken,
      tuneId,
      mutations,
      onProgress,
    );

    if (rollbackFailures.length > 0) {
      throw new Error(
        `${original.message} Automatic rollback could not fully restore the previous tune: `
        + rollbackFailures.join('; ')
        + '. Reload the published tune before attempting another edit.',
      );
    }

    throw new Error(
      `${original.message} The previous published tune files were restored automatically.`,
    );
  }
}

export async function submitTuneToGitHub({
  token,
  tuneId,
  title,
  firmwareSignature,
  files,
  expectedParentMetadataText,
  onProgress,
}: {
  token: string;
  tuneId: string;
  title: string;
  firmwareSignature: string;
  files: GitHubSubmissionFile[];
  expectedParentMetadataText?: string;
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
  if (metadataIdentity.parentTuneId) {
    await assertLiveLineage(
      trimmedToken,
      tuneId,
      metadataIdentity.parentTuneId,
      expectedParentMetadataText,
    );
  }

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

      created.push({
        path: file.path,
        sha: await resolvedWriteSha(trimmedToken, file.path, result),
      });
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
    const cleanupFailures: string[] = [];
    for (const staged of [...created].reverse()) {
      try {
        const current = await getContentEntry(trimmedToken, staged.path);
        if (!current || current.type !== 'file') continue;
        if (current.sha !== staged.sha) {
          cleanupFailures.push(
            `${staged.path}: current file changed after staging; cleanup did not overwrite it`,
          );
          continue;
        }

        await deleteContentFile(trimmedToken, staged.path, staged.sha);
      } catch (cleanupError) {
        cleanupFailures.push(
          `${staged.path}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }

    const clearer = permissionError(error);
    const original = clearer ?? (
      error instanceof Error ? error : new Error(String(error))
    );

    if (cleanupFailures.length > 0) {
      throw new Error(
        `${original.message} Staged-file cleanup was incomplete: `
        + cleanupFailures.join('; ')
        + '. Repository validation will block an orphan/incomplete tune until it is repaired.',
      );
    }

    throw original;
  }
}
