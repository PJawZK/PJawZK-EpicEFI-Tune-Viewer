# Public tune catalog

This directory is the static prototype catalog used by the GitHub Pages Tune Hub.

Local files opened in the viewer or submission builder are never copied into this directory automatically.

## Preferred submission path

1. Open the Tune Viewer website.
2. Go to **Submit Tune** (`#/submit`).
3. Load the EpicEFI MSQ.
4. Supply its exact matching `mainController.ini` unless that firmware signature already has an exact public definition.
5. Complete the required public metadata and badge selections.
6. Download the generated submission ZIP.
7. Add the ZIP's tune folder under `public/tunes/` in a pull request.

The generated folder has this form:

```text
public/tunes/
└── <tune-id>/
    ├── metadata.json
    ├── tune.msq
    ├── mainController.ini   # present when required/provided
    └── SUBMISSION.txt
```

Do not edit `public/tunes/index.json` manually. The build validates tune folders and regenerates the index automatically.

## Publication rules

Every published tune must:

- have a unique, lowercase-safe tune ID
- contain a valid MSQ
- declare the exact firmware signature from that MSQ
- either include its matching `mainController.ini` or resolve to an exact public definition
- provide a validation status
- provide a tune classification
- use only supported metadata fields and safe local file names
- reference an existing tune when `parentTuneId` is used

`EpicEFI Verified` is reserved for an EpicEFI-controlled approval process and must not be self-assigned.

Do not publish private/customer tunes, credentials, logs, or unrelated files.

Published tunes are reference material. Validation/classification badges do not make a tune safe for another engine or vehicle.
