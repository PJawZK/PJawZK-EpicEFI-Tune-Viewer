# EpicEFI Tune Viewer

A browser-based EpicEFI tune viewer and tune-library prototype.

This repository is the GitHub-hosted proving ground for a future EpicEFI tune sharing service. The first milestone is intentionally small: open a real EpicEFI TunerStudio `.msq`, match it to the correct EpicEFI `mainController.ini`, and render tune settings and tables accurately in the browser.

## V0.1 goals

- Open EpicEFI `.msq` files locally in the browser.
- Read tune metadata and firmware signature.
- Automatically resolve registered EpicEFI definitions by exact firmware signature.
- Fall back to a manually selected exact `mainController.ini` for unknown/development firmware.
- Render scalar values, selections, curves and tables.
- Keep local file viewing private: opening a file does not publish it.
- Support a small repository-backed test tune library.
- Require validation status and tune classification metadata for every published library tune.
- Deploy the static prototype through GitHub Pages.

## Deliberately out of scope for V0.1

- User accounts.
- Server-side uploads.
- Database/backend services.
- ECU write/control.
- Log viewing.
- Automatic tune quality claims.

## Validation model

Published tunes must carry a **validation status** separately from their **classification**.

Validation examples: Unverified, Starts/Idles, Driven, Road Tested, Performance Tested, Track Tested, Dyno Tested, EpicEFI Verified.

Classification examples: Normal, Experimental, Base Tune, Development.

This allows combinations such as **Road Tested + Experimental** without confusing test coverage with tune purpose.

## Architecture direction

The prototype is static-first:

- React + TypeScript + Vite frontend.
- Browser-local `.msq` loading.
- EpicEFI INI definition registry stored in this repository.
- Repository-backed test tune metadata.
- GitHub Actions validation and GitHub Pages deployment.

The frontend data model will remain independent of storage so a future EpicEFI-hosted API/database can replace the repository-backed index without rewriting the viewer.

## HyperTuner relationship

HyperTuner Cloud and its INI tooling are being evaluated as open-source reference/dependency candidates. HyperTuner projects are MIT licensed. Any reused source will retain required license and attribution notices.

- HyperTuner Cloud: https://github.com/hyper-tuner/hypertuner-cloud
- HyperTuner INI parser: https://github.com/hyper-tuner/ini

## Status

**V0.2 prototype.** Local MSQ viewing now supports exact-signature automatic definition resolution for registered firmware. No production tune-hosting service exists yet.
