# Definition sources

Each leaf directory under this folder represents one EpicEFI firmware definition that should be available automatically in the Tune Viewer.

The built-in EpicEFI definitions are curated as **firmware milestones**, not as a mirror of every daily firmware build. A milestone is kept when the release contains meaningful engine-control functionality, important safety/reliability fixes, or a substantial compatibility expansion. Cosmetic-only changes such as wording, labels, help text, menu layout, or dashboard presentation do not create a new built-in milestone.

## Built-in release layout

Milestone releases are grouped first by release date, then by ECU/hardware target:

```text
definitions/sources/
└── releases/
    ├── 2026-08-26/
    │   ├── MEGA144H7/
    │   │   ├── mainController.ini
    │   │   └── metadata.json
    │   ├── epicECU/
    │   │   ├── mainController.ini
    │   │   └── metadata.json
    │   └── ...
    └── 2026-09-11/
        └── ...
```

The registry builder searches recursively for directories containing `mainController.ini`, so user-contributed definitions can still live in their own folders without needing to follow the built-in release hierarchy.

## Current curated milestones

- **2025-12-02** — earliest normal archived release set; includes the H7 flash/save freeze-stall fix.
- **2026-03-30** — major safety/stability generation: fuel-pressure safety cut, H7 knock fixes, low-voltage injection/ignition protection, priming fixes, trigger filtering, PWM fixes, and ETB limp-mode improvements.
- **2026-07-31** — stable pre-August checkpoint with trigger/flash safeguards, stepper-idle fixes, DFCO-after-start protection, learned-idle save safeguards, and rotational/forced-idle fixes.
- **2026-08-10** — tune load/write hardening, unsafe resizable tables reverted, SD-card startup protection, injection-disable correctness, launch-control fix, and DFCO improvements.
- **2026-08-26** — major feature milestone with the newer TPS AE engagement model, instant-pulse scaling, tip-in ignition retard, ETB idle-valve support, alternator idle compensation, frequency/duty sensors, Ford TFI support, and accumulated August reliability fixes.
- **2026-09-11** — current reference milestone.

Simulator bundles are not included as built-in ECU hardware definitions.

## Preferred user submission path

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

Add that folder anywhere under `definitions/sources/` in a pull request.

## Folder format

Every definition leaf directory contains:

```text
<definition-folder>/
├── mainController.ini
└── metadata.json
```

The INI itself is authoritative for the TunerStudio firmware signature and all viewer UI/settings metadata.

## metadata.json

A milestone definition uses metadata such as:

```json
{
  "ecuTarget": "MEGA144H7",
  "release": "2026-08-26",
  "label": "MEGA144H7 · 2026-08-26",
  "source": "EpicEFI firmware milestone 2026-08-26",
  "expectedSignature": "rusEFI master.2026.08.26.MEGA144H7.2273317132"
}
```

- `ecuTarget`: firmware/ECU target.
- `release`: optional release/milestone label.
- `label`: human-readable registry label.
- `source`: provenance text.
- `expectedSignature`: exact-signature guard; CI fails if the INI does not match it.

## Exact-signature rule

The Tune Viewer does not approximate firmware compatibility. A tune uses a built-in definition only when its firmware signature exactly matches a registry entry. Tunes outside the curated milestone set can still be opened by supplying their own matching INI, and users may contribute useful missing definitions later.

## Generated files

Do not hand-edit files under `public/definitions/generated/` or `public/definitions/registry.json`.

`npm run definitions` regenerates them from the recursive source tree, rejects duplicate firmware signatures, compresses viewer packs and records SHA-256 integrity metadata.
