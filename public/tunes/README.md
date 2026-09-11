# Public tune catalog

This directory is the static prototype catalog used by the GitHub Pages Tune Hub.

Local files opened in the viewer remain private unless the user explicitly publishes them.

## Preferred trusted-writer submission path

1. Open the Tune Viewer website.
2. Go to **Submit Tune** (`#/submit`).
3. Load the EpicEFI MSQ.
4. Supply its exact matching `mainController.ini` only when that firmware signature is not already registered.
5. Complete the required public metadata and badge selections.
6. Enter a GitHub fine-grained personal access token for an account with write permission to this repository.
7. Choose **Upload to main**.

The browser publishes:

```text
public/tunes/
└── <tune-id>/
    ├── metadata.json
    ├── tune.msq
    └── mainController.ini   # only when no exact registry definition exists
```

No temporary branch, fork or pull request is created.

The uploader uses GitHub's Contents API because that endpoint explicitly supports fine-grained personal access tokens with **Contents: write** repository permission.

Tune assets are written first with CI-skipping staging commits. `metadata.json` is written last and triggers the normal catalog/build validation. If staging fails, the browser attempts to remove any staging files it already created.

The browser checks the live `main` tree immediately before publishing and rejects an already-existing `public/tunes/<tune-id>/` folder.

## Access requirements

Direct-main publishing is intentionally limited to trusted repository writers.

For a fine-grained token:

- Resource owner: `PJawZK`
- Repository access: only `PJawZK-EpicEFI-Tune-Viewer`
- Repository permissions: **Contents → Read and write**

Metadata read access is supplied by GitHub.

A token without effective write access to this repository cannot publish directly. Those users should use the ZIP fallback.

The token is held only in page memory and is not stored in localStorage/sessionStorage, metadata, ZIP files, commits or application logs.

## ZIP fallback

**Download submission ZIP instead** remains available for manual/offline contribution.

The ZIP contains:

```text
<tune-id>/
├── metadata.json
├── tune.msq
├── mainController.ini   # only when required
└── SUBMISSION.txt
```

The ZIP is built from the original browser File objects and includes size-sanity checks so an unexpectedly inflated archive is blocked instead of downloaded.

## Repository-side validation

Do not edit `public/tunes/index.json` manually. The build regenerates it.

CI independently verifies:

- metadata schema and supported fields
- unique, lowercase-safe tune ID
- referenced files exist and use safe local names
- `metadata.firmwareSignature` exactly matches the committed MSQ signature
- when an INI is present, its exact signature matches the MSQ
- when no INI is present, the exact MSQ signature exists in the generated firmware-definition registry
- registered ECU target matches tune metadata
- validation/classification values
- `parentTuneId` references an existing tune

Because direct-main publishing validates after the final metadata commit lands, a bad direct submission can remain in repository history even though the build/Pages deployment fails. Browser validation and repository CI are therefore both retained.

## Publication rules

Every published tune must:

- contain a valid MSQ
- use its exact firmware definition
- provide a validation status
- provide a tune classification
- use only supported metadata fields and safe file names
- reference an existing tune when `parentTuneId` is used

`EpicEFI Verified` is reserved for an EpicEFI-controlled approval process and must not be self-assigned.

Do not publish private/customer tunes, credentials, logs, or unrelated files.

Published tunes are reference material. Validation/classification badges do not make a tune safe for another engine or vehicle.
