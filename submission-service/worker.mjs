import {
  assertPublicTuneId,
  publicErrorStatus,
  validatePublicPackage,
} from './validator.mjs';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const DEFAULT_OWNER = 'PJawZK';
const DEFAULT_REPO = 'PJawZK-EpicEFI-Tune-Viewer';
const DEFAULT_BRANCH = 'main';

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_MSQ_BYTES = 16 * 1024 * 1024;
const MAX_INI_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function textBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(payload, status, origin) {
  return new Response(JSON.stringify(payload, null, 2) + '\n', {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function repositoryConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
  };
}

function requireEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Submission service is missing required secret/config "${key}".`);
  }
  return value.trim();
}

/**
 * Create an Error carrying an HTTP response status without relying on
 * an undeclared Error.status property in JavaScript type checking.
 *
 * @param {string} message
 * @param {number} status
 * @returns {Error & { status: number }}
 */
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function assertOrigin(request, env) {
  const configured = requireEnv(env, 'PUBLIC_SITE_ORIGIN').replace(/\/$/, '');
  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');

  if (!origin || origin !== configured) {
    throw httpError('This submission origin is not allowed.', 403);
  }
  return configured;
}

function base64Url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function derLength(length) {
  if (length < 0x80) return Uint8Array.of(length);

  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concatBytes(...arrays) {
  const length = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithmIdentifier = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09,
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const privateKey = concatBytes(
    Uint8Array.of(0x04),
    derLength(pkcs1.length),
    pkcs1,
  );
  const body = concatBytes(version, rsaAlgorithmIdentifier, privateKey);
  return concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
}

function pemToPkcs8(pem) {
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const isPkcs1 = normalized.includes('-----BEGIN RSA PRIVATE KEY-----');
  const isPkcs8 = normalized.includes('-----BEGIN PRIVATE KEY-----');

  if (!isPkcs1 && !isPkcs8) {
    throw new Error('GitHub App private key must be a PEM RSA private key.');
  }

  const body = normalized
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  if (!body) throw new Error('GitHub App private key is empty.');

  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return (isPkcs1 ? wrapPkcs1AsPkcs8(bytes) : bytes).buffer;
}

async function createAppJwt(env) {
  const appId = requireEnv(env, 'GITHUB_APP_ID');
  const privateKeyPem = requireEnv(env, 'GITHUB_PRIVATE_KEY');

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64Url(signature)}`;
}

/**
 * @param {string} url
 * @param {{
 *   token?: string,
 *   method?: string,
 *   body?: unknown,
 *   allow404?: boolean,
 *   appJwt?: boolean,
 * }} [options]
 * @returns {Promise<any>}
 */
async function githubJson(url, options = {}) {
  const {
    token,
    method = 'GET',
    body,
    allow404 = false,
    appJwt = false,
  } = options;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (allow404 && response.status === 404) return null;

  if (!response.ok) {
    let message = `GitHub API returned ${response.status} ${response.statusText}.`;
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch {
      // Keep HTTP status.
    }
    throw httpError(
      appJwt
        ? `GitHub App authentication failed: ${message}`
        : `GitHub repository request failed: ${message}`,
    response.status >= 500 ? 502 : 500);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function installationToken(env) {
  const jwt = await createAppJwt(env);
  const installationId = requireEnv(env, 'GITHUB_INSTALLATION_ID');
  const { repo } = repositoryConfig(env);

  const payload = await githubJson(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      token: jwt,
      method: 'POST',
      appJwt: true,
      body: {
        repositories: [repo],
        permissions: { contents: 'write' },
      },
    },
  );

  if (!payload?.token) {
    throw new Error('GitHub App installation token response did not include a token.');
  }
  return payload.token;
}

function contentUrl(config, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${GITHUB_API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encoded}`;
}

async function getContent(token, config, path, raw = false) {
  const response = await fetch(
    `${contentUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`,
    {
      headers: {
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    let message = `GitHub API returned ${response.status} ${response.statusText}.`;
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch {
      // Keep HTTP status.
    }
    throw new Error(`GitHub repository read failed: ${message}`);
  }

  return raw ? response.text() : response.json();
}

async function writeFile(token, config, path, bytes, message) {
  return githubJson(contentUrl(config, path), {
    token,
    method: 'PUT',
    body: {
      message,
      content: arrayBufferToBase64(bytes),
      branch: config.branch,
    },
  });
}

async function deleteFile(token, config, path, sha, message) {
  return githubJson(contentUrl(config, path), {
    token,
    method: 'DELETE',
    body: {
      message,
      sha,
      branch: config.branch,
    },
  });
}

async function verifyTurnstile(request, env, token) {
  const secret = requireEnv(env, 'TURNSTILE_SECRET_KEY');
  if (typeof token !== 'string' || token.trim() === '' || token.length > 2048) {
    throw httpError('Complete the anti-bot verification before submitting.', 400);
  }

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
    },
  );

  if (!response.ok) {
    throw httpError('Anti-bot verification service is temporarily unavailable.', 503);
  }

  const result = await response.json();
  if (!result?.success) {
    throw httpError('Anti-bot verification failed or expired. Try the challenge again.', 400);
  }

  const expectedHostname = requireEnv(env, 'TURNSTILE_EXPECTED_HOSTNAME');
  if (result.hostname !== expectedHostname) {
    throw httpError('Anti-bot verification hostname did not match the Tune Viewer site.', 403);
  }

  const expectedAction = env.TURNSTILE_EXPECTED_ACTION?.trim() || 'submit_tune';
  if (result.action !== expectedAction) {
    throw httpError('Anti-bot verification action did not match this submission.', 403);
  }
}

async function assertDestinationUnused(token, config, tuneId) {
  const existing = await getContent(token, config, `public/tunes/${tuneId}`);
  if (existing !== null) {
    throw httpError(
      `Tune ID "${tuneId}" already exists. Public submissions can create new tunes or revisions, not overwrite existing tunes.`,
    409);
  }
}

async function readLiveMetadata(token, config, tuneId) {
  assertPublicTuneId(tuneId, 'Lineage Tune ID');
  const raw = await getContent(
    token,
    config,
    `public/tunes/${tuneId}/metadata.json`,
    true,
  );
  if (raw === null) {
    throw httpError(`Lineage tune "${tuneId}" does not exist on main.`, 409);
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw httpError(`Lineage tune "${tuneId}" has invalid repository metadata.`, 409);
  }

  if (!metadata || typeof metadata !== 'object' || metadata.id !== tuneId) {
    throw httpError(`Lineage tune "${tuneId}" metadata identity is invalid.`, 409);
  }
  return metadata;
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])]),
    );
  }
  return value;
}

function assertParentSnapshotMatches(liveMetadata, expectedRaw, parentTuneId) {
  if (!expectedRaw) return;

  let expected;
  try {
    expected = JSON.parse(expectedRaw);
  } catch {
    throw httpError('Loaded parent metadata snapshot is invalid.', 409);
  }

  if (
    JSON.stringify(canonicalizeJson(liveMetadata))
    !== JSON.stringify(canonicalizeJson(expected))
  ) {
    throw httpError(
      `Lineage parent "${parentTuneId}" changed after this page was loaded. Reload before submitting the revision.`,
    409);
  }
}

async function assertLiveLineage(
  token,
  config,
  tuneId,
  parentTuneId,
  expectedParentMetadataRaw,
) {
  if (!parentTuneId) return;

  const seen = new Set([tuneId]);
  let cursor = parentTuneId;
  let first = true;

  while (cursor) {
    assertPublicTuneId(cursor, 'Lineage parent Tune ID');
    if (seen.has(cursor)) {
      throw httpError(`Lineage would create a cycle through "${cursor}".`, 409);
    }
    seen.add(cursor);

    const metadata = await readLiveMetadata(token, config, cursor);
    if (first && expectedParentMetadataRaw) {
      assertParentSnapshotMatches(metadata, expectedParentMetadataRaw, cursor);
    }
    first = false;
    if (metadata.parentTuneId === undefined) break;
    if (typeof metadata.parentTuneId !== 'string' || !metadata.parentTuneId.trim()) {
      throw httpError(`Lineage tune "${cursor}" has invalid parentTuneId metadata.`, 409);
    }
    cursor = metadata.parentTuneId;
  }
}

async function readRegistry(token, config) {
  const raw = await getContent(
    token,
    config,
    'public/definitions/registry.json',
    true,
  );
  if (raw === null) throw new Error('Definition registry is missing from the repository.');

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Definition registry is invalid JSON.');
  }
}

async function cleanupCreated(token, config, created, tuneId) {
  const failures = [];

  for (const entry of [...created].reverse()) {
    try {
      const current = await getContent(token, config, entry.path);
      if (!current || current.type !== 'file') continue;
      if (current.sha !== entry.sha) {
        failures.push(`${entry.path}: changed after staging`);
        continue;
      }

      await deleteFile(
        token,
        config,
        entry.path,
        current.sha,
        `Cleanup failed public tune submission ${tuneId} [skip ci]`,
      );
    } catch (error) {
      failures.push(
        `${entry.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return failures;
}

async function submitTune(request, env, origin) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw httpError('Public tune submission requires multipart/form-data.', 415);
  }

  const form = await request.formData();
  const metadataRaw = form.get('metadata');
  const msq = form.get('msq');
  const ini = form.get('ini');
  const turnstileToken = form.get('turnstileToken');
  const parentMetadataSnapshot = form.get('parentMetadataSnapshot');

  if (typeof metadataRaw !== 'string') {
    throw httpError('metadata field is required.', 400);
  }
  if (!(msq instanceof File)) {
    throw httpError('MSQ file is required.', 400);
  }
  if (ini !== null && !(ini instanceof File)) {
    throw httpError('INI field must be a file when supplied.', 400);
  }

  const metadataBytes = textBytes(metadataRaw);
  const parentSnapshotBytes =
    typeof parentMetadataSnapshot === 'string'
      ? textBytes(parentMetadataSnapshot)
      : 0;
  const iniBytes = ini instanceof File ? ini.size : 0;
  const total = metadataBytes + parentSnapshotBytes + msq.size + iniBytes;
  if (
    metadataBytes > MAX_METADATA_BYTES
    || parentSnapshotBytes > MAX_METADATA_BYTES
    || msq.size > MAX_MSQ_BYTES
    || iniBytes > MAX_INI_BYTES
    || total > MAX_TOTAL_BYTES
  ) {
    throw httpError('Public submission exceeds the service file-size limits.', 413);
  }

  await verifyTurnstile(
    request,
    env,
    typeof turnstileToken === 'string' ? turnstileToken : '',
  );

  const config = repositoryConfig(env);
  const token = await installationToken(env);
  const msqText = await msq.text();
  const iniText = ini instanceof File ? await ini.text() : undefined;
  const registry = iniText === undefined ? await readRegistry(token, config) : { definitions: [] };
  const publishedAt = new Date().toISOString().slice(0, 10);

  const metadata = validatePublicPackage({
    metadata: metadataRaw,
    msqText,
    iniText,
    registry,
    publishedAt,
  });

  await assertDestinationUnused(token, config, metadata.id);
  await assertLiveLineage(
    token,
    config,
    metadata.id,
    metadata.parentTuneId,
    typeof parentMetadataSnapshot === 'string' ? parentMetadataSnapshot : undefined,
  );

  const basePath = `public/tunes/${metadata.id}`;
  const created = [];

  try {
    const msqResult = await writeFile(
      token,
      config,
      `${basePath}/tune.msq`,
      await msq.arrayBuffer(),
      `Stage public tune ${metadata.id}: tune.msq [skip ci]`,
    );
    if (!msqResult?.content?.sha) throw new Error('GitHub did not return tune.msq identity.');
    created.push({ path: `${basePath}/tune.msq`, sha: msqResult.content.sha });

    if (ini instanceof File) {
      const iniResult = await writeFile(
        token,
        config,
        `${basePath}/mainController.ini`,
        await ini.arrayBuffer(),
        `Stage public tune ${metadata.id}: mainController.ini [skip ci]`,
      );
      if (!iniResult?.content?.sha) throw new Error('GitHub did not return INI identity.');
      created.push({
        path: `${basePath}/mainController.ini`,
        sha: iniResult.content.sha,
      });
    }

    const metadataBytesOut = new TextEncoder().encode(
      JSON.stringify(metadata, null, 2) + '\n',
    ).buffer;
    const finalResult = await writeFile(
      token,
      config,
      `${basePath}/metadata.json`,
      metadataBytesOut,
      [
        `Public tune: ${metadata.title}`,
        '',
        `Tune ID: ${metadata.id}`,
        `Firmware: ${metadata.firmwareSignature}`,
        'Submitted through the public Tune Viewer service',
      ].join('\n'),
    );

    return {
      ok: true,
      tuneId: metadata.id,
      validationStatus: metadata.validationStatus,
      commitSha: finalResult?.commit?.sha || '',
      commitUrl:
        finalResult?.commit?.html_url
        || `https://github.com/${config.owner}/${config.repo}/commit/${finalResult?.commit?.sha || ''}`,
    };
  } catch (error) {
    const cleanupFailures = await cleanupCreated(token, config, created, metadata.id);
    if (cleanupFailures.length) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} `
        + `Cleanup was incomplete: ${cleanupFailures.join('; ')}.`,
      );
    }
    throw error;
  }
}

export default {
  async fetch(request, env) {
    let origin = env.PUBLIC_SITE_ORIGIN?.replace(/\/$/, '') || '*';

    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/health') {
        return jsonResponse({
          ok: true,
          service: 'EpicEFI Tune Viewer public submission',
          publicCreateOnly: true,
          githubAccountRequired: false,
        }, 200, origin);
      }

      origin = assertOrigin(request, env);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(origin),
        });
      }

      if (request.method === 'POST' && url.pathname === '/v1/submissions') {
        const result = await submitTune(request, env, origin);
        return jsonResponse(result, 201, origin);
      }

      return jsonResponse({ error: 'Not found.' }, 404, origin);
    } catch (error) {
      const status = publicErrorStatus(error);
      const safeStatus = status >= 400 && status <= 599 ? status : 500;
      const message = safeStatus >= 500
        ? 'The public submission service could not complete this request.'
        : (error instanceof Error ? error.message : String(error));

      console.error('public submission error', error);
      return jsonResponse({ error: message }, safeStatus, origin);
    }
  },
};
