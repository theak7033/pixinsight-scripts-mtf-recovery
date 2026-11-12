# pixinsight-scripts-mtf-recovery

**ObstructionCorrection** — a PixInsight script that restores the contrast a telescope's
central obstruction (secondary mirror) removes at medium spatial frequencies. It filters a
linear image with the ratio of the clear-aperture and obstructed-aperture diffraction MTFs:

```
H(f) = MTF_clear(f) / MTF_obstructed(f, d/D)
```

Status: **v0.1.1, runs inside PixInsight** on an RGB RASA 8 stack, both with FITS keywords
and plate-solved (scale read from the solution; the new image keeps the FITS header and
the plate solution); the measured noise gain matches the designed filter. In-place mode
with a mask and mono images are not yet tried in PixInsight. Design and roadmap:
[PLAN.md](PLAN.md).

Requires PixInsight 1.9.4 or newer (V8 JavaScript engine).

## Install

Pick **one** of the two ways below. Using both puts ObstructionCorrection in the Script menu
twice.

### A. From the update repository (easiest — no download)

1. In PixInsight: **Resources → Updates → Manage Repositories**, click **Add**, and enter
   ```
   https://raw.githubusercontent.com/theak7033/pixinsight-scripts-mtf-recovery/main/repository/
   ```
   then **OK**.
2. **Resources → Updates → Check for Updates**. *ObstructionCorrection* is listed; keep it
   ticked and click **Apply**.
3. Let PixInsight restart. The script is under **Script → Utilities → ObstructionCorrection**.

New versions arrive the same way, through **Check for Updates**.

The repository's manifest carries a placeholder signature, as many community repositories
do; current PixInsight builds install it anyway. If yours refuses it, use way B.

### B. From the files, via Feature Scripts

#### 1. Get the files

Clone the repository, or download it from GitHub (**Code → Download ZIP**) and unzip it:

```bash
git clone https://github.com/theak7033/pixinsight-scripts-mtf-recovery.git
```

On Windows, if you clone with git, keep the files' LF line endings: run
`git config core.autocrlf false` in the clone, then `git checkout -- .` (the script itself
runs either way; the tests need LF).

#### 2. Add it to the Script menu

1. In PixInsight, open **Script → Feature Scripts…**.
2. Click **Add**.
3. Select the repository's `src/scripts` folder, e.g.
   `E:/scripts/pixinsight-scripts-mtf-recovery/src/scripts`, and click **Select Folder**.
   PixInsight searches it and reports *1 additional script(s) were found*; click **OK**.
4. Click **Done**.

The script is now under **Script → Utilities → ObstructionCorrection**. PixInsight keeps
pointing at this folder, so after an update (`git pull`, or a new ZIP unzipped over the old
one) the menu entry runs the new version; no need to add it again. To remove it, untick it
in **Script → Feature Scripts…** and click **Done**.

### Or: run it once without installing anything

**Script → Execute Script File…**, then pick
`src/scripts/ObstructionCorrection/ObstructionCorrection.js`.

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

Runs the math self-test, a syntax check, and unit tests of the dialog and processing code
against a stand-in for PixInsight (every function must be exercised), with Node.js if installed or the `jsc` shell that ships with macOS. See [AGENTS.md](AGENTS.md) for conventions.

### Releasing a new version

```bash
tools/build-package.sh 0.2.0
```

Runs the tests, zips `src/scripts` into `repository/ObstructionCorrection-0.2.0.zip`, removes
the older zip, and writes the new file name, sha1 and date into `repository/updates.xri`.
Commit `repository/` and push to `main`; everyone who added the repository URL gets the
update through **Check for Updates**. Always use a new version number: PixInsight only
offers a package whose file name or release date changed.
