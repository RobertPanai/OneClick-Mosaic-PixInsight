# Test results (PixInsight 1.9.3.8, SMC data, 2 panels x L and OIII)

| Test | Result |
|---|---|
| L mosaic vs manual result | max abs diff 0 |
| OIII mosaic (own geometry) vs manual result | max abs diff 0 |
| Shared geometry (L -> OIII) | OIII on L grid 6507x7605 |
| Serial vs parallel (L local + OIII in 2nd instance) | max abs diff 0 on both, 34 s |
| Failing panel in one filter | L OK, OIII FAILED with message, no orphan windows (28 before/after) |
| Input validation (channel mismatch) | stops before processing, clear message |
| Autocrop L+OIII (SMC) | common crop 6030x7273, rotation -2.82 deg, +7.3% image vs best axis-aligned; no empty pixel, no dark rim on any border; same size for both filters |
| No modal dialogs during runs | none seen |

Not yet tested: open windows as input, solve-if-missing with a real ImageSolver run, user abort mid-run.
Scripts are in `dev/` (run with SCRIPT > Execute Script File); the test scripts are not part of the repository (they contain local paths).
