# OneClick Mosaic - PixInsight

**One run, one mosaic per filter.** A self-contained PixInsight script (PJSR) that takes the panels of a mosaic, groups
them by filter (L, R, G, B, Ha, OIII, SII, ...) and produces a finished, cropped mosaic for each filter:

```
[plate solving] -> registration -> trim -> photometric join -> common autocrop
 (only panels without
  astrometric data)
```

By Robert Panai. Registration, edge trimming, photometric scaling, gradient correction and joining are implemented in
this repository (see [docs/ENGINE.md](docs/ENGINE.md)); no other mosaic script is required. The only external piece is
PixInsight's own **ImageSolver** script, used when a panel has no astrometric data.

## Features
- **Inputs:** files, a whole folder, or windows already open in PixInsight (open windows are never modified), grouped
  automatically by filter (FITS keyword, then file name). Reorder panels, move them between filters, rename filters.
- **Automatic astrometry check:** every panel is checked for an astrometric solution as soon as it is added (WCS column).
  If some panels have none, a notice appears under the list and, when you press Run, you are told which panels will be
  solved, and which header items ImageSolver is missing (coordinates, focal length, pixel size).
- **Plate solving with ImageSolver:** never / only if missing (default) / always. Solving is done on a copy; originals are
  never touched. Pixel size and focal length from the options fill in for missing header values.
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
- Only for panels without astrometric data: PixInsight's ImageSolver script (tested 6.3.1), part of the standard
  installation. Its version is checked before it is used.

## Install

**Recommended - from PixInsight (updates automatically):**
1. **RESOURCES > Updates > Manage Repositories > Add**, paste:
   ```
   https://raw.githubusercontent.com/RobertPanai/OneClick-Mosaic-PixInsight/main/pixinsight-repository/
   ```
2. **RESOURCES > Updates > Check for Updates**, install "OneClick Mosaic - PixInsight", restart PixInsight.
   (The package installs into `src/scripts/AutoMosaic`; on Windows PixInsight may ask for administrator rights.)
3. Run it from **SCRIPT > Mosaic > AutoMosaic**.

**Manual:** clone or download this repository, then **SCRIPT > Feature Scripts > Add**, select the repository folder
(keep it free of very large files: PixInsight scans it recursively), **Done**.

## Use
1. Add files / folder / windows. Check the filter grouping and the WCS column.
2. Choose the output folder and options. Press **Run**.

Output:
```
<out>/<filter>/01_solved/            solved copies (only if solving was needed)
<out>/<filter>/02_registered/        panels reprojected on the common grid
<out>/<filter>/03_trimmed/           trimmed panels (+ partial mosaics)
<out>/<filter>/Mosaic_<filter>.xisf         the mosaic
<out>/<filter>/Mosaic_<filter>_crop.xisf    the cropped mosaic (autocrop)
<out>/AutoMosaic_<timestamp>.log
```

## How it works
See [docs/ENGINE.md](docs/ENGINE.md) and [TESTING.md](TESTING.md).

## Status
Version 0.3.0. Verified on a two-panel mosaic in six filters (shared geometry, autocrop). Grids of more than two panels,
colour panels and a real ImageSolver run from the dialog flow are covered by [TESTING.md](TESTING.md). Issues and feedback
are welcome.

## Licence
MIT (see [LICENSE](LICENSE)). See [CREDITS.md](CREDITS.md).
