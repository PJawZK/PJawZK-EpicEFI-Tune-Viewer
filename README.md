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

The catalog includes curated EpicEFI base-map profiles plus explicitly published user tunes. Local files are never promoted into it automatically.

## EpicEFI base-map profiles

The Tune Hub includes 19 complete root-level MSQ + INI pairs from the official EpicEFI base-map library. They are presented as generic **Base Tune / Unverified** profiles, with searchable author, vehicle, engine and ECU metadata inferred conservatively from the source labels and accompanying descriptions.

Every imported profile is still subject to the same exact firmware-signature gate as any other published tune. If the base-map library's supplied INI does not match its MSQ, the import uses an exact matching definition from the EpicEFI firmware archive rather than weakening the signature check.

Source/import details and intentionally excluded incomplete items are documented in `public/tunes/BASE_MAP_IMPORT_NOTES.md`.

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
- creates a corrected repository-ready ZIP from the original browser File objects
- omits duplicate INIs when the exact firmware definition is already registered
- can publish the validated tune directly into `main` for trusted repository writers

For direct submission, the browser uses a GitHub access token held only in page memory. The token is never stored in browser storage or written into tune metadata, ZIPs, commits or logs.

Trusted repository writers publish the tune folder directly to `main` with no temporary branch, fork or pull request. The browser uses GitHub's Contents API: tune assets are staged with CI-skipping commits and `metadata.json` is written last to trigger the authoritative catalog/build validation.

Users without write permission cannot use direct-main publishing and can use the ZIP fallback instead.

The ZIP option remains available for manual/offline submission.

## Tune lineage and revisions

Published tunes can use `parentTuneId` as an explicit lineage relationship.

The **Lineage** tab now acts as a revision-history view:

- chronological ancestor/current chain
- Root / Current / Latest state markers
- publication date and same-ID edit date
- previous-revision navigation
- next-revision navigation, including branches
- all descendants derived from the current tune
- version label and Tune ID visibility

**Edit tune** keeps the same Tune ID. The original `publishedAt` remains while `updatedAt` represents a later edit of that same identity.

**Create revision** publishes a new Tune ID, locks the source as its parent, resets validation to `Unverified`, and suggests a lineage-wide revision identity such as `-r2` with version label `R2`.

Tune Hub cards show lightweight Root/Revision/version cues without replacing the existing validation/classification badges.

Repository validation rejects missing lineage parents, self-parenting and circular ancestry.

## Author pages

Published author names now link to metadata-derived author pages at `#/author/<author>`.

Author pages provide:

- all currently published tunes attributed to that exact author name
- published tune count
- ECU target summary
- vehicle and engine summary
- search within the author's tunes
- ECU-target and classification filters
- newest/oldest/title sorting

These are catalog views derived from tune metadata, not authenticated user-account profiles.

## Tune Hub discovery

V0.10 expands the public Tune Hub from a basic searchable list into a metadata-driven discovery view.

The Hub now provides:

- All / Base Maps / Community tune scope
- ECU-target filtering
- vehicle-make filtering
- engine filtering
- author filtering
- validation, classification and aspiration filters
- catalog summary counts
- one-click filter reset
- visually distinct EpicEFI Base Map cards
- lightweight lineage cues retained from V0.9

Published tune info pages also show related tunes ranked from explicit metadata such as engine, vehicle, ECU target, aspiration, fuel, tags and lineage. The UI exposes the matching reasons and does not treat similarity as a compatibility or safety claim.

## Structured Tune Hub collections

V0.10.1 adds collection-style browsing on top of the existing search/filter experience.

Routes include:

- `#/browse` — collection overview
- `#/browse/base-maps` — EpicEFI Base Maps
- `#/browse/vehicles` — vehicle makes
- `#/browse/vehicle/<make>/<model>` — vehicle collection
- `#/browse/engines` — engine make/code groups
- `#/browse/engine/<make>/<code>` — engine collection
- `#/browse/ecus` — ECU targets
- `#/browse/ecu/<target>` — ECU target collection
- `#/browse/authors` — published authors

Collection detail pages retain tune search, validation/classification filters and sorting.

Vehicle, engine and ECU metadata on Tune Hub cards, author tune cards and published tune info pages link directly into the matching collection. Author names continue to use their existing author pages.

## Richer tune presentation

V0.10.2 improves how published tunes are evaluated at a glance without adding image or thumbnail requirements.

Tune Hub, collection and author cards now surface:

- stronger validation-state hierarchy
- revision/base-map identity
- compact power, torque, boost and injector metrics when metadata exists
- concise firmware summaries while preserving the exact signature on the tune page
- original publication date and later same-ID edit date
- tighter tag presentation
- clearer Base Map identity

Published tune Info pages now begin with an **At a glance** summary showing vehicle, engine, ECU target, fuel/aspiration, key metrics, firmware summary, validation state, tune identity and publication/update state.

Base Maps receive a dedicated reference-starting-point safety callout. Exact firmware signature matching remains the compatibility authority.

## Deliberately deferred

- ECU write/control
- log viewing
- full account/OAuth authentication service
- stars/favorites
- direct server-side tune storage
- automatic tune-quality claims

## Architecture

The prototype is static-first:

- React + TypeScript + Vite
- browser-local MSQ/INI loading
- INI-driven tune UI
- GitHub Actions validation
- GitHub Pages deployment
- repository-backed tune metadata
- browser-local submission packaging
- explicit trusted-writer browser-to-GitHub direct-main submission

The frontend data model is kept independent from storage so a future EpicEFI-hosted API/database can replace the repository-backed prototype without rewriting the tune viewer.

## HyperTuner relationship

HyperTuner Cloud and HyperTuner INI tooling are useful open-source references for the tune-sharing and INI-driven UI model. HyperTuner projects are MIT licensed. Any reused source will retain required license and attribution notices.

- HyperTuner Cloud: https://github.com/hyper-tuner/hypertuner-cloud
- HyperTuner INI parser: https://github.com/hyper-tuner/ini

## Status

**V0.10.2 prototype.** Tune Hub, collection and author cards now expose a clearer validation/tune-state hierarchy, compact performance metrics, firmware summaries and publication/update state. Published tune Info pages add an At a glance summary and stronger Base Map reference treatment. V0.10.1 structured collections, V0.10 facets/related-tune discovery, V0.9 lineage/history/author pages and the V0.8 compare/direct-publish workflows remain in place.


## Multi-firmware definition pipeline

Registered firmware definitions are generated from source INIs under `definitions/sources/<definition-id>/`.

The normal build runs `npm run definitions` before the tune catalog and web build. It uses the same `src/ini.ts` parser as the browser, then generates compact gzip definition packs and `public/definitions/registry.json`.

This is an automatic convenience layer only. Unknown/development firmware can still be opened or submitted with its exact matching local `mainController.ini`.


## Firmware Definitions UI

The GitHub Pages prototype includes:

- `#/definitions` — browse/search exact registered firmware definitions and inspect settings/table/curve/dialog/menu coverage plus SHA-256 integrity metadata.
- `#/definitions/submit` — parse an EpicEFI `mainController.ini` locally, detect its exact signature and ECU target, reject duplicate registered signatures, and create a source ZIP for `definitions/sources/<definition-id>/`.

Nothing is uploaded automatically. The V0.6 CI pipeline remains authoritative for turning source INIs into compact public registry packs.


## Tune Compare

The local comparison tool is available at:

```text
#/compare
```

Each side resolves its exact firmware definition independently through the public registry or a matching local `mainController.ini`.

When both tunes use the same exact firmware signature, Tune Compare provides:

- changed/unchanged scalar setting counts
- INI-derived menu/category grouping
- setting search and changed-only filtering
- Tune A / Tune B values and numeric deltas
- table Tune A / Tune B / absolute delta / percentage delta views
- changed-cell counts and axis-change warnings
- overlaid curves using INI-defined axes
- per-point curve deltas
- JSON comparison report export

When firmware signatures differ, only the shared-name scalar intersection is shown. Tables and curves are intentionally disabled because Tune Viewer does not assume cross-version semantic equivalence from matching names alone.

Tune Compare is read-only and does not write to an ECU or upload local tune files.
