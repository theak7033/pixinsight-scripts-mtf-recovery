# pixinsight-scripts-mtf-recovery

**ObstructionCorrection** — a PixInsight script that restores the contrast a telescope's
central obstruction (secondary mirror) removes at medium spatial frequencies. It filters a
linear image with the ratio of the clear-aperture and obstructed-aperture diffraction MTFs:

```
H(f) = MTF_clear(f) / MTF_obstructed(f, d/D)
```

Status: **v0.1, not yet run inside PixInsight.** The math is tested; the dialog and the
processing calls have only been run against a stand-in for PixInsight. Design and roadmap:
[PLAN.md](PLAN.md).

Requires PixInsight 1.9.4 or newer (V8 JavaScript engine).

## Install

In PixInsight: **Script → Feature Scripts… → Add**, select this repository's `src/scripts`
folder, **Done**. The script appears under **Script → Utilities → ObstructionCorrection**.
Or run it once via **Script → Execute Script File…**.

## Use

1. Open a **linear** image (integrated, not stretched), ideally before noise reduction.
2. Run the script and pick your telescope from the list, or choose *Custom* and enter the
   aperture and obstruction yourself.
3. Check the image scale. It is read from the plate solution when the image has one,
   otherwise from the FITS `FOCALLEN` / `XPIXSZ` keywords, otherwise from the focal length
   and pixel size fields.
4. Pick the band for narrowband or mono-filter data; *Auto* uses R, G, B per channel for
   colour images and a broadband average for mono.
5. **Run.** The result is a new image `<id>_oc`, or the target itself if you tick
   *Replace the target image* (undoable, respects an active mask).

The read-out under the settings shows the largest contrast boost and the background-noise
increase to expect before you run.

| Setting | Default | Meaning |
| --- | --- | --- |
| Mode | Restore only | never lowers contrast; *True equivalent* also removes the small fine-scale advantage an obstructed aperture has |
| Amount | 1.0 | 1 = full physical correction |
| Protect saturated stars | on, 0.95 | keeps the original image in and around clipped pixels, which would otherwise get dark rings |

### Telescopes in the list

Askar N160 · Celestron C6 + Hyperstar · Celestron EdgeHD 8" · Celestron RASA 8 ·
Celestron RASA 11 · Sharpstar HNT 130 · Sharpstar HNT 150 · Sky-Watcher 130/650 PDS ·
Sky-Watcher Quattro 150P · Sky-Watcher Quattro 250P · Takahashi Epsilon 130 ·
TS-Optics GSO 8" RC

Obstruction figures are derived from nominal and effective f-ratios and are good to about
half a percentage point; overwrite the field if you know your exact secondary size.

### Limits

- Linear data only. On a stretched image the result is not physically meaningful.
- Seeing-limited data from large apertures gains little: the atmosphere has already removed
  the scales where the obstruction matters. Small obstructed astrographs and lunar /
  planetary stacks gain the most.
- Spider-vane diffraction, seeing, collimation and aberrations are not corrected.
- Background noise rises by the amount shown in the read-out; there is no noise-aware
  weighting yet.

## Development

```bash
tools/test.sh
```

Runs the math self-test, a syntax check and a smoke run of the whole script against a
stand-in for PixInsight, with Node.js if installed or the `jsc` shell that ships with macOS. See [AGENTS.md](AGENTS.md) for conventions.
