// AM-Adapter-PMM.js - runs PhotometricMosaic (John Murphy) headless, default settings.
// Same scoped-include strategy as AM-Adapter-MBC.js (S3).
//
// PhotometricMosaic joins two images at a time. For N panels the partial mosaic
// becomes the reference of the next join: mosaic = PMM(mosaic, next panel).
//
// Public API:
//   AM.PMM.run(files, options, ctx) -> AM_StepResult
//     files             : trimmed, registered panels; files[referenceIndex] is the
//                         first reference, the others are joined in array order
//     options.referenceIndex, options.outputPath, options.keepPartials,
//     options.pixelSize, options.focalLength, options.summary (HISTORY text)

function AM_PMM_windowIds()
{
   var ids = {};
   var ws = ImageWindow.windows;
   for (var i = 0; i < ws.length; ++i) ids[ws[i].mainView.id] = true;
   return ids;
}

function AM_PMM_exec(files, referenceIndex, outputPath, partialDir, pixelSize, focalLength, summary)
{
   var AM_R = { ok: false, outputs: [], message: "", joins: 0 };

#undef __PJSR_STAR_OBJECT_DEFINED
#undef __PJSR_NO_STAR_DETECTOR_TEST_ROUTINES
#undef __PJSR_STAR_DETECTOR_VERSION
#undef __PMM_StarDetector_jsh
#undef KEYPREFIX
#undef ISD_KEYPREFIX
#undef DEFAULT_STAR_DETECTION
#undef DEFAULT_STAR_FLUX_TOLERANCE
#undef DEFAULT_STAR_SEARCH_RADIUS
#undef DEFAULT_OUTLIER_PERCENT
#undef DEFAULT_JOIN_SIZE
#undef DEFAULT_OVERLAP_GRADIENT_SMOOTHNESS
#undef DEFAULT_TARGET_GRADIENT_SMOOTHNESS
#undef APERTURE_ADD
#undef APERTURE_GROWTH
#undef APERTURE_GROWTH_OVERLAP
#undef APERTURE_GROWTH_TARGET
#undef APERTURE_GAP
#undef APERTURE_BKG_DELTA
#undef LINEAR_RANGE
#undef STAR_BKG_DELTA
#include <../src/scripts/JohnMurphy/PhotometricMosaic/PhotometricMosaic.js>
#undef __PJSR_STAR_OBJECT_DEFINED
#undef __PJSR_NO_STAR_DETECTOR_TEST_ROUTINES
#undef __PJSR_STAR_DETECTOR_VERSION
#undef __PMM_StarDetector_jsh
#undef KEYPREFIX
#undef ISD_KEYPREFIX
#undef DEFAULT_STAR_DETECTION
#undef DEFAULT_STAR_FLUX_TOLERANCE
#undef DEFAULT_STAR_SEARCH_RADIUS
#undef DEFAULT_OUTLIER_PERCENT
#undef DEFAULT_JOIN_SIZE
#undef DEFAULT_OVERLAP_GRADIENT_SMOOTHNESS
#undef DEFAULT_TARGET_GRADIENT_SMOOTHNESS
#undef APERTURE_ADD
#undef APERTURE_GROWTH
#undef APERTURE_GROWTH_OVERLAP
#undef APERTURE_GROWTH_TARGET
#undef APERTURE_GAP
#undef APERTURE_BKG_DELTA
#undef LINEAR_RANGE
#undef STAR_BKG_DELTA

   function openWindow(path)
   {
      var ws = ImageWindow.open(path);
      if (!ws || ws.length < 1 || ws[0].isNull) throw "cannot open " + path;
      var w = ws[0];
      // PhotometricMosaic needs the pixel size and focal length in the header.
      var kw = w.keywords;
      var added = false;
      if (!getPixelSize(w.mainView, 0)) {
         if (!pixelSize) throw "XPIXSZ (pixel size) is missing in " + File.extractNameAndExtension(path);
         kw.push(new FITSKeyword("XPIXSZ", pixelSize.toFixed(2), "Pixel size including binning, X-axis (um)"));
         added = true;
      }
      if (!getFocalLength(w.mainView, 0)) {
         if (!focalLength) throw "FOCALLEN (focal length) is missing in " + File.extractNameAndExtension(path);
         kw.push(new FITSKeyword("FOCALLEN", focalLength.toFixed(), "Focal length (mm)"));
         added = true;
      }
      if (added) w.keywords = kw;
      return w;
   }

   function closeWindow(w)
   {
      try {
         if (w && !w.isNull) {
            try { w.removeMask(); } catch (e0) {}
            w.forceClose();
         }
      } catch (e) {}
   }

   // Replaces the main() of PhotometricMosaic (hoisted: the last declaration wins).
   function main()
   {
      console.abortEnabled = false;      // as in PhotometricMosaic: an abort would break its cache

      var order = [referenceIndex];
      for (var i = 0; i < files.length; ++i) if (i !== referenceIndex) order.push(i);

      var current = null;                // reference window of the next join
      var mosaicIsOurs = false;
      try {
         current = openWindow(files[order[0]]);
         for (var k = 1; k < order.length; ++k) {
            var target = null;
            var refName = current.mainView.id, tgtName = "";
            try {
               target = openWindow(files[order[k]]);
               tgtName = target.mainView.id;
               var before = AM_PMM_windowIds();

               var data = new PhotometricMosaicData();     // constructor = default settings
               data.referenceView = current.mainView;
               data.targetView = target.mainView;
               data.createJoinMask = false;                // no orphan mask windows
               var dialog = new PhotometricMosaicDialog(data);   // never executed: only provides its controls
               dialog.getPixelScaleFromHdr(data);
               data.saveParameters();
               photometricMosaic(data, dialog);
               if (data.cache !== undefined) data.cache.invalidate();

               // The result is the one new window created by the join.
               var result = null;
               var ws = ImageWindow.windows;
               for (var w = 0; w < ws.length; ++w)
                  if (!before[ws[w].mainView.id]) { result = ws[w]; break; }
               if (!result)
                  throw "PhotometricMosaic did not create a mosaic joining " + refName + " and " + tgtName + " (see the console)";
               ++AM_R.joins;

               if (partialDir && k < order.length - 1) {
                  var pp = partialDir + "/_partial_" + k + ".xisf";
                  if (File.exists(pp)) File.remove(pp);
                  result.saveAs(pp, false, false, true, false);
                  AM_R.outputs.push(pp);
               }
               closeWindow(target); target = null;
               closeWindow(current);
               current = result;
            } finally {
               if (target) closeWindow(target);
            }
         }

         // Save the final mosaic.
         var kws = current.keywords;
         kws.push(new FITSKeyword("HISTORY", "", summary));
         current.keywords = kws;
         if (File.exists(outputPath)) File.remove(outputPath);
         if (!current.saveAs(outputPath, false, false, true, false))
            throw "cannot save " + outputPath;
         AM_R.outputs.push(outputPath);
         AM_R.ok = true;
      } catch (e) {
         AM_R.message = "PhotometricMosaic failed: " + e;
      } finally {
         closeWindow(current);
      }
   }

   return AM_R;
}

AM.PMM = {};

AM.PMM.run = function(files, options, ctx)
{
   var chk = AM.checkTool("PMM");
   if (!chk.ok) return new AM.StepResult(false, [], chk.message);
   if (files.length < 2) return new AM.StepResult(false, [], "PhotometricMosaic needs at least 2 panels.");
   var refIdx = (options && options.referenceIndex) || 0;
   var outputPath = AM.normPath(options.outputPath);
   AM.ensureDir(File.extractDrive(outputPath) + File.extractDirectory(outputPath));
   var partialDir = (options && options.keepPartials) ? AM.normPath(ctx.outDir) : "";
   if (partialDir) AM.ensureDir(partialDir);
   ctx.log.step("PhotometricMosaic " + chk.version + " joining " + files.length + " panels (reference: " +
                File.extractNameAndExtension(files[refIdx]) + ")");
   var r;
   try {
      r = AM_PMM_exec(files, refIdx, outputPath, partialDir,
                      (options && options.pixelSize) || 0, (options && options.focalLength) || 0,
                      (options && options.summary) || ("AutoMosaic " + AM.VERSION));
   } catch (e) {
      return new AM.StepResult(false, [], "PhotometricMosaic: " + e);
   }
   return new AM.StepResult(r.ok, r.outputs, r.message);
};
