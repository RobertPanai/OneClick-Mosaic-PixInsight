# Reconnaissance notes

## How each tool is driven (strategy S3, "scoped include")
Each third-party script is `#include`d inside a function body of an adapter, then the macros it defines are
`#undef`ed and its `main()` is overridden by a headless replacement (function hoisting). Nothing is copied or edited.
- MBC: `new MosaicByCoordinatesEngine`, set files/outputDir/suffix/overwrite, `Execute()`. The resulting geometry
  (centre, resolution, rotation, projection, size) is read back from the engine and can be fixed for other filters.
- TMT: `new TrimImageData()`, `trimImage(data)`; XPIXSZ/FOCALLEN are checked/injected first.
- PMM: `new PhotometricMosaicData()` with defaults, `photometricMosaic(data, dialog)` with an unexecuted dialog;
  N panels are folded as PMM(PMM(a,b),c)...
- ImageSolver: library mode (`USE_SOLVER_LIBRARY`), solving a copy. Compiles; flow written, not verified with a real solve.

## Not implemented
S4 (guided fallback) was not needed: S3 worked for all four tools.

## Parallel
Verified on 1.9.3.8: `PixInsight -n --automation-mode --no-startup-scripts -r=<script>,--job=<file> --force-exit`
runs the script with `jsArguments`, and the instance exits by itself.

## Autocrop
Implemented in `lib/AM-Crop.js` with PixInsight built-ins only (PixelMath, IntegerResample, DynamicCrop); the WBPP
autocrop was not used because it crops every image on its own. Valid pixel = value > 0 in all channels. The largest
rectangle is searched over rotation angles (histogram method on a rotated, pooled mask), then refined on a 1/2-scale mask
by pushing each side outwards while the rectangle boundary stays on valid pixels. DynamicCrop's angle convention is
detected at run time (the result is verified: expected size and no empty pixel on its border).
PhotometricMosaic output carries no astrometric solution, so there is none to update on the cropped file.
