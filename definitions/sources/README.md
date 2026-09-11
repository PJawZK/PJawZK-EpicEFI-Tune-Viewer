# Definition sources

Each directory under this folder represents one EpicEFI firmware definition that should be available automatically in the Tune Viewer.

## Folder format

```text
definitions/sources/
└── <definition-id>/
    ├── mainController.ini
    └── metadata.json       # optional
```

The folder ID must already be lowercase/path-safe, for example:

```text
mega144h7-2026-08-26-2273317132
```

The INI itself is authoritative for the TunerStudio firmware signature and all viewer UI/settings metadata.

## Optional metadata.json

```json
{
  "ecuTarget": "MEGA144H7",
  "label": "MEGA144H7 · 2026-08-26 · 2273317132",
  "source": "EpicEFI release 2026-08-26",
  "expectedSignature": "rusEFI master.2026.08.26.MEGA144H7.2273317132"
}
```

- `ecuTarget`: only required if it cannot be inferred safely from the signature.
- `label`: human-readable registry label.
- `source`: provenance text shown in registry metadata.
- `expectedSignature`: optional guard against placing the wrong INI in this folder.

## Generated files

Do not hand-edit files under `public/definitions/generated/` or `public/definitions/registry.json`.

`npm run definitions` regenerates them from these source folders and rejects duplicate firmware signatures.
