// AM-Deliver.js - hands the finished mosaics to the user, then removes the temporary work folder.
//
//   * default: the cropped mosaic of each filter is opened in PixInsight as a new, unsaved image;
//   * the uncropped mosaic can be opened instead of, or as well as, the cropped one;
//   * only when the user asks for it (opts.saveFiles) the mosaics are also written to opts.outputDir.
//
// AM.Deliver.run(results, opts) -> { ok, problems:[string], kept:string }
//    'kept' is the work folder when something could not be saved (so that nothing is lost), otherwise "".

AM.Deliver = {};

// Plain-language explanation of the engine's error messages.
AM.Deliver.explain = function(msg)
{
   var m = "" + msg;
   var tips = [
      [/overlap|no common|do not overlap|too few clean samples|too few/i,
         "The panels of this filter do not overlap enough (or the overlap contains too little clean data). Adjacent panels need to share a sizeable area."],
      [/implausible|scale/i,
         "The photometric scale between two panels is implausible. Check that all panels of the filter have the same filter and were calibrated in the same way."],
      [/channel|different sizes|same size/i,
         "The panels have a different number of channels or sizes. All panels of one filter must be of the same kind."],
      [/plate solv|astrometric solution|could not find a solution/i,
         "The plate solving failed. Check the approximate coordinates, the focal length and the pixel size in ImageSolver, then run again. The mosaic itself is still delivered, without an astrometric solution."],
      [/cannot open|cannot save|disk|write/i,
         "A file could not be read or written. Check that the files exist and that the temporary folder has free space."],
      [/aborted/i, "The run was aborted."]
   ];
   for (var i = 0; i < tips.length; ++i) if (tips[i][0].test(m)) return m + "\n  -> " + tips[i][1];
   return m;
};

AM.Deliver._copyWindow = function(srcPath, id)
{
   var ws = ImageWindow.open(srcPath);
   if (!ws || ws.length < 1 || ws[0].isNull) throw "cannot open " + srcPath;
   var src = ws[0], dst = null;
   try {
      var img = src.mainView.image;
      dst = new ImageWindow(img.width, img.height, img.numberOfChannels, 32, true, img.isColor, id);
      dst.mainView.beginProcess(UndoFlag_NoSwapFile);
      dst.mainView.image.assign(img);
      dst.mainView.endProcess();
      dst.keywords = src.keywords;
      try { dst.copyAstrometricSolution(src); } catch (e) {
         try {
            var props = src.mainView.properties;
            for (var i = 0; i < props.length; ++i)
               if (props[i].indexOf("PCL:AstrometricSolution:") === 0)
                  dst.mainView.setPropertyValue(props[i], src.mainView.propertyValue(props[i]), src.mainView.propertyType(props[i]),
                                                PropertyAttribute_Storable | PropertyAttribute_Permanent);
            dst.regenerateAstrometricSolution();
         } catch (e2) {}
      }
      dst.show(); dst.zoomToFit();
      AM.Crop._autoStretch(dst);          // screen stretch only: the pixels are not changed
      return dst;
   } catch (e3) {
      if (dst && !dst.isNull) try { dst.forceClose(); } catch (e4) {}
      throw e3;
   } finally {
      try { src.forceClose(); } catch (e5) {}
   }
};

// Writes an open window to dir/name (existing file: removed only when overwrite is on).
AM.Deliver._saveWindow = function(win, dstDir, name, overwrite)
{
   var dst = AM.joinPath(dstDir, name);
   if (File.exists(dst)) {
      if (!overwrite) throw "the file already exists: " + dst;
      File.remove(dst);
   }
   if (!win.saveAs(dst, false, false, true, false)) throw "cannot write " + dst;
   return dst;
};

// Delivers the results. For every filter the cropped (default) and/or uncropped mosaic is opened in PixInsight.
// When opts.solveMosaic is on, each opened mosaic is plate solved in place with ImageSolver before it is saved;
// a failed or skipped solve never removes the mosaic: it is kept open and reported.
// Returns { ok, problems:[string], kept:string, opened:number }.
AM.Deliver._solved = {};

AM.Deliver.run = function(results, opts)
{
   AM.Deliver._solved = {};
   var problems = [], kept = false, opened = 0, i;
   var save = opts.saveFiles && opts.outputDir;
   if (save) {
      try { AM.ensureDir(opts.outputDir); } catch (e) {
         problems.push("The output folder cannot be created (" + opts.outputDir + "): " + e); save = false; kept = true;
      }
   }
   var solve = opts.solveMosaic === true;
   if (solve) {
      var chk = AM.checkTool("ImageSolver");
      if (!chk.ok) { problems.push("Plate solving of the mosaics skipped: " + chk.message); solve = false; }
   }
   for (i = 0; i < results.length; ++i) {
      var r = results[i];
      if (r.status !== "OK") continue;
      var crop = (r.cropOutput && File.exists(r.cropOutput)) ? r.cropOutput : "";
      var full = (r.output && File.exists(r.output)) ? r.output : "";
      var wantCrop = opts.openCropped === true, wantFull = opts.openUncropped === true;
      // if the crop failed, never leave the user without a mosaic
      if (wantCrop && !crop) {
         problems.push("[" + r.filter + "] the cropped mosaic is not available" + (r.cropMessage ? " (" + r.cropMessage + ")" : "") +
                       (full ? "; the uncropped one is opened instead." : "."));
         if (full) wantFull = true;
      }
      var list = [];
      if (wantCrop && crop) list.push({ path: crop, id: "_crop", label: "the cropped mosaic of filter " + r.filter, name: "_crop" });
      if (wantFull && full) list.push({ path: full, id: "", label: "the uncropped mosaic of filter " + r.filter, name: "" });
      var baseId = AM.Reg.viewId("Mosaic_" + r.filter);
      for (var k = 0; k < list.length; ++k) {
         var item = list[k], win = null;
         try {
            win = AM.Deliver._copyWindow(item.path, baseId + item.id);
            ++opened;
         } catch (e1) {
            problems.push("[" + r.filter + "] the mosaic could not be opened: " + e1); kept = true;
            continue;
         }
         if (solve) {
            // all filters share the same grid and crop: solve once per kind of mosaic, then copy the solution
            var kind = item.id === "_crop" ? "crop" : "full";
            var ref = AM.Deliver._solved[kind], img = win.mainView.image, sr = null;
            if (ref && ref.w === img.width && ref.h === img.height) {
               if (ref.ok) {
                  try { win.copyAstrometricSolution(ref.win); } catch (e4) {}
                  if (win.hasAstrometricSolution) { AM.Log.info("Astrometric solution copied to " + item.label); }
                  else sr = { ok: false, cancelled: false, message: "the astrometric solution could not be copied from the first mosaic" };
               } else sr = { ok: false, cancelled: ref.cancelled, message: ref.message };
            } else {
               sr = AM.Solve.mosaic(win, item.label);
               AM.Deliver._solved[kind] = { win: win, w: img.width, h: img.height, ok: sr.ok, cancelled: sr.cancelled, message: sr.message };
            }
            if (sr && !sr.ok) {
               problems.push("[" + r.filter + "] plate solving of " + item.label + " failed" +
                             (sr.cancelled ? " (cancelled)" : "") + ": " + (sr.message || "") +
                             ". The mosaic is delivered without an astrometric solution.");
            }
         }
         if (save) {
            try {
               if (item.id === "_crop" && opts.saveCropped) AM.Deliver._saveWindow(win, opts.outputDir, "Mosaic_" + AM.safeName(r.filter) + AM.CROP_SUFFIX + ".xisf", opts.overwrite);
               if (item.id === "" && opts.saveUncropped) AM.Deliver._saveWindow(win, opts.outputDir, "Mosaic_" + AM.safeName(r.filter) + ".xisf", opts.overwrite);
            } catch (e2) {
               problems.push("[" + r.filter + "] " + e2); kept = true;
            }
         }
      }
   }
   if (save && !kept) {
      try { AM.Log.save(AM.joinPath(opts.outputDir, "AutoMosaic_" + AM.timestamp() + ".log")); } catch (e3) {}
   }
   var keptDir = "";
   if (kept) { keptDir = AM._work; AM._work = ""; }      // not deleted: it still holds the only copy of the results
   else AM.cleanWork();
   return { ok: problems.length === 0, problems: problems, kept: keptDir, opened: opened };
};
