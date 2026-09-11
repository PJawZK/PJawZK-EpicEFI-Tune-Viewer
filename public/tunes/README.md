# Public tune catalog

This directory is the static prototype catalog used by the GitHub Pages Tune Hub.

Local files opened in the viewer remain private unless the user explicitly submits them.

## Preferred submission path

1. Open the Tune Viewer website.
2. Go to **Submit Tune** (`#/submit`).
3. Load the EpicEFI MSQ.
4. Supply its exact matching `mainController.ini` only when that firmware signature is not already registered.
5. Complete the required public metadata and badge selections.
6. Choose **Submit to GitHub**.
7. Authenticate with a GitHub access token in the page.
8. The browser creates a submission branch (or fork branch) and opens a pull request.

The browser never writes directly to `main`.

For repository collaborators, the token needs repository **Contents: write** and **Pull requests: write** permissions. Non-collaborator fork creation/synchronization may require additional GitHub permissions.

## Published folder format

A tune PR publishes only:

```text
public/tunes/
└── <tune-id>/
    ├── metadata.json
    ├── tune.msq
    └── mainController.ini   # only when no exact registry definition exists
```

When the exact firmware signature already exists in the public definition registry, the INI is deliberately not duplicated with the tune.

## ZIP fallback

**Download submission ZIP instead** remains available for manual/offline contribution.

The ZIP also contains `SUBMISSION.txt` with instructions. That instruction file is for the contributor and does not need to be copied into the published tune folder.

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

This validation is authoritative even if a contributor bypasses the browser submission form.

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
