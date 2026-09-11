# EpicEFI definition registry

The Tune Viewer uses an exact-signature public definition registry so a user normally only needs to open an `.msq`.

## Runtime layout

The deployed registry lives under `public/definitions/`:

```text
public/definitions/
├── registry.json
└── mega144h7/
    └── 2026-08-26-2273317132/
        └── definition-pack.json.gz
```

`registry.json` maps the exact TunerStudio firmware signature to a compact definition pack and records its SHA-256 digest.

The current first registered definition is:

- ECU target: `MEGA144H7`
- signature: `rusEFI master.2026.08.26.MEGA144H7.2273317132`
- settings: 5,584
- TableEditor definitions: 122
- compact gzip size: about 54 KiB

The pack was derived from the exact generated `mainController.ini` used for the first real browser acceptance test. It contains viewer metadata rather than the full generated INI: setting identities/types/offsets/units, table bindings and the dynamic label data required by the current viewer.

## Safety rule

Definition resolution is exact-signature only.

If the MSQ signature is not present in the registry, the viewer asks for the exact matching `mainController.ini` locally. It must not silently select a different firmware version.

## Future publication

The intended production path is for EpicEFI firmware CI to publish/update definition packs and the registry whenever supported firmware builds are produced. The viewer itself should not need source changes to add another registered definition.
