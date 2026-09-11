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
  | 'creating-commit'
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

type GitRef = {
  object: {
    sha: string;
  };
};

type GitCommit = {
  tree: {
    sha: string;
  };
};

type GitBlob = {
  sha: string;
};

type GitTree = {
  sha: string;
};

type CreatedCommit = {
  sha: string;
  html_url?: string;
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
      // Keep the HTTP status text when GitHub did not return JSON.
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

  const existing = await githubRequest<unknown | undefined>(
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
      + 'trusted repository writers. Use the ZIP fallback for manual submission.',
    );
  }

  onProgress?.('checking-main', `${BASE_OWNER}/${BASE_REPO}`);
  await ensureTuneIdIsUnused(trimmedToken, tuneId);

  const ref = await githubRequest<GitRef>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}/git/ref/heads/${encodeURIComponent(BASE_BRANCH)}`,
  );
  const baseCommitSha = ref.object.sha;
  const baseCommit = await githubRequest<GitCommit>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}/git/commits/${baseCommitSha}`,
  );

  onProgress?.('uploading-files', `0/${files.length}`);
  const treeEntries: Array<{
    path: string;
    mode: '100644';
    type: 'blob';
    sha: string;
  }> = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const content = await blobToBase64(file.blob);
    const created = await githubRequest<GitBlob>(
      trimmedToken,
      `/repos/${BASE_OWNER}/${BASE_REPO}/git/blobs`,
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          encoding: 'base64',
        }),
      },
    );

    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: created.sha,
    });

    onProgress?.('uploading-files', `${index + 1}/${files.length}`);
  }

  onProgress?.('creating-commit', BASE_BRANCH);
  const tree = await githubRequest<GitTree>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      }),
    },
  );

  const commitMessage = [
    `Tune: ${title}`,
    '',
    `Tune ID: ${tuneId}`,
    `Firmware: ${firmwareSignature}`,
    `Uploaded by: @${user.login}`,
  ].join('\n');

  const commit = await githubRequest<CreatedCommit>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: tree.sha,
        parents: [baseCommitSha],
      }),
    },
  );

  onProgress?.('publishing-main', commit.sha.slice(0, 12));

  try {
    await githubRequest(
      trimmedToken,
      `/repos/${BASE_OWNER}/${BASE_REPO}/git/refs/heads/${encodeURIComponent(BASE_BRANCH)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          sha: commit.sha,
          force: false,
        }),
      },
    );
  } catch (error) {
    if (
      error instanceof Error
      && /fast forward|reference update failed|conflict|protected/i.test(error.message)
    ) {
      throw new Error(
        'GitHub did not move main to the new tune commit. Main may have changed during the '
        + 'upload or branch rules may now block direct writes. No force update was attempted. '
        + 'Refresh the page and retry.',
      );
    }
    throw error;
  }

  return {
    commitSha: commit.sha,
    commitUrl:
      commit.html_url
      || `https://github.com/${BASE_OWNER}/${BASE_REPO}/commit/${commit.sha}`,
    targetRepository: repository.full_name,
    login: user.login,
  };
}
