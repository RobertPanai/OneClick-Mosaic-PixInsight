// AM-Adapter-ImageSolver.js - runs PixInsight's ImageSolver script headless through its library mode
// (#define USE_SOLVER_LIBRARY), the same way WeightedBatchPreprocessing uses it. Solver configuration: ImageSolver's own
// saved settings (what its dialog would show) with the image metadata taking
// priority; nothing is changed.
//
// Public API:
//   AM.ImageSolver.run(files, options, ctx) -> AM_StepResult
//     options.mode: "never" | "ifMissing" | "always"
//     The originals are never touched: every panel that needs solving is copied to
//     ctx.outDir and the copy is solved. Panels that do not need solving are
//     passed through (outputs[i] is either the original or the solved copy).

function AM_IS_exec(srcPath, dstPath, opts)
{
   var AM_R = { ok: false, message: "" };

#define USE_SOLVER_LIBRARY true
#define STAR_CSV_FILE   File.systemTempDirectory + "/stars-automosaic.csv"
#define TITLE           "ImageSolver"
#define SETTINGS_MODULE "SOLVER"
#undef VERSION
#undef __ADP_COMMONUICONTROLS_js
#undef __ADP_PROJECTIONS_jsh
#undef __ADP_VIEWDIALOG_js
#undef __ADP_SEARCHCOORDINATES_jsh
#undef __ADP_CATALOGDOWNLOADER_js
#undef Ext_DataType_Complex
#undef Ext_DataType_StringArray
#undef Ext_DataType_JSON
#undef WCS_MIN_CATALOG_STARS
#undef WCS_MAX_CATALOG_STARS
#undef WCS_DEFAULT_RBF_TYPE
#undef WCS_MIN_SPLINE_POINTS
#undef WCS_MAX_DENSE_SPLINE_POINTS
#undef WCS_MAX_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_MAX_SPLINE_POINTS
#undef NULLMAG
#undef __PJSR_STAR_OBJECT_DEFINED
#undef __PJSR_NO_STAR_DETECTOR_TEST_ROUTINES
#undef __PJSR_STAR_DETECTOR_VERSION
#include <../src/scripts/AdP/CommonUIControls.js>
#include <../src/scripts/AdP/AstronomicalCatalogs.jsh>
#include <../src/scripts/AdP/WCSmetadata.jsh>
#include <../src/scripts/AdP/ImageSolver.js>
#include <../src/scripts/AdP/SearchCoordinatesDialog.js>
#undef USE_SOLVER_LIBRARY
#undef STAR_CSV_FILE
#undef TITLE
#undef SETTINGS_MODULE
#undef SETTINGS_MODULE_SCRIPT
#undef SOLVERVERSION
#undef __PJSR_USE_STAR_DETECTOR_V2
#undef __ADP_COMMONUICONTROLS_js
#undef __ADP_PROJECTIONS_jsh
#undef __ADP_VIEWDIALOG_js
#undef __ADP_SEARCHCOORDINATES_jsh
#undef __ADP_CATALOGDOWNLOADER_js
#undef Ext_DataType_Complex
#undef Ext_DataType_StringArray
#undef Ext_DataType_JSON
#undef WCS_MIN_CATALOG_STARS
#undef WCS_MAX_CATALOG_STARS
#undef WCS_DEFAULT_RBF_TYPE
#undef WCS_MIN_SPLINE_POINTS
#undef WCS_MAX_DENSE_SPLINE_POINTS
#undef WCS_MAX_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_MAX_SPLINE_POINTS
#undef NULLMAG
#undef __PJSR_STAR_OBJECT_DEFINED
#undef __PJSR_NO_STAR_DETECTOR_TEST_ROUTINES
#undef __PJSR_STAR_DETECTOR_VERSION

   var solved = null;
   try {
      var ws = ImageWindow.open(srcPath);
      if (!ws || ws.length < 1 || ws[0].isNull) { AM_R.message = "cannot open " + srcPath; return AM_R; }
      solved = ws[0];
      var solver = new ImageSolver();
      solver.Init(solved, false /*prioritizeSettings*/);
      if (solver.error) console.warningln("<raw>" + solver.error + "</raw>");
      // Fill in the image scale from the dialog when the header lacks it.
      var md = solver.metadata;
      if ((md.xpixsz === null || !(md.xpixsz > 0)) && opts && opts.pixelSize > 0) md.xpixsz = opts.pixelSize;
      if ((md.focal === null || !(md.focal > 0)) && opts && opts.focalLength > 0) md.focal = opts.focalLength;
      if (md.xpixsz > 0 && md.focal > 0) {
         md.resolution = md.xpixsz / md.focal * 0.18 / Math.PI;
         md.useFocal = true;
      }
      solver.metadata.width = solved.mainView.image.width;
      solver.metadata.height = solved.mainView.image.height;
      if (!solver.SolveImage(solved)) {
         AM_R.message = "ImageSolver could not solve " + File.extractNameAndExtension(srcPath) +
            (solver.error ? ": " + solver.error : "") +
            ". Check that the header has coordinates, focal length and pixel size, or solve it manually first.";
         return AM_R;
      }
      if (File.exists(dstPath)) File.remove(dstPath);
      if (!solved.saveAs(dstPath, false, false, true, false)) {
         AM_R.message = "cannot save " + dstPath;
         return AM_R;
      }
      AM_R.ok = true;
   } catch (e) {
      AM_R.message = "ImageSolver failed on " + File.extractNameAndExtension(srcPath) + ": " + e;
   } finally {
      if (solved && !solved.isNull) solved.forceClose();
   }
   return AM_R;
}

AM.ImageSolver = {};

AM.ImageSolver.run = function(files, options, ctx)
{
   var mode = (options && options.mode) || "ifMissing";
   var outputs = [];
   if (mode === "never") return new AM.StepResult(true, files.slice(), "");
   var chk = AM.checkTool("ImageSolver");
   if (!chk.ok) return new AM.StepResult(false, [], chk.message);
   AM.ensureDir(ctx.outDir);
   for (var i = 0; i < files.length; ++i) {
      if (ctx.abort()) return new AM.StepResult(false, outputs, "aborted");
      var f = files[i];
      var needs = (mode === "always") || !AM.Wcs.hasValidSolution(f);
      if (!needs) {
         ctx.log.info("Astrometric solution present, not solving: " + f);
         outputs.push(f);
         continue;
      }
      var dst = AM.joinPath(AM.normPath(ctx.outDir), File.extractName(f) + ".xisf");
      ctx.log.step("ImageSolver " + chk.version + ": " + File.extractNameAndExtension(f));
      var r;
      try { r = AM_IS_exec(f, dst, options); } catch (e) { r = { ok: false, message: "ImageSolver: " + e }; }
      if (!r.ok) return new AM.StepResult(false, outputs, r.message);
      outputs.push(dst);
   }
   return new AM.StepResult(true, outputs, "");
};
