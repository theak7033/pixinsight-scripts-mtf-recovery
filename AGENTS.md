# Agent instructions — pixinsight-scripts-mtf-recovery

Read this first. It is the brief for any agent (Claude, Codex, etc.) working in this repo.

## What this is

A PixInsight script, **ObstructionCorrection**, that restores the contrast a telescope's
**central obstruction** (secondary mirror) removes at medium spatial frequencies. It filters
a linear image with `H = MTF_clear / MTF_obstructed`.

"MTF" in the repo name is the optical **modulation** transfer function. It is **not**
PixInsight's midtones transfer function; an earlier version of this file got that wrong.

Full design, numbers, milestones and open questions: [PLAN.md](PLAN.md). Follow it.

## Status

- 2026-11-12: v0.1 written — full portable math (MTFs, bands, kernel builder, FFT), dialog
  with the telescope drop-down, processing pipeline (PixelMath channel extraction →
  `Convolution` in Image mode → PixelMath write-back, saturated-star protection).
- 2026-11-12: **first run inside PixInsight** (Windows, owner's RASA 8 RGB stack, 6226×4139,
  FITS FOCALLEN 400 / XPIXSZ 3.76, no plate solution). Verified there:
  - Process enums live on the **constructor** under V8 (`PixelMath.Gray` = 2, `.SameAsTarget` = 0,
    `.f32` = 4; `Convolution.Parametric` = 0, `.Image` = 2). `X.prototype.Enum` is `undefined`.
  - `Convolution` in Image mode applies a kernel with negative values as-is (no clipping or
    renormalising); hidden windows, `createNewImage`, `truncate*`, `forceClose` all work.
  - End to end on synthetic white noise: measured noise gain R/G/B ×1.211 / ×1.162 / ×1.133
    vs kernel prediction ×1.211 / ×1.163 / ×1.134; means preserved.
  - `Settings` stores strings **8-bit** (an em dash came back as U+0014): keep stored strings ASCII.
  - Setting `NumericControl.setValue` / `ComboBox.currentItem` from code fires no events.
  - `image.median()`, view keywords, `ViewList`, Cancel path work.
- 2026-11-12, v0.1.1: same stack **plate-solved** with ImageSolver. Verified there:
  - The solution matrix is the view property `AstrometricSolution:LinearTransformationMatrix`
    (**no** `PCL:` prefix; only `PCL:AstrometricSolution:Generation:*` / `Grid:*` carry it), a
    2×2 `Matrix` in degrees per pixel read with `at( r, c )`. √|det|·3600 = 1.938″/px, equal to
    the solver's own figure. ImageSolver also rewrites `FOCALLEN` (400.118 mm).
  - PixelMath's new image has **no keywords and no properties**. `win.keywords = src.keywords`
    and `win.copyAstrometricSolution( src )` carry them over (`copyMetadata`).
  - A typed focal length does not override a solution scale; the original image is untouched.
  - Install via Feature Scripts and discovery through the update repository URL both work.
- 2026-11-12, v0.2.0: **Ideal aperture** mode (`MODE_IDEAL_APERTURE` = 2): Wiener-limited inverse of
  the band-averaged obstructed MTF, `H = M(1+k)/(M^2+k)`, `k = wienerK( maxBoost )` so H never exceeds
  Max boost; kernels get twice the room on oversampled data (`chooseKernelSize( c, mode )`).
  Verified in PixInsight on synthetic white noise, RASA 8 at 1.938"/px, max boost 3: measured noise
  R/G/B x1.405 / x1.317 / x1.262 vs kernel prediction x1.406 / x1.318 / x1.263; read-out x1.71, +32 %.
- 2026-11-12, v0.2.0: **refractors** — obstruction may be 0 (control range 0-70 %). With 0 %,
  restore-only / true-equivalent do nothing, so `main()` logs "Nothing to do" and the read-out
  points to the Ideal aperture mode; ideal mode inverts the clear MTF. Verified in PixInsight on
  synthetic noise, 80 mm, 0 %, 1.616"/px, max boost 3: measured noise R/G/B x1.898 / x1.673 /
  x1.534 vs prediction x1.899 / x1.673 / x1.536. The OPTICS list still has no refractors (the
  owner's unobstructed rows were left out); refractors use Custom.
- 2026-11-12, v0.2.0 dialog: **Optics** combo (`OPTICS_OBSTRUCTED` / `OPTICS_REFRACTOR`, setting
  `opticsType`). Refractor hides the telescope row, obstruction and mode (`visible = false`, then
  `adjustToContents()`; verified to work in PixInsight) and forces eps 0 + diffraction removal.
  Mode items are `MODE_ITEMS` (plain names); `modeDescription()` text sits under the combo and
  changes with it; Max boost is shown only for diffraction removal. Log names via `modeName()`.
  Real RedCat 91 / ASI294MM R stack (1.066"/px, stars 4.43"): max boost 1.5 -> FWHM 4.12",
  MAD x1.31; max boost 3 -> FWHM 4.00", MAD x2.08 (seeing-limited: diffraction ~1.5").
- Still not run inside PixInsight: in-place mode with a mask, mono images, *True equivalent*
  mode, installing the package through Check for Updates (restart), a visual check of the result.
- Not built yet (PLAN.md milestones 6–7): noise-aware weighting, MTF plot, in-PixInsight
  synthetic test script. The update repository (`repository/`, served from `main`) exists.

- The `OPTICS` table (telescope drop-down) holds the 12 obstructed optics from the owner's
  spreadsheet. Never add entries from memory or the web without the owner's say-so; only
  records with an obstruction are shown in the list.

## Layout

```
src/scripts/ObstructionCorrection/ObstructionCorrection.js   the single self-contained script
tools/selftest.js        tests the portable math block + parse-checks the script
tools/smoketest.js       unit + end-to-end tests of the PixInsight-side code against a fake PixInsight;
                         fails if any named function or method is never entered
tools/test.sh            runs selftest with Node, or macOS jsc when Node is absent
tools/build-package.sh   zips src/scripts into repository/ and updates repository/updates.xri
repository/              update repository served from main: package zip + updates.xri
docs/images/             README screenshots
```

## Commands

```bash
tools/test.sh                    # after every change
tools/build-package.sh 0.2.0     # release time only: then commit repository/ and push to main
```

## Hard rules for the script (PixInsight 1.9.4+, V8 engine)

Conventions follow https://github.com/awitwicki/PI-Scripts; its CLAUDE.md explains the why.

- `#engine v8` is the literal first line. `#feature-id` is `Id : Category > Label`.
  `#feature-info` is one line, no `\` continuation.
- Call `CoreApplication.ensureMinimumVersion( 1, 9, 4 )` right after the directives.
- One self-contained file: no `#include` of project files. PixInsight's own
  `<pjsr/*.jsh>` headers are required for every constant family used (`TextAlign_*`,
  `UndoFlag_*`, `StdIcon_*`, `DataType_*`, ...); a missing one only fails when that line runs.
- Dialogs: `var D = class extends Dialog { constructor() { super(); ... } }`. The old
  `this.__base__ = Dialog` idiom throws under V8.
- Top-level `try/catch` logs `e && e.message ? e.message : String( e )`; native errors are
  often plain strings.
- `View.viewById( id )` returns `null` when missing; `ImageWindow.windowById( id )` returns
  an object with `.isNull`.
- All engine-free math lives between the `BEGIN/END portable obstruction math` markers and
  uses no PixInsight globals. `tools/selftest.js` extracts exactly that block, so add a test
  there for every function added to it, and export the new name in the extraction list.

## Testing

- `tools/test.sh` covers JS syntax, the math block, and unit tests of everything else
  against a fake PixInsight. Add a test for every new function: the coverage check fails
  the run otherwise. The
  fake accepts any property or method name, so it cannot catch a wrong PixInsight API name.
- `jsc`'s `quit()` ignores its exit code; the test files throw to signal failure. Keep that.
- GUI, process calls and image I/O can only be tested **inside PixInsight**, by the owner.
  Never report those as working from the self-test alone; say what was and was not run.
- The machine this was scaffolded on has no PixInsight and no Node (jsc is used). The owner's
  Windows PC has PixInsight and Node; on Windows set `git config core.autocrlf false` in the
  clone, or CRLF checkouts fail the `#engine v8` first-line test.

## Conventions

- 3-space indent and spaced parentheses, as in the reference repo.
- Never commit image data (`*.xisf`, `*.fits`, `*.tif`); use synthetic test images.
- The GitHub token lives outside the repo; never write it into git config, scripts or docs.
- Commit or push only when the owner asks.
