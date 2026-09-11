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
  | 'preparing-repository'
  | 'preparing-branch'
  | 'uploading-files'
  | 'creating-commit'
  | 'opening-pr';

export type GitHubSubmissionResult = {
  pullRequestUrl: string;
  pullRequestNumber: number;
  branch: string;
  targetRepository: string;
  usedFork: boolean;
  login: string;
};

type GitHubUser = {
  login: string;
};

type GitHubRepo = {
  full_name: string;
  fork: boolean;
  default_branch: string;
  permissions?: {
    push?: boolean;
  };
  parent?: {
    full_name?: string;
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
};

type PullRequest = {
  html_url: string;
  number: number;
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
      const payload = await response.json() as { message?: string; documentation_url?: string };
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

function safeBranchComponent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'tune';
}

async function getRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRepo | null> {
  try {
    return await githubRequest<GitHubRepo>(token, `/repos/${owner}/${repo}`);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

async function waitForRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRepo> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const found = await getRepository(token, owner, repo);
    if (found) return found;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  throw new Error('GitHub created the fork but it did not become available in time. Try again shortly.');
}

async function ensureFork(
  token: string,
  login: string,
): Promise<GitHubRepo> {
  const existing = await getRepository(token, login, BASE_REPO);

  if (existing) {
    if (
      !existing.fork
      || existing.parent?.full_name?.toLowerCase()
        !== `${BASE_OWNER}/${BASE_REPO}`.toLowerCase()
    ) {
      throw new Error(
        `${login}/${BASE_REPO} already exists but is not a fork of `
        + `${BASE_OWNER}/${BASE_REPO}.`,
      );
    }

    return existing;
  }

  await githubRequest<GitHubRepo>(
    token,
    `/repos/${BASE_OWNER}/${BASE_REPO}/forks`,
    {
      method: 'POST',
      body: JSON.stringify({
        default_branch_only: true,
      }),
    },
  );

  return waitForRepository(token, login, BASE_REPO);
}

async function syncFork(token: string, owner: string, repo: string) {
  try {
    await githubRequest(
      token,
      `/repos/${owner}/${repo}/merge-upstream`,
      {
        method: 'POST',
        body: JSON.stringify({ branch: BASE_BRANCH }),
      },
    );
  } catch (error) {
    if (
      error instanceof Error
      && /merge conflict|could not be synced|unprocessable/i.test(error.message)
    ) {
      throw new Error(
        'Your GitHub fork could not be synchronized with the Tune Viewer main branch. '
        + 'Sync the fork on GitHub and retry.',
      );
    }
    throw error;
  }
}

async function createSingleCommitBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: GitHubSubmissionFile[],
  onProgress?: (progress: GitHubSubmissionProgress, detail?: string) => void,
) {
  onProgress?.('preparing-branch', `${owner}/${repo}`);

  const ref = await githubRequest<GitRef>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(BASE_BRANCH)}`,
  );
  const baseCommitSha = ref.object.sha;
  const baseCommit = await githubRequest<GitCommit>(
    token,
    `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
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
      token,
      `/repos/${owner}/${repo}/git/blobs`,
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

  onProgress?.('creating-commit', branch);
  const tree = await githubRequest<GitTree>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      }),
    },
  );

  const commit = await githubRequest<CreatedCommit>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [baseCommitSha],
      }),
    },
  );

  await githubRequest(
    token,
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
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
  const baseRepo = await githubRequest<GitHubRepo>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}`,
  );

  let targetOwner = BASE_OWNER;
  let targetRepo = BASE_REPO;
  let usedFork = false;

  onProgress?.('preparing-repository');

  if (!baseRepo.permissions?.push) {
    const fork = await ensureFork(trimmedToken, user.login);
    targetOwner = user.login;
    targetRepo = fork.full_name.split('/')[1] || BASE_REPO;
    usedFork = true;
    await syncFork(trimmedToken, targetOwner, targetRepo);
  }

  const timestamp = new Date().toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const branch = `tune/${safeBranchComponent(tuneId)}-${timestamp}`;

  await createSingleCommitBranch(
    trimmedToken,
    targetOwner,
    targetRepo,
    branch,
    `Submit tune: ${title}`,
    files,
    onProgress,
  );

  onProgress?.('opening-pr');
  const head = usedFork ? `${user.login}:${branch}` : branch;
  const pullRequest = await githubRequest<PullRequest>(
    trimmedToken,
    `/repos/${BASE_OWNER}/${BASE_REPO}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: `Tune submission: ${title}`,
        head,
        base: BASE_BRANCH,
        body: [
          '## EpicEFI Tune Viewer submission',
          '',
          `- Tune ID: \`${tuneId}\``,
          `- Firmware signature: \`${firmwareSignature}\``,
          `- Submitted by GitHub user: @${user.login}`,
          '',
          'This pull request was prepared by the browser-local Submit Tune workflow.',
          'Repository CI remains authoritative for catalog and firmware compatibility validation.',
        ].join('\n'),
      }),
    },
  );

  return {
    pullRequestUrl: pullRequest.html_url,
    pullRequestNumber: pullRequest.number,
    branch,
    targetRepository: `${targetOwner}/${targetRepo}`,
    usedFork,
    login: user.login,
  };
}
