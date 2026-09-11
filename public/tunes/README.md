# Public tune catalog

This directory is the static prototype catalog used by the GitHub Pages Tune Hub.

The catalog intentionally starts empty. Local files opened in the browser are never copied into this directory automatically.

A published tune will use a structure like:

```text
public/tunes/
├── index.json
└── <tune-id>/
    ├── metadata.json
    ├── tune.msq
    └── mainController.ini   # optional when an exact public definition exists
```

Every catalog entry must use an exact firmware signature. A published tune must either include its matching `mainController.ini` or resolve to an exact definition in the public definition registry.

Do not publish private/customer tunes, credentials, logs, or unrelated files.
