# EpicEFI Tune Viewer public submission service

This Worker is the no-GitHub-account publication path for Tune Viewer.

It is deliberately **create-only**:

- create a new Tune ID
- create a new revision with `parentTuneId`
- never edit or overwrite an existing Tune ID
- always publish public submissions as `Unverified`

Trusted repository writers continue to use the browser PAT path for same-ID edits and administrative publication.

## Security model

The browser never receives GitHub credentials.

The Worker:

1. accepts the Tune Viewer form as `multipart/form-data`
2. validates Cloudflare Turnstile server-side
3. validates Tune ID, metadata, MSQ signature, optional INI signature and exact firmware-definition availability
4. checks the destination Tune ID against live `main`
5. validates lineage against live `main`
6. authenticates as a GitHub App installation
7. stages `tune.msq` and optional `mainController.ini`
8. writes `metadata.json` last so normal repository CI/deployment remains authoritative
9. removes its own staged files if publication fails

The GitHub App should be installed only on:

`PJawZK/PJawZK-EpicEFI-Tune-Viewer`

and require only repository **Contents: Read and write** permission.

Public submissions cannot grant themselves `EpicEFI Verified` or any other higher validation state. The service rewrites the submitted validation status to `Unverified`.

## 1. Create the GitHub App

Create a GitHub App owned by `PJawZK`.

Recommended settings:

- name: e.g. **EpicEFI Tune Viewer Public Submission**
- webhook: disabled / not required
- repository permission: **Contents — Read and write**
- account permissions: none
- install on **Only select repositories**
- select **PJawZK-EpicEFI-Tune-Viewer**

After installation, record:

- App ID
- Installation ID

Generate a private key from the GitHub App settings. GitHub downloads this as a PKCS#1 PEM key; the Worker converts it to PKCS#8 internally for Web Crypto.

Do not commit the private key.

## 2. Create Turnstile

Create a Cloudflare Turnstile widget for the Tune Viewer hostname.

Record:

- site key — public, used by GitHub Pages
- secret key — private, stored only in the Worker

The Worker validates every Turnstile token with Siteverify. Client-side completion alone is not accepted.

## 3. Configure the Worker

Copy:

`submission-service/wrangler.toml.example`

to:

`submission-service/wrangler.toml`

The real file is gitignored.

Set `PUBLIC_SITE_ORIGIN` to the exact Tune Viewer origin, without a trailing slash.

Then store secrets with Wrangler:

```sh
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_INSTALLATION_ID
wrangler secret put GITHUB_PRIVATE_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

For the private key, paste the full PEM including its BEGIN/END lines.

Optional:

```sh
wrangler secret put TURNSTILE_EXPECTED_HOSTNAME
```

Deploy from `submission-service/` using the copied Wrangler configuration.

The service exposes:

- `GET /health`
- `POST /v1/submissions`

## 4. Enable the public path in GitHub Pages

In the repository's GitHub Actions **Variables**, add:

- `PUBLIC_SUBMISSION_ENDPOINT` — Worker origin, e.g. `https://epicefi-tune-viewer-submissions.<account>.workers.dev`
- `TURNSTILE_SITE_KEY` — Turnstile public site key

The Pages workflow maps those to:

- `VITE_PUBLIC_SUBMISSION_ENDPOINT`
- `VITE_TURNSTILE_SITE_KEY`

If either value is absent, Tune Viewer shows the public submission feature as not enabled and the trusted-writer path continues to work normally.

## Public submission rules

A public submission is accepted only when:

- the Tune ID is valid and unused
- required metadata is structurally valid
- the MSQ has an exact firmware signature
- metadata signature exactly matches the MSQ
- if an INI is bundled, its signature exactly matches the MSQ
- if no INI is bundled, the exact firmware signature exists in the repository definition registry
- registered ECU target, when specified by the registry, matches metadata
- lineage parent exists on live `main`
- lineage is not circular
- a revision source has not changed since the page loaded
- Turnstile validation succeeds

Unknown/new firmware remains supported by bundling the exact matching `mainController.ini`.

## Abuse controls

Turnstile is mandatory in the service.

For production, also configure Cloudflare rate limiting for `POST /v1/submissions`. Rate limiting belongs at the edge rather than trusting a browser-side counter.

The service intentionally does not expose edit/delete endpoints for anonymous users.
