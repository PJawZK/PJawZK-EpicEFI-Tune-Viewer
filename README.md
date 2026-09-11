# EpicEFI Tune Viewer

A browser-based EpicEFI tune viewer and tune-library prototype.

This repository is the GitHub-hosted proving ground for a future EpicEFI tune sharing service. It is intentionally read-only: local tune viewing does not write to an ECU and does not publish files opened from your computer.

## Current prototype

V0.3 focuses on the useful tune-browsing workflow familiar from TunerStudio and HyperTuner:

- Open an EpicEFI TunerStudio `.msq` locally in the browser.
- Read tune metadata and the exact firmware signature.
- Load the exact matching `mainController.ini` for any EpicEFI firmware.
- Reconstruct the tune navigation from the INI's `[Menu]` structure.
- Render nested dialogs and panels from `[UserDefined]`.
- Render scalar and enum values read-only with units and setting names.
- Render `[CurveEditor]` curves.
- Render `[TableEditor]` calibration tables.
- Evaluate common TunerStudio visibility conditions without JavaScript `eval`.
- Preserve raw definition/settings and flat table views as diagnostic fallbacks.
- Keep local file viewing private.

The viewer must not silently interpret a tune with a definition from a different firmware signature.

## Firmware compatibility

There is no single required EpicEFI firmware or ECU board.

The core compatibility path is:

```text
MSQ
 ↓
read exact firmware signature
 ↓
matching mainController.ini
 ↓
INI-defined menus / dialogs / curves / tables
```

During the GitHub prototype phase, a user can load the exact matching `mainController.ini` locally. A future definition registry may make this automatic for many firmware releases, but that registry is a convenience layer rather than a compatibility gate.

## Tune-library direction

The next prototype stage will add the tune-site workflow:

- searchable Tune Hub
- vehicle/engine metadata
- permanent tune pages
- Info / Tune / Download / Share views
- validation badges and tune classification
- repository-backed public tune submissions during the GitHub prototype phase

## Validation model

Published tunes will carry a **validation status** separately from their **classification**.

Validation examples: Unverified, Starts/Idles, Driven, Road Tested, Performance Tested, Track Tested, Dyno Tested, EpicEFI Verified.

Classification examples: Normal, Experimental, Base Tune, Development.

This allows combinations such as **Road Tested + Experimental** without confusing test coverage with tune purpose.

`EpicEFI Verified` is reserved for an EpicEFI-controlled approval process if one is established.

## Deliberately deferred

- ECU write/control
- log viewing
- user accounts/authentication
- stars/favorites
- server-side tune uploads
- automatic tune-quality claims

## Architecture

The prototype is static-first:

- React + TypeScript + Vite
- browser-local MSQ/INI loading
- INI-driven tune UI
- GitHub Actions validation
- GitHub Pages deployment
- repository-backed tune metadata planned next

The frontend data model is kept independent from storage so a future EpicEFI-hosted API/database can replace the repository-backed prototype without rewriting the tune viewer.

## HyperTuner relationship

HyperTuner Cloud and HyperTuner INI tooling are useful open-source references for the tune-sharing and INI-driven UI model. HyperTuner projects are MIT licensed. Any reused source will retain required license and attribution notices.

- HyperTuner Cloud: https://github.com/hyper-tuner/hypertuner-cloud
- HyperTuner INI parser: https://github.com/hyper-tuner/ini

## Status

**V0.3 prototype in development.** INI-driven tune navigation is being added before the public Tune Hub/search/share layer.
