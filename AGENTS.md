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
- Still not run inside PixInsight: in-place mode with a mask, mono images, plate-solved images,
  *True equivalent* mode, install via Feature Scripts, a visual check of the result.
- Not built yet (PLAN.md milestones 6–7): noise-aware weighting, MTF plot, in-PixInsight
  synthetic test script, update-repository manifest.

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
tools/build-package.sh   zips src/scripts for a PixInsight update repository
repository/              built package + updates.xri (added at release)
docs/images/             README screenshots
```

## Commands

```bash
tools/test.sh                    # after every change
tools/build-package.sh 0.1.0     # release time only
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
