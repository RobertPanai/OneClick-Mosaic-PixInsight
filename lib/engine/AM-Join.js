// AM-Join.js - integrated join engine: joins registered, trimmed panels into one mosaic.
// Pipeline for each pair (reference, target): overlap analysis ->
// photometric scale -> gradient model -> composition. See the other AM-*.js files of this folder.
//
// AM.Join.pair(refWin, tgtWin, opts, log) -> { win, info }   (the caller closes win)
// AM.Join.run(files, options, ctx)        -> AM.StepResult
//     options.referenceIndex, options.outputPath, options.keepPartials, options.summary,
//     options.mode ("overlay" | "average" | "blend")

AM.Join = {};

AM.Join.pair = function(refWin, tgtWin, opts, log, id)
{
   opts = opts || {};
   if (!("photometry" in opts)) opts.photometry = null;
   if (!("gradient" in opts)) opts.gradient = null;
   var a = refWin.mainView.image, b = tgtWin.mainView.image;
   var t0 = new Date().getTime(), t1;
   var ov = AM.Overlap.analyse(a, b);
   log.info("  overlap: " + ov.nBoth + " px, bbox " + (ov.bbox.x1 - ov.bbox.x0 + 1) + "x" + (ov.bbox.y1 - ov.bbox.y0 + 1) +
            ", " + (ov.vertical ? "vertical" : "horizontal") + " join");
   var ph = AM.Photometry.analyse(a, b, ov, opts.photometry);
   var sc = [];
   for (var c = 0; c < ph.scale.length; ++c) sc.push(ph.method[c] + " scale " + ph.scale[c].toFixed(5) + " (" + ph.nStars[c] + " stars)");
   log.info("  " + sc.join(", "));
   var model = AM.Gradient.build(a, b, ov, ph.scale, ph.stars, opts.gradient);
   log.info("  gradient: " + model.nAll + " samples (" + model.nOverlapModel + " in the overlap model, " + model.nTargetModel + " in the target model), size " + model.g + " px");
   var mode = opts.mode || "overlay";
   var res = AM.Combine.residual(a, b, ov, ph.scale, model);
   var rr = [];
   for (var k = 0; k < res.mean.length; ++k) rr.push("mean " + res.mean[k].toExponential(1) + " rms " + res.rms[k].toExponential(1) + " noise " + res.noise[k].toExponential(1));
   log.info("  residual in the overlap after correction: " + rr.join(" | "));
   var out = AM.Combine.compose(refWin, a, b, ov, ph.scale, model, { mode: mode, offset: opts.offset || 0, sizePct: opts.sizePct || 90 }, id);
   log.info("  joined in " + ((new Date().getTime() - t0) / 1000).toFixed(1) + " s");
   return { win: out, info: { overlap: ov, photometry: ph, residual: res, model: model } };
};

// Bounding box of the valid pixels of an image (coarse, every 8th row).
AM.Join.validBox = function(img)
{
   var W = img.width, H = img.height, row = new Float32Array(W), b = { x0: W, y0: H, x1: -1, y1: -1 };
   for (var y = 0; y < H; y += 8) {
      img.getSamples(row, new Rect(0, y, W, y + 1), 0);
      var f = -1, l = -1;
      for (var x = 0; x < W; ++x) if (row[x] > 0) { if (f < 0) f = x; l = x; }
      if (f >= 0) { if (f < b.x0) b.x0 = f; if (l > b.x1) b.x1 = l; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
   }
   return b;
};

AM.Join.run = function(files, options, ctx)
{
   var log = ctx.log;
   AM.ensureDir(ctx.outDir);
   var wins = {};            // node id -> ImageWindow
   var cleanup = function() { for (var k in wins) try { if (wins[k] && !wins[k].isNull) wins[k].forceClose(); } catch (e) {} };
   try {
      log.step("Join (integrated engine) of " + files.length + " panels");
      var n = files.length, boxes = [], i;
      for (i = 0; i < n; ++i) {
         var ws = ImageWindow.open(files[i]);
         if (!ws || ws.length < 1 || ws[0].isNull) throw "cannot open " + files[i];
         wins[i] = ws[0];
         boxes.push(AM.Join.validBox(ws[0].mainView.image));
      }
      var refIdx = (options && options.referenceIndex) || 0;
      var plan = AM.Layout.plan(boxes, refIdx);
      log.info("Join plan:\n" + AM.Layout.describe(plan, boxes));
      var result = null;
      for (var s = 0; s < plan.steps.length; ++s) {
         if (ctx.abort()) { cleanup(); return new AM.StepResult(false, [], "aborted by the user"); }
         var st = plan.steps[s], nodeId = n + s, last = (s === plan.steps.length - 1);
         log.info("Join " + (s + 1) + "/" + plan.steps.length + ": node " + st.tgt + " into node " + st.ref);
         var r = AM.Join.pair(wins[st.ref], wins[st.tgt], { mode: options && options.mode }, log, AM.Reg.viewId("AM_join" + (s + 1)));
         wins[nodeId] = r.win;
         // nodes consumed by this step are no longer needed
         try { wins[st.ref].forceClose(); } catch (e1) {}
         try { wins[st.tgt].forceClose(); } catch (e2) {}
         delete wins[st.ref]; delete wins[st.tgt];
         if (!last && options && options.keepPartials) {
            var pp = ctx.outDir + "/partial_" + (s + 1) + ".xisf";
            if (File.exists(pp)) File.remove(pp);
            wins[nodeId].saveAs(pp, false, false, true, false);
         }
         result = nodeId;
      }
      if (result === null) throw "nothing to join";
      var w = wins[result];
      if (options && options.summary) {
         var kw = w.keywords;
         kw.push(new FITSKeyword("HISTORY", "", options.summary));
         w.keywords = kw;
      }
      var outPath = (options && options.outputPath) ? options.outputPath : (ctx.outDir + "/Mosaic.xisf");
      if (File.exists(outPath)) File.remove(outPath);
      if (!w.saveAs(outPath, false, false, true, false)) throw "cannot save " + outPath;
      cleanup();
      return new AM.StepResult(true, [outPath], "");
   } catch (e) {
      cleanup();
      return new AM.StepResult(false, [], "Join: " + e);
   }
};
