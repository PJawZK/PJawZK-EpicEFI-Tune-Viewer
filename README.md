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

## Tune Hub

The GitHub Pages root is now the public Tune Hub. The existing local-file viewer is available at `#/local`.

Published tune routes use hash navigation so they work reliably on GitHub Pages:

- `#/t/<id>/info`
- `#/t/<id>/tune`
- `#/t/<id>/download`
- `#/t/<id>/share`

The static prototype catalog is generated from folders under `public/tunes/<id>/`. Each tune supplies `metadata.json`, an MSQ and optionally an exact matching INI. The build validates the catalog before deployment.

The catalog currently starts empty intentionally; local files are never promoted into it automatically.

## Validation model

Published tunes will carry a **validation status** separately from their **classification**.

Validation examples: Unverified, Starts/Idles, Driven, Road Tested, Performance Tested, Track Tested, Dyno Tested, EpicEFI Verified.

Classification examples: Normal, Experimental, Base Tune, Development.

This allows combinations such as **Road Tested + Experimental** without confusing test coverage with tune purpose.

`EpicEFI Verified` is reserved for an EpicEFI-controlled approval process if one is established.

## Submit Tune

The GitHub prototype now includes a browser-local submission builder at `#/submit`.

The builder:

- parses the selected MSQ locally
- uses the MSQ firmware signature as authoritative
- checks for an exact registered definition
- requires a matching local `mainController.ini` when the signature is not registered
- blocks mismatched definitions
- collects vehicle, engine and calibration metadata
- requires explicit validation and classification selection
- does not allow a user to self-assign `EpicEFI Verified`
- checks the proposed tune ID against the current public catalog
- creates a repository-ready ZIP locally in the browser

The generated package is not uploaded automatically. During the GitHub prototype phase it is added under `public/tunes/<tune-id>/` through a pull request, where GitHub Actions validates the metadata and file references before the tune can appear in the Hub.

## Deliberately deferred

- ECU write/control
- log viewing
- user accounts/authentication
- stars/favorites
- direct server-side tune uploads
- automatic GitHub PR creation
- automatic tune-quality claims

## Architecture

The prototype is static-first:

- React + TypeScript + Vite
- browser-local MSQ/INI loading
- INI-driven tune UI
- GitHub Actions validation
- GitHub Pages deployment
- repository-backed tune metadata and browser-local submission packaging

The frontend data model is kept independent from storage so a future EpicEFI-hosted API/database can replace the repository-backed prototype without rewriting the tune viewer.

## HyperTuner relationship

HyperTuner Cloud and HyperTuner INI tooling are useful open-source references for the tune-sharing and INI-driven UI model. HyperTuner projects are MIT licensed. Any reused source will retain required license and attribution notices.

- HyperTuner Cloud: https://github.com/hyper-tuner/hypertuner-cloud
- HyperTuner INI parser: https://github.com/hyper-tuner/ini

## Status

**V0.6 prototype.** The Tune Hub, local viewer, published-tune routes and submission builder remain in place. Firmware definitions are now source-driven: CI can parse any EpicEFI `mainController.ini`, generate compact SHA-256-verified viewer packs, reject duplicate signatures, and rebuild the public multi-firmware registry without React source changes.


## Multi-firmware definition pipeline

Registered firmware definitions are generated from source INIs under `definitions/sources/<definition-id>/`.

The normal build runs `npm run definitions` before the tune catalog and web build. It uses the same `src/ini.ts` parser as the browser, then generates compact gzip definition packs and `public/definitions/registry.json`.

This is an automatic convenience layer only. Unknown/development firmware can still be opened or submitted with its exact matching local `mainController.ini`.
