# Changelog

## 0.3.0
- New **integrated engine** (default): registration, edge trimming and photometric join are implemented inside
  AutoMosaic (`lib/engine/`), so MosaicByCoordinates, TrimMosaicTile and PhotometricMosaic are no longer needed.
  ImageSolver stays an optional dependency (only to plate-solve panels that have no solution).
- The previous behaviour is kept as the **legacy engine** (dialog: Engine). `main` still ships 0.2.x unchanged.
- Validated on the 2-panel SMC data set, 6 filters, shared geometry, autocrop: all OK in about 2 min 12 s (serial).

## 0.2.1
- PixInsight update repository (`pixinsight-repository/`, built by `tools/build_repository.py`) so the script can be installed from Manage Repositories.

## 0.2.0
- Autocrop: one common, rotation-optimised crop (largest rectangle with no empty pixel) applied identically to every
  filter; saved as `Mosaic_<filter>_crop.xisf`; the cropped mosaics are opened in PixInsight (screen stretch only).

## 0.1.0
- First version: per-filter pipeline (ImageSolver, MosaicByCoordinates, TrimMosaicTile, PhotometricMosaic),
  shared geometry across filters, dialog with persistent settings, serial and experimental parallel execution.
