// AutoMosaic.js - PixInsight script (PJSR).
//
// For every filter (L, R, G, B, Ha, OIII, SII, ...) runs, with default settings:
//    [ImageSolver] -> MosaicByCoordinates -> TrimMosaicTile -> PhotometricMosaic -> common autocrop
//
// OneClick Mosaic - PixInsight. Copyright (c) 2026 Robert Panai (MIT licence, see LICENSE).
// This script does not contain, copy or modify the code of the scripts it drives; they must be
// installed separately and are the work of Andres del Pozo, Juan Conejero and John Murphy
// (see CREDITS.md).
//
// Tested with PixInsight 1.9.3, ImageSolver 6.3.1, MosaicByCoordinates 1.3.3,
// TrimMosaicTile 4.0.1 and PhotometricMosaic 4.0.2.

#feature-id    AutoMosaic : Mosaic > AutoMosaic

#feature-info  Runs ImageSolver (optional), MosaicByCoordinates, TrimMosaicTile and \
               PhotometricMosaic with default settings, per filter.<br/>\
               Requires those four scripts to be installed.<br/>\
               Copyright &copy; 2026 Robert Panai. Uses scripts by A. del Pozo, J. Conejero and J. Murphy.

#include "lib/AM-Pjsr.js"
#include "lib/AM-Config.js"
#include "lib/AM-Log.js"
#include "lib/AM-Model.js"
#include "lib/AM-Wcs.js"
#include "lib/AM-Inputs.js"
#include "lib/AM-State.js"
#include "lib/AM-Adapter-MBC.js"
#include "lib/AM-Adapter-ImageSolver.js"
#include "lib/AM-Adapter-TMT.js"
#include "lib/AM-Adapter-PMM.js"
#include "lib/AM-Pipeline.js"
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
