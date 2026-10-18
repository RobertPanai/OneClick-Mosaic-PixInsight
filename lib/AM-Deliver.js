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
      [/astrometric|solution/i,
         "A panel has no usable astrometric solution. Enable plate solving (ImageSolver) or solve the panel beforehand."],
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

AM.Deliver._saveCopy = function(src, dstDir, name, overwrite)
{
   var dst = AM.joinPath(dstDir, name);
   if (File.exists(dst)) {
      if (!overwrite) throw "the file already exists: " + dst;
      File.remove(dst);
   }
   File.copyFile(dst, src);
   if (!File.exists(dst)) throw "cannot write " + dst;
   return dst;
};

AM.Deliver.run = function(results, opts)
{
   var problems = [], kept = false, opened = 0, i;
   var save = opts.saveFiles && opts.outputDir;
   if (save) {
      try { AM.ensureDir(opts.outputDir); } catch (e) {
         problems.push("The output folder cannot be created (" + opts.outputDir + "): " + e); save = false; kept = true;
      }
   }
   for (i = 0; i < results.length; ++i) {
      var r = results[i];
      if (r.status !== "OK") continue;
      var crop = (r.cropOutput && File.exists(r.cropOutput)) ? r.cropOutput : "";
      var full = (r.output && File.exists(r.output)) ? r.output : "";
      var wantCrop = opts.openCropped, wantFull = opts.openUncropped;
      if (!opts.openCropped && !opts.openUncropped) { wantCrop = wantFull = false; }
      // if the crop failed, never leave the user without a mosaic
      if (wantCrop && !crop) {
         problems.push("[" + r.filter + "] the cropped mosaic is not available" + (r.cropMessage ? " (" + r.cropMessage + ")" : "") +
                       (full ? "; the uncropped one is opened instead." : "."));
         if (full) wantFull = true;
      }
      var id = AM.Reg.viewId("Mosaic_" + r.filter);
      try {
         if (wantCrop && crop) { AM.Deliver._copyWindow(crop, id + "_crop"); ++opened; }
         if (wantFull && full) { AM.Deliver._copyWindow(full, id); ++opened; }
      } catch (e1) {
         problems.push("[" + r.filter + "] the mosaic could not be opened: " + e1); kept = true;
      }
      if (save) {
         try {
            if (opts.saveCropped && crop) AM.Deliver._saveCopy(crop, opts.outputDir, File.extractNameAndExtension(crop), opts.overwrite);
            if (opts.saveUncropped && full) AM.Deliver._saveCopy(full, opts.outputDir, File.extractNameAndExtension(full), opts.overwrite);
            if ((opts.saveCropped && !crop) && !problems.length) AM.Log.warn("[" + r.filter + "] cropped mosaic not saved: it is not available");
         } catch (e2) {
            problems.push("[" + r.filter + "] " + e2); kept = true;
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
