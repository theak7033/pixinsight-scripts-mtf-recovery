# Usage statistics (for the maintainer)

After each run ObstructionCorrection posts one row of anonymous usage statistics to a Google
Form; the linked Google Sheet then has **one row per run and one column per parameter**, ready
to sort, filter and pivot. Nothing is written to the PixInsight console. Until `TELEMETRY.url`
is filled in, the script sends nothing and hides its checkbox.

## Where the data is

- Form: **ObstructionCorrection usage** (Google Drive of the maintainer's account), published
  with access "anyone with the link"; no e-mail collection, no sign-in.
- Sheet: **ObstructionCorrection usage (responses)**, locale *United States* so that `1.938` is
  stored as a number (a comma-decimal locale would turn it into text or even a date).

## Columns

| Column | Key | Example |
| --- | --- | --- |
| Event | `event` | `run` or `error` |
| Script version | `script` | `0.3.0` |
| PixInsight version | `pi` | `1.9.6-0` |
| OS | `os` | `Windows` |
| Installation ID | `install` | random, 16 hex digits, one per installation |
| Optics | `optics` | `obstructed` / `refractor` |
| Telescope | `telescope` | `Celestron RASA 8`, `custom`, `refractor` |
| Aperture (mm) | `aperture_mm` | `203` |
| Obstruction (%) | `obstruction_pct` | `45.8` |
| Image scale (arcsec/px) | `scale_arcsec` | `1.938` |
| Scale source | `scale_source` | `solution`, `fits`, `fields` |
| Colour | `color` | `RGB` / `mono` |
| Bands | `bands` | `R/G/B`, `L`, `Ha` |
| Mode | `mode` | `restore obstruction loss`, `exact unobstructed equivalent`, `remove all diffraction`, `refractor: remove diffraction` |
| Amount | `amount` | `1` |
| Max boost | `max_boost` | `3` (diffraction removal only) |
| Protect stars | `protect_stars` | `yes` / `no` |
| In place | `in_place` | `yes` / `no` |
| Megapixels | `megapixels` | `25.8` |
| Run time (s) | `seconds` | `6.2` |
| Error | `error` | message of a failed run, file paths replaced by `<path>` |

Useful views: distinct installations = `COUNTUNIQUE` of *Installation ID*; a pivot table of
*Mode* × *Optics*; filter *Event* = `error` to see what fails.

## Adding a column

1. In the form add a **Short answer** question (duplicate an existing one to keep the type).
2. Open the public form and read the new question's id: in the browser console,
   `document.querySelectorAll('[data-params]')` — the number after `[[` is the entry id.
3. Add `key: "entry.<id>"` to `TELEMETRY.fields` and fill `r.key` in `telemetryRecord()`.
4. Add the key to the column list in `tools/smoketest.js`, run `tools/test.sh`, release.

## What is never sent

Image data, file names or paths, FITS keywords, object names, coordinates or site locations.
The installation id is random and kept only in PixInsight's settings.
