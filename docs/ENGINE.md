# Integrated engine

Clean-room implementation written from the public documentation of the three tools; no code of
TrimMosaicTile or PhotometricMosaic (J. Murphy, personal-use licence) was read or copied. The registration step follows
the approach of MosaicByCoordinates (A. del Pozo, J. Conejero, BSD-2) - see CREDITS.md.

| Step | Module | What it does |
|---|---|---|
| Geometry | `AM-Geometry.js` | Gnomonic (TAN) mosaic frame covering all panels (centre, scale, size). |
| Registration | `AM-Reproject.js` | Creates the frame with an astrometric solution and reprojects each panel with PixInsight's native astrometric reprojection. |
| Trim | `AM-Trim.js` | Directional erosion of the valid area (default 5 px per side) to remove ragged edges. |
| Layout | `AM-Layout.js` | Plans the join order (rows first for grids). Unit test: `lib/engine/test/layout.test.js` (node). |
| Overlap | `AM-Overlap.js` | Overlap region, seam position, valid bounds. |
| Photometry | `AM-Photometry.js` | Star detection in the overlap, robust least-squares scale factor between panels. |
| Gradient | `AM-Gradient.js` | Difference samples + SurfaceSpline model, smoothing chosen by cross-validation. |
| Combine | `AM-Combine.js` | Overlay / Average / Blend composition. |
| Join | `AM-Join.js` | Runs the steps per pair, folds N panels. |

## Known deviations from the legacy engine
- Only the TAN projection is produced (legacy may pick Mercator for wide RA spans).
- No "outlier %" option and no interactive preview dialogs.
- Photometry falls back to the overlap median when too few common stars are found (less accurate).
- Validated on one two-panel data set; grids and very large mosaics are only covered by the layout unit test.
