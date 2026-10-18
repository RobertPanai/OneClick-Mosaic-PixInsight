# Test results (PixInsight 1.9.3.8, SMC data, 2 panels x 6 filters: L, R, G, B, Ha, OIII)

| Test | Result |
|---|---|
| Full run, integrated engine, shared geometry, autocrop, serial | 6/6 filters OK, about 2 min 12 s, `Mosaic_<f>.xisf` + `Mosaic_<f>_crop.xisf` |
| Seam inspection (L) | no visible seam or gradient step across the overlap |
| Join planning (`lib/engine/test/layout.test.js`, node) | rows-first order for grids, passes |
| Failing panel in one filter | the other filters complete, message in the summary, no orphan windows |
| Input validation (channel mismatch) | stops before processing, clear message |
| No modal dialogs during runs | none seen |
| Astrometry check + ImageSolver (panel with its solution removed) | see CHANGELOG / below |

Not yet tested: grids larger than 2 panels on real data, colour panels, parallel mode with the integrated engine,
user abort mid-run.
