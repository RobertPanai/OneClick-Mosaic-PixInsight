# OneClick Mosaic - PixInsight

**One run, one mosaic per filter.** A PixInsight script (PJSR) that takes the panels of a mosaic, groups them by filter
(L, R, G, B, Ha, OIII, SII, ...) and produces a finished, cropped mosaic for each filter, using the established
PixInsight tools with their default settings:

```
[ImageSolver] -> MosaicByCoordinates -> TrimMosaicTile -> PhotometricMosaic -> common autocrop
 (only for panels
  without a solution)
```

By Robert Panai. The mosaicking itself is done by tools written by Andrés del Pozo, Juan Conejero and John Murphy:
see [CREDITS.md](CREDITS.md) - please read it, and credit them when you share your images.

## Features
- **Inputs:** files, a whole folder, or windows already open in PixInsight (open windows are never modified), grouped
  automatically by filter (FITS keyword, then file name). Reorder panels, move them between filters, rename filters.
- **Plate solving:** never / only if missing (default) / always. Solving is done on a copy; originals are never touched.
- **Shared geometry:** the reference filter (default L) is built first and its geometry is reused by every other filter,
  so all mosaics share the same grid, size and orientation.
- **Autocrop (default on):** one crop common to all filters - the largest rectangle with **zero empty pixels**, with the
  rotation optimised (typically 5-10% more image than an axis-aligned crop). The same transform is applied to every filter,
  so sizes and star positions stay identical. Saved as `Mosaic_<filter>_crop.xisf` and opened in PixInsight automatically
  (auto-stretched on screen only). If a rotation gains less than 0.5% the crop is not rotated, so no resampling happens.
- **Isolation:** a failing filter does not stop the others; aborting leaves no orphan windows.
- **Execution:** sequential (default) or experimental parallel (one extra PixInsight instance per filter, more RAM).
- Persistent settings, process icon / instance support, full log file.

## Requirements
- PixInsight 1.9.x (developed and tested on 1.9.3.8, Windows).
- The following scripts, installed with PixInsight or from their authors, in the standard `src/scripts` location:
  ImageSolver (tested 6.3.1), MosaicByCoordinates (1.3.3), TrimMosaicTile (4.0.1), PhotometricMosaic (4.0.2).
  Versions are checked at start; unsupported versions stop the run with a clear message.

## Install
1. Clone or download this repository.
2. In PixInsight: **SCRIPT > Feature Scripts > Add**, select the repository folder, **Done**.
   (Keep the folder free of very large files: PixInsight scans it recursively.)
3. Run it from **SCRIPT > Mosaic > AutoMosaic** (the script keeps this name inside PixInsight).

## Use
1. Add files / folder / windows. Check the filter grouping.
2. Choose the output folder and options. Press **Run**.

Output:
```
<out>/<filter>/01_solved/            solved copies (only if solving was needed)
<out>/<filter>/02_registered/        MosaicByCoordinates output
<out>/<filter>/03_trimmed/           TrimMosaicTile output (+ partial mosaics)
<out>/<filter>/Mosaic_<filter>.xisf         the mosaic
<out>/<filter>/Mosaic_<filter>_crop.xisf    the cropped mosaic (autocrop)
<out>/AutoMosaic_<timestamp>.log
```

## How it works
See [docs/RECON.md](docs/RECON.md) (how each tool is driven headlessly, autocrop algorithm, parallel mode) and
[TESTING.md](TESTING.md) (results). In short, each third-party script is `#include`d at run time inside a function scope,
its macros are `#undef`ed, and a headless `main()` replaces its dialog - so the tools run exactly as they would from their
own dialogs, with default settings, but without any user interaction.

## Status
Version 0.2.0. Verified: bit-identical mosaics versus the manual workflow, shared geometry, serial vs parallel identical,
failure isolation, autocrop on L + OIII. Not yet verified: a real ImageSolver run on unsolved panels, RGB/colour panels,
aborting in the middle of a run. Issues and feedback are welcome.

## Licence
MIT for the files in this repository (see [LICENSE](LICENSE)). The tools it drives keep their own licences
([CREDITS.md](CREDITS.md)); they are not distributed here.
