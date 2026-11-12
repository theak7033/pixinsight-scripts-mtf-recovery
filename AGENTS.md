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
- **Never run inside PixInsight yet.** `tools/test.sh` passes, but that is math plus a
  fake-PixInsight smoke run. The first real run by the owner is the next step; expect
  API-name fixes. Unverified calls: negative-valued kernel view accepted by `Convolution`,
  PixelMath `createNewImage` properties and enum names, `Settings` round trip,
  `ComboBox` / `NumericControl` event names, `image.median()`.
- Not built yet (PLAN.md milestones 6–7): noise-aware weighting, MTF plot, in-PixInsight
  synthetic test script, update-repository manifest.

- The `OPTICS` table (telescope drop-down) holds the 12 obstructed optics from the owner's
  spreadsheet. Never add entries from memory or the web without the owner's say-so; only
  records with an obstruction are shown in the list.

## Layout

```
src/scripts/ObstructionCorrection/ObstructionCorrection.js   the single self-contained script
tools/selftest.js        tests the portable math block + parse-checks the script
tools/smoketest.js       runs the whole script against a fake PixInsight (catches JS slips only)
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

- `tools/test.sh` covers JS syntax, the math block and a fake-PixInsight smoke run. The
  fake accepts any property or method name, so it cannot catch a wrong PixInsight API name.
- `jsc`'s `quit()` ignores its exit code; the test files throw to signal failure. Keep that.
- GUI, process calls and image I/O can only be tested **inside PixInsight**, by the owner.
  Never report those as working from the self-test alone; say what was and was not run.
- The machine this was scaffolded on has no PixInsight and no Node (jsc is used).

## Conventions

- 3-space indent and spaced parentheses, as in the reference repo.
- Never commit image data (`*.xisf`, `*.fits`, `*.tif`); use synthetic test images.
- The GitHub token lives outside the repo; never write it into git config, scripts or docs.
- Commit or push only when the owner asks.
