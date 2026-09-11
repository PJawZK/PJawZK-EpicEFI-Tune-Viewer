# EpicEFI definition registry

The definition registry is an optional future convenience layer for the Tune Viewer. It must not limit the viewer to one firmware, board, or release.

## Core compatibility rule

Every tune is interpreted only against an **exact matching firmware definition**.

If a firmware signature is not available in a public registry, the user can load the exact matching `mainController.ini` locally. The viewer must never silently choose a nearby version or another ECU target.

## Current prototype state

The active public registry is intentionally empty while the Tune Hub and INI-driven browser are developed.

```text
public/definitions/
└── registry.json
```

This means V0.3 does not have a hardcoded supported-firmware list. Arbitrary EpicEFI firmware can be tested by supplying its matching INI.

## Future registry

A mature registry may contain many independently versioned definitions:

```text
definitions/
├── registry.json
├── mega144h7/
│   ├── <firmware-a>/
│   └── <firmware-b>/
├── another-target/
│   └── <firmware-c>/
└── ...
```

A registry entry should be keyed by the complete TunerStudio signature and should include integrity metadata for the corresponding viewer definition pack.

## Intended publication path

The preferred long-term path is for EpicEFI firmware CI to publish/update definition packs whenever supported firmware builds are produced. The viewer frontend should not need source changes when another firmware definition is added.

The registry remains separate from tune-library publication: a public tune may reference a known registry definition or include/require its exact custom INI when appropriate.
