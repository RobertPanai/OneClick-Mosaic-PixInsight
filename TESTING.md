# Test results (PixInsight 1.9.3.8, SMC data, 2 panels x 6 filters: L, R, G, B, Ha, OIII)

| Test | Result |
|---|---|
| Full run, integrated engine, shared geometry, autocrop, serial | 6/6 filters OK, about 2 min 12 s, `Mosaic_<f>.xisf` + `Mosaic_<f>_crop.xisf` |
| Seam inspection (L) | no visible seam or gradient step across the overlap |
| Join planning (`lib/engine/test/layout.test.js`, node) | rows-first order for grids, passes |
| Failing panel in one filter | the other filters complete, message in the summary, no orphan windows |
| Input validation (channel mismatch) | stops before processing, clear message |
| No modal dialogs during runs | none seen |
| Astrometry check + ImageSolver (panel with its solution removed) | ImageSolver dialog opened on the panel, OK pressed, solved copy in the temporary folder, original untouched, mosaic restarted by itself: PASSED (0.3.1) |
| Cancel in the ImageSolver dialog | run stops with a clear message, nothing left behind: PASSED (0.3.1) |
| Output behaviour (0.3.1, L+R) | cropped mosaics opened as windows, uncropped opened on request, temporary folder removed completely, no log window: PASSED (0.3.1) |

Not yet tested: grids larger than 2 panels on real data, colour panels, parallel mode with the integrated engine,
user abort mid-run.
