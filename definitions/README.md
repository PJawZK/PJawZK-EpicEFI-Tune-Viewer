# EpicEFI definition registry

The definition registry is an automatic convenience layer for the Tune Viewer. It is **not** a whitelist of supported firmware.

Any EpicEFI tune can still be opened with its exact matching local `mainController.ini`. Registry entries simply let common firmware definitions resolve automatically from the MSQ signature.

## Source-driven registry

Authoritative definition sources live under:

```text
definitions/sources/
└── <definition-id>/
    ├── mainController.ini
    └── metadata.json       # optional
```

The normal build runs:

```text
npm run definitions
```

That command:

1. reads every source `mainController.ini`;
2. parses it with the same `src/ini.ts` parser used by the browser;
3. reads the exact TunerStudio firmware signature;
4. determines the ECU target from the signature or optional metadata;
5. rejects duplicate firmware signatures;
6. packs settings, tables, menus, dialogs, curves and label sets;
7. gzip-compresses the viewer definition pack;
8. calculates SHA-256 for the compressed pack;
9. writes generated packs under `public/definitions/generated/`;
10. regenerates `public/definitions/registry.json`.

No React source changes are needed to add another firmware.

## Runtime layout

Generated output looks like:

```text
public/definitions/
├── registry.json
└── generated/
    ├── mega144h7/
    │   ├── firmware-a/
    │   │   └── definition-pack.json.gz
    │   └── firmware-b/
    │       └── definition-pack.json.gz
    └── another-target/
        └── firmware-c/
            └── definition-pack.json.gz
```

The viewer looks up a tune by its **complete exact firmware signature**. It never chooses a nearby release or another target.

## Optional metadata

A source folder may contain:

```json
{
  "ecuTarget": "MEGA144H7",
  "label": "MEGA144H7 · 2026-08-26 · 2273317132",
  "source": "EpicEFI release 2026-08-26",
  "expectedSignature": "rusEFI master.2026.08.26.MEGA144H7.2273317132"
}
```

`expectedSignature` is a useful CI guard: if the wrong INI is placed in that source folder, the build fails rather than silently publishing it under the wrong release identity.

## Generated files

Do not hand-edit:

- `public/definitions/registry.json`
- anything under `public/definitions/generated/`

They are build outputs.

## Long-term firmware CI integration

The intended production path is for EpicEFI firmware CI to provide generated `mainController.ini` definitions to this source layout (or an equivalent publication mechanism) whenever firmware releases are produced.

The registry remains separate from tune publication. A published tune may use a registry definition or include its exact custom INI when no registry entry exists.
