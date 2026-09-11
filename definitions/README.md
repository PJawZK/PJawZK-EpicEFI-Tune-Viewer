# EpicEFI definition registry

This directory will hold browser-readable EpicEFI firmware definitions.

The registry is intentionally empty during the first MSQ-parser bootstrap. The next milestone is to add one authoritative Mega144H7 `mainController.ini` and a small manifest that binds the exact firmware signature to that INI.

Planned structure:

```text
definitions/
└── mega144h7/
    └── <firmware-id>/
        ├── mainController.ini
        └── definition.json
```

A tune must not silently fall back to a different firmware definition. Unknown or mismatched signatures must be visible to the user.
