# EpicEFI base-map profiles

Source: https://content.epicefi.com/base_maps/

The Tune Hub includes 19 complete root-level MSQ + INI pairs from the EpicEFI base-map library, imported on 2026-09-11.

These entries are intentionally cataloged as:

- Classification: **Base Tune**
- Validation: **Unverified**
- Version label: **EpicEFI Base Map**

Metadata is conservative. Author, vehicle, engine and hardware labels are derived from the original file names and accompanying source TXT descriptions where available. The original tune data is not modified.

## Exact firmware definitions

Each published base tune must pass the Tune Viewer's existing exact-signature validation.

One source pair required correction at import time:

- `VictorTH - 1UZ Turbo Base-M144F7RED`: the base-map site's INI had signature `rusEFI master.2026.01.05.M144F7RED.1240587255`, while its MSQ requires `rusEFI master.2026.01.08.M144F7RED.2084742931`.
- The catalog therefore uses the exact matching INI from `firmware/2026-01-08/rusefi_bundle_M144F7RED.zip`, member `rusefi.snapshot.M144F7RED/rusefi_M144F7RED.ini`.

The MSQ itself remains the original base-map file.

## Source items not published as usable profiles

The following source items were intentionally excluded from the Tune Hub catalog:

- `Dcwerx - Subaru 6-7 basemap.ini` — INI only; no matching MSQ is present in the base-map root.
- `Immrpablo - KAMARO - k24a4 vtec killer no vvt - NA Ignition table.msq` — MSQ only. Its signature is `rusEFI master.2024.10.18.uaefi.1537376161`, and no exact matching definition is currently registered in Tune Viewer.
- `incomplete/` — excluded because the source library explicitly labels these files incomplete.
- `partials/` — excluded because these are partial calibration/table snippets rather than complete tune profiles.

These exclusions should be reconsidered if matching files or authoritative metadata become available later.
