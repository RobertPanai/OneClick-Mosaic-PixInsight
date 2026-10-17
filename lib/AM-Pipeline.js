// AM-Pipeline.js - the sequence of steps for one filter.
//
//   [Solve] -> MosaicByCoordinates -> TrimMosaicTile -> PhotometricMosaic
//
// Output layout:
//   <out>/<filter>/00_input/       copies of panels whose file names would collide
//   <out>/<filter>/01_solved/      copies solved by ImageSolver (only when needed)
//   <out>/<filter>/02_registered/  MBC output (_ra)
//   <out>/<filter>/03_trimmed/     TMT output (and partial mosaics)
//   <out>/<filter>/Mosaic_<filter>.xisf

AM.Pipeline = {};

AM.Pipeline._windowIds = function()
{
   var ids = {};
   var ws = ImageWindow.windows;
   for (var i = 0; i < ws.length; ++i) ids[ws[i].mainView.id] = true;
   return ids;
};

// Closes every window that was not open when the pipeline started (never the user's).
AM.Pipeline._closeNewWindows = function(before)
{
   var ws = ImageWindow.windows;
   for (var i = 0; i < ws.length; ++i)
      if (!before[ws[i].mainView.id]) {
         try { ws[i].removeMask(); } catch (e) {}
         try { ws[i].forceClose(); } catch (e2) {}
      }
};

AM.Pipeline._removeFiles = function(dir)
{
   try {
      if (!File.directoryExists(dir)) return;
      var items = searchDirectory(AM.joinPath(dir, "*"), false);
      for (var i = 0; i < items.length; ++i)
         try { if (File.exists(items[i])) File.remove(items[i]); } catch (e) {}
      try { File.removeDirectory(dir); } catch (e2) {}
   } catch (e3) {}
};

// Makes sure no two panels of a group share a file name (MBC derives the output
// name from it): colliding panels are copied to <filterDir>/00_input/pNN_<name>.
AM.Pipeline._uniqueInputs = function(group, filterDir, log)
{
   var paths = [];
   var count = {};
   for (var i = 0; i < group.panels.length; ++i) {
      var n = File.extractName(group.panels[i].path).toLowerCase();
      count[n] = (count[n] || 0) + 1;
   }
   for (var j = 0; j < group.panels.length; ++j) {
      var src = group.panels[j].path;
      var key = File.extractName(src).toLowerCase();
      if (count[key] > 1) {
         var dir = AM.joinPath(filterDir, AM.DIR_INPUT);
         AM.ensureDir(dir);
         var dst = AM.joinPath(dir, "p" + (j + 1 < 10 ? "0" : "") + (j + 1) + "_" + File.extractNameAndExtension(src));
         log.info("Duplicate file name, copying " + src + " -> " + dst);
         File.copyFile(dst, src);
         paths.push(dst);
      } else
         paths.push(src);
   }
   return paths;
};

// Runs the whole chain for one filter.
//   geometry : null (MBC automatic geometry) or a GeometrySpec to impose
// Returns an AM.FilterResult (result.geometry = geometry used by MBC).
AM.Pipeline.runFilter = function(group, opts, geometry, abortFn)
{
   var log = AM.Log;
   var res = new AM.FilterResult(group.name);
   var t0 = new Date().getTime();
   var before = AM.Pipeline._windowIds();
   var filterDir = AM.joinPath(opts.outputDir, AM.safeName(group.name));
   var mosaicPath = AM.joinPath(filterDir, "Mosaic_" + AM.safeName(group.name) + ".xisf");
   var failed = function(msg) {
      res.status = "FAILED"; res.message = msg; log.error("[" + group.name + "] " + msg);
   };
   var aborted = function() {
      res.status = "ABORTED"; res.message = "aborted by the user"; log.warn("[" + group.name + "] aborted by the user");
   };

   try {
      log.step("FILTER " + group.name + " (" + group.panels.length + " panels)");
      if (group.panels.length < 2) { failed("at least 2 panels are required"); return res; }
      if (File.exists(mosaicPath) && !opts.overwrite) {
         failed("output already exists and 'Overwrite existing files' is off: " + mosaicPath);
         return res;
      }
      AM.ensureDir(filterDir);
      var abort = abortFn || function() { return false; };

      // 1. Unique inputs, 2. Solve
      var inputs = AM.Pipeline._uniqueInputs(group, filterDir, log);
      var solveRes = AM.ImageSolver.run(inputs, { mode: opts.solveMode },
                        new AM.Context(AM.joinPath(filterDir, AM.DIR_SOLVED), abort));
      if (!solveRes.ok) { if (abort()) aborted(); else failed(solveRes.message); return res; }
      inputs = solveRes.outputs;
      if (abort()) { aborted(); return res; }

      // 3. Register
      console.abortEnabled = true;
      var mbc = AM.MBC.run(inputs, { geometry: geometry },
                           new AM.Context(AM.joinPath(filterDir, AM.DIR_REGISTERED), abort));
      if (!mbc.ok) { failed(mbc.message); return res; }
      res.geometry = mbc.data.geometry;
      if (geometry && mbc.data.overflow > 2)
         log.warn("[" + group.name + "] the panels extend about " + mbc.data.overflow +
                  " px beyond the shared mosaic area: part of the data is cropped.");
      if (abort()) { aborted(); return res; }

      // 4. Trim
      console.abortEnabled = true;
      var tmt = AM.TMT.run(mbc.outputs, { pixelSize: opts.pixelSize, focalLength: opts.focalLength },
                           new AM.Context(AM.joinPath(filterDir, AM.DIR_TRIMMED), abort));
      if (!tmt.ok) { failed(tmt.message); return res; }
      if (abort()) { aborted(); return res; }

      // 5. Join
      console.abortEnabled = true;
      var refIdx = Math.min(group.referencePanelIndex || 0, tmt.outputs.length - 1);
      var names = [];
      for (var i = 0; i < group.panels.length; ++i) names.push(group.panels[i].name);
      var pmm = AM.PMM.run(tmt.outputs, {
            referenceIndex: refIdx, outputPath: mosaicPath, keepPartials: !!opts.keepIntermediate,
            pixelSize: opts.pixelSize, focalLength: opts.focalLength,
            summary: "AutoMosaic " + AM.VERSION + " filter=" + group.name + " panels=" + names.join(",")
         }, new AM.Context(AM.joinPath(filterDir, AM.DIR_TRIMMED), abort));
      if (!pmm.ok) { failed(pmm.message); return res; }

      res.status = "OK";
      res.output = mosaicPath;
      log.note("[" + group.name + "] mosaic written: " + mosaicPath);
   } catch (e) {
      failed("unexpected error: " + e);
   } finally {
      AM.Pipeline._closeNewWindows(before);
      if (!opts.keepIntermediate && res.status === "OK") {
         AM.Pipeline._removeFiles(AM.joinPath(filterDir, AM.DIR_INPUT));
         AM.Pipeline._removeFiles(AM.joinPath(filterDir, AM.DIR_SOLVED));
         AM.Pipeline._removeFiles(AM.joinPath(filterDir, AM.DIR_REGISTERED));
         AM.Pipeline._removeFiles(AM.joinPath(filterDir, AM.DIR_TRIMMED));
      }
      res.seconds = (new Date().getTime() - t0) / 1000;
   }
   return res;
};
