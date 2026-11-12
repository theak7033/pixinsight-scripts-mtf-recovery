# Plan — central-obstruction contrast recovery script for PixInsight

Status: proposal, nothing built yet. Written 2026-11-12.

## 0. Fix the brief first

`AGENTS.md` and `README.md` in this repo describe a **different script**. They were
reconstructed from the repo name and read "MTF" as PixInsight's *midtones* transfer
function (undoing an STF/HistogramTransformation stretch). The actual idea is the optical
**modulation** transfer function: a secondary mirror lowers contrast at medium spatial
frequencies, and the script gives that contrast back.

Any agent that opens the repo today would build the wrong tool, so step 1 of the work is
replacing both files with the spec below.

Working name: **ObstructionCorrection**. "MTFRecovery" invites the same midtones mix-up
inside PixInsight, where MTF nearly always means midtones.

## 1. What the script does

A telescope with a central obstruction of ratio ε = d/D (secondary diameter / aperture) has
a lower diffraction MTF than a clear aperture of the same diameter over roughly 5–60 % of
the cutoff frequency, and a slightly higher one above that. The script multiplies the
image spectrum by

```
H(f) = MTF_clear(f) / MTF_obstructed(f, ε)
```

Everything else in the imaging chain (seeing, tracking, pixel) multiplies both MTFs
equally, so the result is the image the **same aperture would have recorded without the
secondary, under the same seeing**. Consequences:

- No PSF measurement and no iteration: H follows from four numbers (D, d, image scale, wavelength).
- H is real and positive, so the filter is zero-phase and adds no ringing of its own.
- H(0) = 1, so flux and background level are preserved.
- The gain is bounded, unlike a general deconvolution:

| ν / cutoff | ε = 0.25 | ε = 0.35 | ε = 0.46 |
| --- | --- | --- | --- |
| 0.10 | ×1.05 | ×1.08 | ×1.14 |
| 0.20 | ×1.11 | ×1.21 | ×1.40 |
| 0.30 | ×1.17 | ×1.42 | ×1.85 |
| peak | ×1.23 at 0.38 | ×1.51 at 0.35 | ×1.93 at 0.36 |
| above (1+ε)/2 | ×0.94 | ×0.88 | ×0.79 |

Above (1+ε)/2 the ratio is exactly 1 − ε². These numbers come from a check script run for
this plan; the overlap-area formula it uses agrees with O'Neill's closed form to 2e-15.

## 2. What to expect (and what not)

The correction is exact, but it only helps where the scene still has signal. Long-exposure
seeing removes most of the band where H is large:

| Aperture | Seeing | Seeing MTF left at ν = 0.10 / 0.15 / 0.20 |
| --- | --- | --- |
| 130 mm | 2.5″ | 0.64 / 0.42 / 0.24 |
| 200 mm | 2.5″ | 0.40 / 0.17 / 0.06 |
| 280 mm | 2.5″ | 0.20 / 0.04 / 0.01 |
| 200 mm | 1.5″ | 0.68 / 0.46 / 0.29 |

- **Deep-sky, 130–150 mm obstructed scopes** (small Newtonians, Epsilon, Mak): a real gain of
  roughly 10–30 % in medium-scale contrast.
- **Deep-sky, 200 mm and larger in average seeing**: about 5–15 %, at scales of several
  arcseconds. Seeing-limited data from a C11/C14 gains almost nothing.
- **Lunar, planetary, solar stacks**: the full ×1.2–1.9, because lucky imaging keeps the band.
- Noise: at full strength, white-noise sigma rises 4–35 % for ε ≤ 0.35 and up to 69 % for
  ε = 0.46 (worst case when Nyquist sits near 0.37 of cutoff). The noise-aware weighting in
  section 4.3 is there to avoid paying that where there is no signal.
- Not corrected: seeing, collimation, aberrations, spider spikes (later option), and the
  light lost to the secondary.
- Linear data only. Saturated star cores break linearity and get dark rings unless protected.

## 3. Inputs

| Input | Source |
| --- | --- |
| Aperture D (mm), obstruction d (mm or %) | telescope drop-down (obstructed optics from the owner's dataset) or typed in; remembered between runs |
| Image scale (″/px) | astrometric solution in view properties → FITS `FOCALLEN` + `XPIXSZ` + `XBINNING` → manual |
| Wavelength band per channel | presets: L, R, G, B, Hα, OIII, SII, custom centre + width |

Cutoff in pixel units: `ν_c = D · scale[rad/px] / λ` (equivalently `pixel / (λ · f-ratio)`).
Using the solved image scale keeps drizzled, binned and resampled images correct.

## 4. Algorithm

1. **MTF** of a pupil as normalised overlap area of the pupil with a shifted copy. For an
   annulus this is three circle–circle lens areas: `L(R,R,s) − 2·L(R,r,s) + L(r,r,s)`. One
   15-line function covers clear and obstructed cases, with no piecewise formula to get wrong.
2. **Polychromatic H**: average both MTFs over 5–9 wavelengths across the band, then divide.
3. **Gain shaping**
   - Mode *Restore only* (default): `max(H, 1)`, never reduces contrast anywhere.
   - Mode *True unobstructed equivalent*: H as is.
   - Amount `a` (0–1): `1 + a·(H − 1)`.
   - Noise-aware weight: `1 + g(f)·(H − 1)` with `g = SNR/(1+SNR)`, SNR(f) from the radial
     power spectrum of a few image tiles against the noise floor. Boost goes only where
     signal exceeds noise.
4. **Kernel**: sample the shaped H on an N×N frequency grid, inverse FFT (small radix-2 FFT
   in plain JS), crop to an odd K×K window (K scales with 1/ν_c, clamped 33–511), taper
   the edge, renormalise the sum to 1. One kernel per channel for colour images.
5. **Apply** with PixInsight's own `Convolution` process in *Image* mode, kernel passed as a
   hidden view. Read in PixInsight's open class-library source: this path runs
   `FFTConvolution`, mirror-pads the borders, divides the kernel by its plain sum (negative
   lobes are fine, our sum is 1) and is multithreaded. Per channel: extract to a hidden mono
   window, convolve, then one `PixelMath` writes the channels back, so the result is a single
   undo step, respects an active mask and is clipped to [0, 1].
6. **Protection**: soft mask over pixels near saturation (threshold + dilation + blur)
   blended back to the original inside that final PixelMath.

Rejected: PixInsight `Deconvolution` with a synthetic PSF. It is iterative and non-linear,
and the target here is another PSF, not a point, which Richardson–Lucy cannot express.

## 5. Dialog

- Target view; output as new image `<id>_oc` (default) or in place.
- Telescope group: aperture, obstruction (mm / %), image scale with its detected source shown.
- Band per channel (one row for mono, three for RGB).
- Mode, amount, noise-aware on/off, protect saturated stars on/off + threshold.
- Read-outs that update live: cutoff (cycles/px), sampling (Nyquist / cutoff), peak gain
  inside the sampled band, expected noise increase.
- Later: plot of clear / obstructed / corrected MTF, and a "predicted benefit" figure from
  the measured star FWHM.

## 6. Code layout (same conventions as awitwicki/PI-Scripts)

```
src/scripts/ObstructionCorrection/ObstructionCorrection.js   single self-contained file
tools/selftest.js          extracts the portable math block and tests it
tools/build-package.sh     zips src/scripts, prints sha1 for updates.xri
repository/updates.xri     PixInsight update-repository manifest
docs/images/               README screenshots
README.md  AGENTS.md  CLAUDE.md  LICENSE
```

Taken over from the friend's repo because they are hard-won PixInsight 1.9.4 facts:
`#engine v8` as the literal first line; `#feature-id Id : Category > Label`; single-line
`#feature-info`; `CoreApplication.ensureMinimumVersion( 1, 9, 4 )`; an explicit
`#include <pjsr/...>` for every constant family; `class extends Dialog`; top-level
`try/catch` that prints `String( e )`; `trySet()` for build-dependent properties; a
`BEGIN/END portable math` block with no PixInsight globals.

Portable block contents: lens area, MTFs, polychromatic H, gain shaping, radix-2 FFT, kernel
builder, noise-gain figure, radial power spectrum and SNR weight.

## 7. Testing

- **Math, outside PixInsight.** `tools/selftest.js` in the friend's style (Node). This Mac
  has no Node, but macOS ships `jsc`, which runs the same block, so the math can be verified
  here. Cases: agreement with O'Neill's closed form; table values above; H = 1 − ε² above
  (1+ε)/2; kernel sum = 1; DFT of the cropped kernel within 1 % of H; end-to-end on a
  synthetic scene (blur with obstructed MTF + seeing, correct, compare with the clear-aperture
  blur).
- **Inside PixInsight.** PixInsight is not installed on this Mac, so every GUI and process
  call has to be run by you. A test script builds a synthetic star field and bar target,
  applies both blurs natively and reports the residual after correction.
- **Real data.** Before/after on one of your linear stacks: star profile (no ringing),
  noise sigma, contrast of a known medium-scale feature.

## 8. Milestones

| # | Deliverable | Done when |
| --- | --- | --- |
| 1 | Brief replaced (`AGENTS.md`, `README.md`) | files describe this script |
| 2 | Portable math block + selftest | all cases pass under `jsc` here (and Node on your side) |
| 3 | 40-line spike script for PixInsight | you confirm: kernel view with negative values is accepted, `Convolution` Image mode runs from a script, typed-array sample I/O works |
| 4 | v0.1: mono, manual parameters, new-image output | synthetic test residual under 1 % |
| 5 | v0.5: RGB per channel, scale from solution/FITS, band presets, mode + amount, star protection, in place with undo and mask, remembered settings | works on your real stack |
| 6 | v0.9: noise-aware weighting, live read-outs, MTF plot | noise increase stays within the read-out figure |
| 7 | README with screenshots, package + `updates.xri` | installs through Feature Scripts and through the update repository |

Later, not in v1: spider vanes and arbitrary pupil masks (anisotropic kernel, softens
spikes), telescope presets, process-icon support.

## 9. Risks

- **Script-side API details** (step 3). The native convolution behaviour was read from
  source, but the script calls around it were not run. Fallback if a negative-valued kernel
  view is refused: split the kernel into positive and negative parts, convolve twice,
  combine in PixelMath.
- **Small visible effect on seeing-limited data.** Mitigated by the read-outs that state the
  expected gain before running.
- **Non-linear input** (stretched image, saturated cores). Warn on a high median; protect
  saturated pixels.

## 10. Decisions (owner, 2026-11-12)

- Script name: **ObstructionCorrection**.
- Minimum PixInsight version: **1.9.4**, V8 engine.
- **Telescope drop-down.** The dialog has a list of optics taken from the owner's optics
  dataset (collected in an earlier chat about filters). Only optics with a central
  obstruction are listed, plus a "Custom" entry. Picking one fills aperture, obstruction
  and focal length; the fields stay editable. The table lives in the portable block as
  `OPTICS` (format and derivation documented there), filled with the 12 obstructed rows — do
  not add entries from memory.

## 11. Open questions (defaults in brackets)

1. Menu category. [Utilities]
2. Publish as an update repository like the friend's, or Feature Scripts install only? [both]
