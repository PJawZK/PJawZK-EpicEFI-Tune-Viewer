# Definition sources

Each directory under this folder represents one EpicEFI firmware definition that should be available automatically in the Tune Viewer.

## Preferred submission path

Use the browser definition builder:

```text
#/definitions/submit
```

It parses the selected `mainController.ini` locally, reads its exact firmware signature, shows settings/table/curve/dialog/menu coverage, checks the current registry for duplicates, and creates a repository-ready ZIP.

Nothing is uploaded automatically.

The generated package has this structure:

```text
<definition-id>/
├── mainController.ini
├── metadata.json
└── SUBMISSION.txt
```

Add that folder under `definitions/sources/` in a pull request.

## Folder format

```text
definitions/sources/
└── <definition-id>/
    ├── mainController.ini
    └── metadata.json
```

The folder ID must already be lowercase/path-safe, for example:

```text
mega144h7-2026-08-26-2273317132
```

The INI itself is authoritative for the TunerStudio firmware signature and all viewer UI/settings metadata.

## metadata.json

The builder generates:

```json
{
  "ecuTarget": "MEGA144H7",
  "label": "MEGA144H7 · 2026-08-26 · 2273317132",
  "source": "EpicEFI release 2026-08-26",
  "expectedSignature": "rusEFI master.2026.08.26.MEGA144H7.2273317132"
}
```

- `ecuTarget`: firmware/ECU target.
- `label`: human-readable registry label.
- `source`: provenance text.
- `expectedSignature`: exact-signature guard; CI fails if the INI does not match it.

## Generated files

Do not hand-edit files under `public/definitions/generated/` or `public/definitions/registry.json`.

`npm run definitions` regenerates them from these source folders, rejects duplicate firmware signatures, compresses viewer packs and records SHA-256 integrity metadata.
