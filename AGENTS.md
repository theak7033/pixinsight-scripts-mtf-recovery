# Agent instructions — pixinsight-scripts-mtf-recovery

Read this first. It is the brief for any agent (Claude, Codex, etc.) working in this repo.

## Status

- Repo created 2026-11-12. No code yet.
- The original design discussion happened in claude.ai chats that were **not** available
  when this file was written. The spec below is a reconstruction from the project name and
  standard PixInsight math. Anything marked **[ASSUMPTION]** must be confirmed with the
  owner before it is built on; update this file when it is.

## Goal

A PixInsight script (PJSR, JavaScript) that **recovers linear data from an image that was
non-linearly stretched with a Midtones Transfer Function (MTF)**, i.e. undoes a
HistogramTransformation / ScreenTransferFunction stretch so the image can go back into
linear-stage processing (deconvolution, color calibration, noise reduction, etc.).

Typical use cases [ASSUMPTION]:
1. The user applied an STF permanently (STF → HistogramTransformation) too early and wants
   the linear image back.
2. The user has only a stretched image (e.g. a delivered TIFF / JPEG-derived XISF) plus the
   stretch parameters, or needs them estimated.

## The math

PixInsight's midtones transfer function with midtones balance `m` (0 < m < 1):

```
MTF(m, x) = ((m - 1) * x) / ((2m - 1) * x - m)      MTF(m,0)=0, MTF(m,m)=0.5, MTF(m,1)=1
```

A HistogramTransformation with shadows clip `c0`, midtones `m`, highlights clip `c1`
(expansion range r0=0, r1=1) maps:

```
x' = MTF(m, clamp((x - c0) / (c1 - c0), 0, 1))
```

Key identity: **the inverse of MTF(m, ·) is MTF(1 - m, ·)**. So the recovery is

```
x = c0 + (c1 - c0) * MTF(1 - m, x')
```

In PixelMath this is one expression per channel (PixelMath has a built-in `mtf(m, x)`):

```
c0 + (c1 - c0) * mtf(1 - m, $T)
```

Limits to document in the UI and README:
- Pixels clipped to 0 (below c0) or 1 (above c1) are **not recoverable**: they come back as
  exactly c0 / c1.
- 8/16-bit sources lose precision in the shadows after inversion (quantization is
  amplified). Work in 32-bit float; warn when the source is integer.
- Any further non-linear step (curves, LHE, HDRMT, noise reduction on stretched data)
  breaks exact inversion; the result is then only approximately linear.

## Where the stretch parameters come from

Support these sources, in priority order [ASSUMPTION — confirm scope]:

1. **Manual entry**: c0, m, c1 per channel (R/G/B or linked/L).
2. **From the image's processing history**: read the HistogramTransformation instance
   applied to the view (view history / process icon / ProcessContainer) and take its
   parameters.
3. **Reproduce PixInsight's AutoSTF** on a *reference linear image* (same data, before
   stretch) to get the exact params the default STF would have used:
   - `MADN = 1.4826 * MAD`
   - `c0 = clamp(median + shadowsClipping * MADN, 0, 1)` with shadowsClipping = -2.8
   - `m = MTF(targetBackground, median - c0)` with targetBackground = 0.25
   - `c1 = 1`
   - Linked (one set for all channels) or unlinked (per channel) — offer both.
4. **Estimate only from the stretched image** (no reference): impossible to do exactly;
   if implemented, label it clearly as an approximation. Not in v1 unless the owner asks.

## Script requirements

- Language: PixInsight JavaScript Runtime (PJSR). Single entry file
  `src/MTFRecovery.js`, helpers in `src/lib/*.jsh` via `#include`.
- Header directives:
  ```
  #feature-id    Utilities > MTFRecovery
  #feature-info  Recovers linear data from an MTF/HistogramTransformation-stretched image.
  ```
  plus `#include <pjsr/...>` for the constants used (StdButton, StdIcon, Sizer helpers,
  UndoFlag, etc.).
- Dialog (`Dialog` subclass):
  - Target view selector (`ViewList`).
  - Parameter source: Manual / From history / AutoSTF on reference view.
  - Per-channel c0 / m / c1 (`NumericControl`), with a "Linked channels" checkbox.
  - Option: create a new image vs. modify the target in place (default: new image, named
    `<id>_linear`).
  - OK / Cancel; restore last-used parameters via `Settings`.
- Processing: build a `PixelMath` instance with per-channel expressions
  (`expression`, `expression1`, `expression2`, `useSingleExpression = false` when
  unlinked), `rescale = false`, `truncate = true`, output 32-bit float. Run it with
  `executeOn(view)`; wrap in `view.beginProcess(UndoFlag_NoSwapFile)` / `endProcess()` when
  modifying in place, so it is undoable.
- Validate input: 0 < m < 1, 0 ≤ c0 < c1 ≤ 1; refuse otherwise with a clear message.
- Log the used parameters to the Process Console (`console.writeln`) so the run is
  reproducible.
- Support grayscale and RGB. Mono images use channel 0 only.

## Repo layout (target)

```
src/MTFRecovery.js        entry point (dialog + run)
src/lib/MTFMath.jsh       mtf(), inverse, AutoSTF param computation (pure functions)
src/lib/MTFDialog.jsh     UI
tests/                    PJSR test script(s) — see Testing
README.md                 user docs: install, usage, limitations
AGENTS.md                 this file
CLAUDE.md                 points here
```

## Testing

There is no Node/CI runtime for PJSR; tests run **inside PixInsight**.
- `tests/RoundTripTest.js`: create a synthetic linear image (gradient + noise), stretch it
  with a known HistogramTransformation (c0, m, c1), run the recovery, and assert
  max |original − recovered| < 1e-5 for unclipped pixels. Cover linked and unlinked RGB,
  m near 0 and near 1, c0 > 0.
- Keep the math in `MTFMath.jsh` free of PixInsight objects so it can also be checked
  quickly with plain `node` (load the file as text and eval) — optional, nice to have.
- When you change code, say which tests you ran and where (PixInsight version), or say
  explicitly that they could not be run.

## Install (for README)

PixInsight → Script → Feature Scripts… → Add → select the `src` folder → Done. The script
appears under Script > Utilities > MTFRecovery. Or run directly via
Script > Run Script File… → `src/MTFRecovery.js`.

## Conventions

- 2-space indent, `var`/`function` style compatible with PJSR's engine; avoid ES features
  the PixInsight runtime does not support (check the PixInsight version in use).
- Never commit image data (`*.xisf`, `*.fits`, `*.tif`) — use synthetic test images.
- Commits: small, imperative messages. The GitHub token lives outside the repo; never
  write it into git config, scripts or docs.

## Open questions for the owner

1. Exact scope from the original chats: is the main case "undo my STF/HT stretch" or
   something else (e.g. recovering after GHS / arcsinh, or matching two stretches)?
2. Which parameter sources are required in v1 (manual / history / AutoSTF reference /
   estimate)?
3. Target PixInsight version.
4. In-place vs. new image default.
5. Anything else decided in the chats (names, UI layout, extra features) — add it here.
