// AM-Solve.js - plate solving of the panels that carry no astrometric data, with PixInsight's own ImageSolver.
//
// For every such panel the ImageSolver dialog (the one of Script > Astrometry > ImageSolver, with the user's saved
// settings and the image header values pre-filled) is shown on the panel; once the user accepts it the image is solved,
// a solved COPY is stored in the temporary work folder and AutoMosaic continues by itself. The original file is never
// modified. ImageSolver's classes are used through its library mode (#define USE_SOLVER_LIBRARY), as other PixInsight
// scripts do.
//
// Public API:
//   AM.Solve.run(groups, opts) -> { ok, cancelled, message, solved }
//     replaces the path of each solved panel with its solved copy (panel.hasWcs = true)

function AM_IS_dialog(srcPath, dstPath)
{

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

   var R = { ok: false, cancelled: false, message: "" };
   var w = null;
   try {
      var ws = ImageWindow.open(srcPath);
      if (!ws || ws.length < 1 || ws[0].isNull) { R.message = "the file could not be opened: " + srcPath; return R; }
      w = ws[0];
      w.show();
      w.zoomToFit();
      try { AM.Crop._autoStretch(w); } catch (e0) {}      // screen stretch only
      w.bringToFront();                                    // ImageSolver works on the active window

      // the same sequence as ImageSolver's own main(): dialog, then settings, then solve
      var solver = new ImageSolver();
      var dialog;
      for (;;) {
         solver.Init(w, false /*prioritizeSettings*/);
         dialog = new ImageSolverDialog(solver.solverCfg, solver.metadata, true /*showTargetImage*/);
         if (dialog.execute()) break;
         if (!dialog.resetRequest) { R.cancelled = true; return R; }
         solver = new ImageSolver();
      }
      if (solver.error) { R.message = "ImageSolver: " + solver.error; return R; }
      solver.solverCfg = dialog.solverCfg;
      solver.solverCfg.SaveSettings();
      solver.metadata = dialog.metadata;
      solver.metadata.SaveSettings();
      solver.metadata.width = w.mainView.image.width;
      solver.metadata.height = w.mainView.image.height;

      if (!solver.SolveImage(w)) {
         R.message = "ImageSolver could not find a solution" + (solver.error ? " (" + solver.error + ")" : "") +
            ". Check the approximate coordinates, the focal length and the pixel size in its dialog.";
         return R;
      }
      if (!w.hasAstrometricSolution) { R.message = "ImageSolver finished but the image has no astrometric solution."; return R; }
      if (File.exists(dstPath)) File.remove(dstPath);
      if (!w.saveAs(dstPath, false, false, true, false)) { R.message = "the solved copy could not be saved: " + dstPath; return R; }
      R.ok = true;
   } catch (e) {
      R.message = "ImageSolver failed on " + File.extractNameAndExtension(srcPath) + ": " + e;
   } finally {
      if (w && !w.isNull) w.forceClose();
   }
   return R;
}

AM.Solve = {};

AM.Solve.panelsWithoutSolution = function(groups)
{
   var list = [];
   for (var i = 0; i < groups.length; ++i)
      for (var j = 0; j < groups[i].panels.length; ++j)
         if (groups[i].panels[j].hasWcs === false) list.push({ group: groups[i], panel: groups[i].panels[j], index: j });
   return list;
};

AM.Solve.run = function(groups, opts)
{
   var todo = AM.Solve.panelsWithoutSolution(groups);
   if (todo.length === 0) return { ok: true, cancelled: false, message: "", solved: 0 };
   var chk = AM.checkTool("ImageSolver");
   if (!chk.ok) return { ok: false, cancelled: false, message: chk.message, solved: 0 };
   var dir = AM.joinPath(AM.workDir(), AM.DIR_SOLVED);
   AM.ensureDir(dir);
   var done = 0;
   for (var i = 0; i < todo.length; ++i) {
      var t = todo[i], p = t.panel;
      var dst = AM.joinPath(dir, AM.safeName(t.group.name) + "_" + (t.index + 1) + "_" + File.extractName(p.path) + ".xisf");
      for (;;) {
         AM.Log.step("ImageSolver " + chk.version + " (" + (i + 1) + "/" + todo.length + "): " + File.extractNameAndExtension(p.path));
         var r = AM_IS_dialog(p.path, dst);
         if (r.ok) break;
         if (r.cancelled)
            return { ok: false, cancelled: true, solved: done,
                     message: "Plate solving was cancelled: the panel '" + p.name + "' (filter " + t.group.name +
                              ") has no astrometric solution, so the mosaic cannot be built." };
         AM.Log.error(r.message);
         var a = (new MessageBox("<p><b>" + File.extractNameAndExtension(p.path) + " could not be solved.</b></p><p>" +
            r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p><p>Try again with different settings?</p>",
            AM.TITLE, StdIcon_Warning, StdButton_Yes, StdButton_No)).execute();
         if (a !== StdButton_Yes)
            return { ok: false, cancelled: false, solved: done,
                     message: "The panel '" + p.name + "' (filter " + t.group.name + ") could not be plate solved: " + r.message };
      }
      p.path = AM.normPath(dst);
      p.hasWcs = true;
      ++done;
      AM.Log.note("[" + t.group.name + "] solved: " + p.name);
   }
   return { ok: true, cancelled: false, message: "", solved: done };
};
