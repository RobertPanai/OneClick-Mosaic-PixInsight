// AM-Pipeline.js - the sequence of steps for one filter.
//
//   Registration -> Trim -> Join      (plate solving, if needed, is done before, see AM-Solve.js)
//
// Everything is written to the temporary work folder (opts.workDir), which is deleted at the end of the run:
//   <work>/<filter>/00_input/       copies of panels whose file names would collide
//   <work>/<filter>/02_registered/  registered panels (_ra)
//   <work>/<filter>/03_trimmed/     trimmed panels (and partial mosaics)
//   <work>/<filter>/Mosaic_<filter>.xisf

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

// Makes sure no two panels of a group share a file name (the registered file name derives from
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
//   geometry : null (automatic geometry) or a GeometrySpec to impose
// Returns an AM.FilterResult (result.geometry = geometry used).
AM.Pipeline.runFilter = function(group, opts, geometry, abortFn)
{
   var log = AM.Log;
   var res = new AM.FilterResult(group.name);
   var t0 = new Date().getTime();
   var before = AM.Pipeline._windowIds();
   var filterDir = AM.joinPath(opts.workDir, AM.safeName(group.name));
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
      AM.ensureDir(filterDir);
      var abort = abortFn || function() { return false; };

      // 1. Unique inputs
      var inputs = AM.Pipeline._uniqueInputs(group, filterDir, log);
      if (abort()) { aborted(); return res; }

      // 3. Register
      console.abortEnabled = true;
      var reg = AM.Reg.run(inputs, { geometry: geometry },
                           new AM.Context(AM.joinPath(filterDir, AM.DIR_REGISTERED), abort));
      if (!reg.ok) { failed(reg.message); return res; }
      res.geometry = reg.data.geometry;
      if (geometry && reg.data.overflow > 2)
         log.warn("[" + group.name + "] the panels extend about " + reg.data.overflow +
                  " px beyond the shared mosaic area: part of the data is cropped.");
      if (abort()) { aborted(); return res; }

      // 4. Trim
      console.abortEnabled = true;
      var trim = AM.Trim.run(reg.outputs, {},
                           new AM.Context(AM.joinPath(filterDir, AM.DIR_TRIMMED), abort));
      if (!trim.ok) { failed(trim.message); return res; }
      if (abort()) { aborted(); return res; }

      // 5. Join
      console.abortEnabled = true;
      var refIdx = Math.min(group.referencePanelIndex || 0, trim.outputs.length - 1);
      var names = [];
      for (var i = 0; i < group.panels.length; ++i) names.push(group.panels[i].name);
      var joined = AM.Join.run(trim.outputs, {
            referenceIndex: refIdx, outputPath: mosaicPath, keepPartials: false,
            summary: "AutoMosaic " + AM.VERSION + " filter=" + group.name + " panels=" + names.join(",")
         }, new AM.Context(AM.joinPath(filterDir, AM.DIR_TRIMMED), abort));
      if (!joined.ok) { failed(joined.message); return res; }

      res.status = "OK";
      res.output = mosaicPath;
      log.note("[" + group.name + "] mosaic written: " + mosaicPath);
   } catch (e) {
      failed("unexpected error: " + e);
   } finally {
      AM.Pipeline._closeNewWindows(before);
      if (res.status === "OK") {      // free the disk space of the intermediate files as soon as possible
         AM.removeTree(AM.joinPath(filterDir, AM.DIR_INPUT));
         AM.removeTree(AM.joinPath(filterDir, AM.DIR_REGISTERED));
         AM.removeTree(AM.joinPath(filterDir, AM.DIR_TRIMMED));
      }
      res.seconds = (new Date().getTime() - t0) / 1000;
   }
   return res;
};
