// AutoMosaic.js - PixInsight script (PJSR).
//
// For every filter (L, R, G, B, Ha, OIII, SII, ...):
//    [plate solving, if a panel has no astrometric data] -> registration -> trim -> photometric join -> common autocrop
//
// OneClick Mosaic - PixInsight. Copyright (c) 2026 Robert Panai (MIT licence, see LICENSE).
// Self-contained: only PixInsight's own ImageSolver script is called, and only for panels without astrometric data.
//
// Tested with PixInsight 1.9.3 and ImageSolver 6.3.1.

#feature-id    AutoMosaic : Mosaic > AutoMosaic

#feature-info  Builds one mosaic per filter: registration, edge trim, photometric join and a common autocrop. \
               Panels without astrometric data are checked automatically and can be solved with ImageSolver.<br/>\
               Copyright &copy; 2026 Robert Panai.

#include "lib/AM-Pjsr.js"
#include "lib/AM-Config.js"
#include "lib/AM-Log.js"
#include "lib/AM-Model.js"
#include "lib/AM-Wcs.js"
#include "lib/AM-Inputs.js"
#include "lib/AM-State.js"
#include "lib/AM-Adapter-ImageSolver.js"
#include "lib/AM-Pipeline.js"
#include "lib/engine/AM-Geometry.js"
#include "lib/engine/AM-Reproject.js"
#include "lib/engine/AM-Trim.js"
#include "lib/engine/AM-Layout.js"
#include "lib/engine/AM-Overlap.js"
#include "lib/engine/AM-Photometry.js"
#include "lib/engine/AM-Gradient.js"
#include "lib/engine/AM-Combine.js"
#include "lib/engine/AM-Join.js"
#include "lib/AM-Crop.js"
#include "lib/AM-Runner.js"
#include "lib/AM-Job.js"
#include "lib/AM-Dialog.js"

AM.SCRIPT_PATH = #__FILE__;

function AM_main()
{
   // Worker mode (parallel execution): no user interface.
   var jobFile = AM.Job.argument();
   if (jobFile) {
      AM.Job.runWorker(jobFile);
      return;
   }

   // Parallel mode needs to start further PixInsight instances.
   try {
      var exe = CoreApplication.filePath;
      if (exe && File.exists(exe) && AM.SCRIPT_PATH && File.exists(AM.SCRIPT_PATH)) {
         AM.PARALLEL_AVAILABLE = true;
         AM.PARALLEL_REASON = "";
      } else
         AM.PARALLEL_REASON = "the PixInsight executable or this script could not be located";
   } catch (e) {}

   var st = AM.State.fromParameters();
   var groups = st ? st.groups : [];
   var opts = st ? st.opts : AM.State.loadOptions();

   var dialog = new AM_Dialog(groups, opts);
   if (!dialog.execute()) return;
   AM.State.saveOptions(opts);
   AM.State.toParameters(groups, opts);    // makes the run part of the process history

   console.show();
   console.abortEnabled = true;
   console.writeln("<end><cbr><br><b>" + AM.TITLE + " " + AM.VERSION + "</b>");
   var t0 = new Date().getTime();
   var abortFn = function() { return console.abortRequested; };
   var results = (opts.execution === "parallel" && AM.PARALLEL_AVAILABLE) ?
                 AM.Runner.runParallel(groups, opts, abortFn, AM.SCRIPT_PATH) :
                 AM.Runner.run(groups, opts, abortFn);
   var s = AM.Runner.summary(results, new Date().getTime() - t0);
   if (opts.autocrop) AM.Crop.openResults(results);   // show the cropped mosaics in PixInsight

   (new MessageBox("<pre>" + s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>" +
                   "<p>Log: " + AM.Log.path + "</p>",
                   AM.TITLE, s.allOk ? StdIcon_Information : StdIcon_Warning, StdButton_Ok)).execute();
}

AM_main();
