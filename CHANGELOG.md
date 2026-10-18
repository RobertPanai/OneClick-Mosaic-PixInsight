# Changelog

## 0.2.1
- PixInsight update repository (`pixinsight-repository/`, built by `tools/build_repository.py`) so the script can be installed from Manage Repositories.

## 0.2.0
- Autocrop: one common, rotation-optimised crop (largest rectangle with no empty pixel) applied identically to every
  filter; saved as `Mosaic_<filter>_crop.xisf`; the cropped mosaics are opened in PixInsight (screen stretch only).

## 0.1.0
- First version: per-filter pipeline (ImageSolver, MosaicByCoordinates, TrimMosaicTile, PhotometricMosaic),
  shared geometry across filters, dialog with persistent settings, serial and experimental parallel execution.
