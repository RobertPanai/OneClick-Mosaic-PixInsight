// AM-Solve.js - plate solving with PixInsight's own ImageSolver.
//
// Used in two places:
//   * panels without astrometric data (before the mosaics are built): a solved COPY is written to the work folder;
//   * the delivered mosaics (after the run): the window that is opened in PixInsight is solved in place.
//
// In both cases the ImageSolver dialog (the one of Script > Astrometry > ImageSolver, with the user's saved settings
// and the header values pre-filled) is shown; once the user accepts it the image is solved. The originals are never
// modified. ImageSolver's classes are used through its library mode, as other PixInsight scripts do.
//
// Public API:
//   AM.Solve.run(groups, opts) -> { ok, cancelled, message, solved }      (panels)
//   AM.Solve.window(w)         -> { ok, cancelled, message }              (an open window, in place)
//   AM.Solve.mosaic(w, label)  -> { ok, cancelled, message }              (mosaic: asks to retry on failure)

// ImageSolver library, included at global scope (its classes must be visible to AM_IS_solveWindow).
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


function AM_IS_solveWindow(w)
{
   var R = { ok: false, cancelled: false, message: "" };
   try {
      w.bringToFront();                                   // ImageSolver works on the active window

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
      R.ok = true;
   } catch (e) {
      R.message = "ImageSolver failed: " + e;
   }
   return R;
}

AM.Solve = {};

// Solves an open window in place (the caller keeps the window). Shows the ImageSolver dialog.
AM.Solve.window = function(w)
{
   return AM_IS_solveWindow(w);
};

// Solves an open mosaic window, asking whether to try again after a failure.
// Returns { ok, cancelled, message }; a failure never closes or deletes the window.
AM.Solve.mosaic = function(w, label)
{
   for (;;) {
      AM.Log.step("Plate solving " + label + ": ImageSolver dialog");
      var r = AM.Solve.window(w);
      if (r.ok) { AM.Log.note(label + ": plate solved"); return r; }
      if (r.cancelled) { r.message = "the plate solving was cancelled"; AM.Log.warn(label + ": " + r.message); return r; }
      AM.Log.error(label + ": " + r.message);
      var a = (new MessageBox("<p><b>The plate solving of " + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
         " failed.</b></p><p>" + r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
         "</p><p>Try again with different settings? If you answer No, the mosaic is delivered without an astrometric solution.</p>",
         "AutoMosaic", StdIcon_Warning, StdButton_Yes, StdButton_No)).execute();
      if (a !== StdButton_Yes) return r;
   }
};

AM.Solve.panelsWithoutSolution = function(groups)
{
   var list = [];
   for (var i = 0; i < groups.length; ++i)
      for (var j = 0; j < groups[i].panels.length; ++j)
         if (groups[i].panels[j].hasWcs === false) list.push({ group: groups[i], panel: groups[i].panels[j], index: j });
   return list;
};

// One panel: opens a copy of the file, solves it in the ImageSolver dialog, saves the solved copy to dstPath.
AM.Solve._panel = function(srcPath, dstPath)
{
   var R = { ok: false, cancelled: false, message: "" }, w = null;
   try {
      var ws = ImageWindow.open(srcPath);
      if (!ws || ws.length < 1 || ws[0].isNull) { R.message = "the file could not be opened: " + srcPath; return R; }
      w = ws[0];
      w.show();
      w.zoomToFit();
      AM.Crop._autoStretch(w);                            // screen stretch only
      var r = AM.Solve.window(w);
      if (!r.ok) return r;
      if (File.exists(dstPath)) File.remove(dstPath);
      if (!w.saveAs(dstPath, false, false, true, false)) { R.message = "the solved copy could not be saved: " + dstPath; return R; }
      R.ok = true;
   } catch (e) {
      R.message = "ImageSolver failed on " + File.extractNameAndExtension(srcPath) + ": " + e;
   } finally {
      if (w && !w.isNull) try { w.forceClose(); } catch (e2) {}
   }
   return R;
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
         var r = AM.Solve._panel(p.path, dst);
         if (r.ok) break;
         if (r.cancelled)
            return { ok: false, cancelled: true, solved: done,
                     message: "Plate solving was cancelled: the panel '" + p.name + "' (filter " + t.group.name +
                              ") has no astrometric solution, so the mosaic cannot be built." };
         AM.Log.error(r.message);
         var a = (new MessageBox("<p><b>" + File.extractNameAndExtension(p.path) + " could not be solved.</b></p><p>" +
            r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p><p>Try again with different settings?</p>",
            "AutoMosaic", StdIcon_Warning, StdButton_Yes, StdButton_No)).execute();
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
