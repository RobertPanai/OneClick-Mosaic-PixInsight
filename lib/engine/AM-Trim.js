// AM-Trim.js - integrated trim engine. Replaces TrimMosaicTile.
//
// Why: a reprojected panel has soft, anti-aliased edges, and ragged ones where stacking left gaps;
// the join needs hard edges (background right up to the border, then zero). This module erodes
// the valid area (a pixel is valid when it is non-zero in ALL channels) by N pixels from each of its
// four sides: a pixel is removed when any of the N pixels immediately above (top), below (bottom),
// to the left or to the right of it is not valid. The image border counts as not valid.
//
// Written from the behaviour documented in the TrimMosaicTile help page (J. Murphy), not from its code.
//
// AM.Trim.erode(win, opts)           trims an open window in place; returns { removed, valid }
// AM.Trim.run(files, options, ctx)   -> AM.StepResult, same contract as the legacy AM.TMT.run

AM.Trim = {};
AM.TRIM_DEFAULT = 5;   // pixels per side (same default effect as the legacy tool)

AM.Trim.erode = function(win, opts)
{
   opts = opts || {};
   var tT = opts.top !== undefined ? opts.top : AM.TRIM_DEFAULT;
   var tB = opts.bottom !== undefined ? opts.bottom : AM.TRIM_DEFAULT;
   var tL = opts.left !== undefined ? opts.left : AM.TRIM_DEFAULT;
   var tR = opts.right !== undefined ? opts.right : AM.TRIM_DEFAULT;
   var view = win.mainView, img = view.image;
   var W = img.width, H = img.height, nch = img.numberOfChannels;
   var keep = new Uint8Array(W * H);
   var rows = [];
   for (var c = 0; c < nch; ++c) rows.push(new Float32Array(W));
   var valid = new Uint8Array(W);
   var run = new Uint16Array(W);          // consecutive valid pixels ending at the previous row (top / bottom passes)
   var y, x, c2;

   var readValid = function(yy)
   {
      for (c2 = 0; c2 < nch; ++c2) img.getSamples(rows[c2], new Rect(0, yy, W, yy + 1), c2);
      var r0 = rows[0];
      for (x = 0; x < W; ++x) valid[x] = r0[x] > 0 ? 1 : 0;
      for (c2 = 1; c2 < nch; ++c2) {
         var rc = rows[c2];
         for (x = 0; x < W; ++x) if (!(rc[x] > 0)) valid[x] = 0;
      }
   };

   // pass 1, top to bottom: left/right (within the row) and top (run of valid pixels above)
   for (y = 0; y < H; ++y) {
      readValid(y);
      var base = y * W;
      // left/right: keep a pixel when its tL left neighbours and tR right neighbours are valid
      var runL = 0;
      for (x = 0; x < W; ++x) {                   // runL = valid pixels immediately to the left
         if (valid[x] && runL >= tL) keep[base + x] = 1;
         runL = valid[x] ? runL + 1 : 0;
      }
      var runR = 0;
      for (x = W - 1; x >= 0; --x) {
         if (runR < tR) keep[base + x] = 0;
         runR = valid[x] ? runR + 1 : 0;
      }
      for (x = 0; x < W; ++x) {
         if (run[x] < tT) keep[base + x] = 0;
         run[x] = valid[x] ? (run[x] < 65535 ? run[x] + 1 : run[x]) : 0;
      }
   }
   // pass 2, bottom to top: bottom
   for (x = 0; x < W; ++x) run[x] = 0;
   for (y = H - 1; y >= 0; --y) {
      readValid(y);
      var b2 = y * W;
      for (x = 0; x < W; ++x) {
         if (run[x] < tB) keep[b2 + x] = 0;
         run[x] = valid[x] ? (run[x] < 65535 ? run[x] + 1 : run[x]) : 0;
      }
   }
   // pass 3: zero everything that is not kept
   var removed = 0, left = 0;
   view.beginProcess(UndoFlag_NoSwapFile);
   try {
      for (y = 0; y < H; ++y) {
         var b3 = y * W, dirty = false;
         for (x = 0; x < W; ++x) if (!keep[b3 + x]) { dirty = true; break; }
         if (!dirty) { left += W; continue; }
         for (c2 = 0; c2 < nch; ++c2) img.getSamples(rows[c2], new Rect(0, y, W, y + 1), c2);
         for (x = 0; x < W; ++x) {
            if (keep[b3 + x]) { ++left; continue; }
            var was = false;
            for (c2 = 0; c2 < nch; ++c2)
               if (rows[c2][x] !== 0) { rows[c2][x] = 0; was = true; }
            if (was) ++removed;
         }
         for (c2 = 0; c2 < nch; ++c2) img.setSamples(rows[c2], new Rect(0, y, W, y + 1), c2);
      }
   } finally {
      view.endProcess();
   }
   return { removed: removed, valid: left };
};

AM.Trim.run = function(files, options, ctx)
{
   var log = ctx.log;
   var n = (options && options.pixels !== undefined) ? options.pixels : AM.TRIM_DEFAULT;
   AM.ensureDir(ctx.outDir);
   log.step("Trim (integrated engine): " + n + " px from every side of " + files.length + " panels");
   var outputs = [];
   for (var i = 0; i < files.length; ++i) {
      var win = null;
      try {
         if (ctx.abort()) return new AM.StepResult(false, outputs, "aborted by the user");
         var ws = ImageWindow.open(files[i]);
         if (!ws || ws.length < 1 || ws[0].isNull) throw "cannot open " + files[i];
         win = ws[0];
         var r = AM.Trim.erode(win, { top: n, bottom: n, left: n, right: n });
         log.info("Trimmed " + File.extractName(files[i]) + ": " + r.removed + " px removed");
         var kw = win.keywords;
         kw.push(new FITSKeyword("AMTRIM", "" + n, "AutoMosaic: pixels trimmed from every side"));
         win.keywords = kw;
         var out = ctx.outDir + "/" + File.extractName(files[i]) + ".xisf";
         if (File.exists(out)) File.remove(out);
         if (!win.saveAs(out, false, false, true, false)) throw "cannot save " + out;
         outputs.push(out);
      } catch (e) {
         return new AM.StepResult(false, outputs, "Trim failed on " + File.extractNameAndExtension(files[i]) + ": " + e);
      } finally {
         if (win && !win.isNull) win.forceClose();
      }
   }
   return new AM.StepResult(true, outputs, "");
};
