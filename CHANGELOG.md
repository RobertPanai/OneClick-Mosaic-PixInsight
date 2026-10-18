# Changelog

## 0.3.2
- **Plate solving of the delivered mosaics.** Each opened mosaic (cropped and/or uncropped) is plate solved with
  PixInsight's ImageSolver dialog. This is on by default and can be turned off with the new option
  *Plate solve the mosaics (ImageSolver)*. The solve runs once per kind of mosaic (cropped / uncropped) and the solution
  is copied to the other filters, which share the same grid and crop. Cropping drops the astrometric solution, so the
  cropped and uncropped mosaics are solved separately.
- If plate solving fails or is cancelled, the mosaics are still delivered (open, and saved if requested) and the message
  says that they have no astrometric solution.

## 0.3.1
- **Nothing is saved by default.** The work is done in a temporary folder that is deleted at the end. The cropped mosaic
  of each filter is opened in PixInsight; the uncropped one can be opened too. Saving to a folder is optional
  (cropped and/or uncropped, with an overwrite option that stops the run before starting if files would be replaced).
- **Plate solving opens PixInsight's own ImageSolver dialog** on each panel that has no astrometric solution (with your
  saved settings). When the panel is solved, the mosaic starts by itself. The original file is never modified.
- The per-filter settings for pixel size / focal length, the "keep intermediate files" option and the solve mode selector are removed.
- The final log window is no longer shown; errors are explained in a message box with the cause and a suggestion.
- Removed the legacy engine references and author names from the code.

## 0.3.0
- New **integrated engine** (default): registration, edge trimming and photometric join are implemented inside
  AutoMosaic (`lib/engine/`), so MosaicByCoordinates, TrimMosaicTile and PhotometricMosaic are no longer needed.
  ImageSolver stays an optional dependency (only to plate-solve panels that have no solution).
- The scripts that 0.2.x drove (external registration / trim / join scripts) are **no longer used or required**.
- **Automatic astrometry check:** panels without astrometric data are flagged in the dialog (notice + WCS column); on Run the
  user is told which panels will be solved with ImageSolver and what their headers lack (coordinates, focal length,
  pixel size). Solving works on copies. Dialog pixel size / focal length are passed to ImageSolver when the header lacks them.
- Validated on the 2-panel SMC data set, 6 filters, shared geometry, autocrop: all OK in about 2 min 12 s (serial).

## 0.2.1
- PixInsight update repository (`pixinsight-repository/`, built by `tools/build_repository.py`) so the script can be installed from Manage Repositories.

## 0.2.0
- Autocrop: one common, rotation-optimised crop (largest rectangle with no empty pixel) applied identically to every
  filter; saved as `Mosaic_<filter>_crop.xisf`; the cropped mosaics are opened in PixInsight (screen stretch only).

## 0.1.0
- First version: per-filter pipeline (plate solving, registration, trim, join) driving external scripts,
  shared geometry across filters, dialog with persistent settings, serial and experimental parallel execution.
