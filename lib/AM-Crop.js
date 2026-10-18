// AM-Crop.js - common, rotation-optimised autocrop of the finished mosaics.
//
// All mosaics of one run share the same pixel grid (shared geometry), so ONE crop
// rectangle (position, size and rotation) is computed from the intersection of the
// valid-data areas of every filter and applied identically to each of them. The result
// is the largest rectangle (any rotation) that contains no empty pixel, a safety margin
// away from every empty pixel. The same transform on every filter keeps sizes and star
// positions identical. Mosaics are read from disk and saved under new names (suffix
// "_crop"); the uncropped files are never modified.
//
// Algorithm
//  1. Mask: pixel valid <=> value > 0 in every channel (empty areas of a mosaic are 0).
//  2. Fine mask (1/2 resolution, minimum pooling = conservative) eroded by the margin;
//     coarse mask (1/8) with enclosed holes filled (isolated zero-valued pixels inside the
//     image are not "empty areas").
//  3. Angle search on coarse masks: for each angle, resample the mask in the rotated frame
//     and find the maximal all-valid rectangle (histogram method). Coarse scan (1/16, 1 deg),
//     then refinement (1/8, 0.1 deg).
//  4. Exact refinement on the fine mask: every side of the rectangle is pushed outwards
//     while the rectangle BOUNDARY stays on valid pixels (the valid region has no holes,
//     so boundary valid <=> whole rectangle valid), then the angle is fine tuned.
//  5. DynamicCrop (Lanczos) with that rectangle on every mosaic; each result is verified
//     (no empty pixel on the border of the cropped image).

AM.Crop = {};

AM.CROP_SUFFIX = "_crop";
AM.CROP_MARGIN = 4;               // pixels kept away from any empty pixel
AM.CROP_MIN_ROTATION_GAIN = 0.005;// rotation is used only if it keeps >= 0.5% more image than the best axis-aligned crop

// ---------------------------------------------------------------------------
// masks

// Opens a mosaic and returns {fineW, fineH, fine:Uint8Array, coarseW, coarseH, coarse:Uint8Array, width, height, channels}
// fine: factor 2, coarse: factor 8 (both minimum pooled, i.e. conservative).
AM.Crop._masks = function(path, log)
{
   var win = ImageWindow.open(path)[0];
   if (!win) throw "cannot open " + path;
   var mw = null;
   try {
      win.hide();
      var img = win.mainView.image;
      var W = img.width, H = img.height, C = img.numberOfChannels;
      var srcId = "AM_crop_src";
      win.mainView.id = srcId;
      srcId = win.mainView.id;
      var expr;
      if (C == 1) expr = "iif(" + srcId + ">0,1,0)";
      else {
         var terms = [];
         for (var c = 0; c < Math.min(C, 3); ++c) terms.push(srcId + "[" + c + "]>0");
         expr = "iif(" + terms.join(" && ") + ",1,0)";
      }
      var P = new PixelMath;
      P.expression = expr;
      P.useSingleExpression = true;
      P.createNewImage = true;
      P.showNewImage = false;
      P.newImageId = "AM_crop_mask";
      P.newImageWidth = 0; P.newImageHeight = 0;
      P.newImageAlpha = false;
      P.newImageColorSpace = PixelMath.prototype.Gray;
      P.newImageSampleFormat = PixelMath.prototype.f32;
      P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1; P.rescale = false;
      P.executeOn(win.mainView);
      mw = ImageWindow.windowById("AM_crop_mask");
      if (mw.isNull) throw "mask creation failed";
      // the source is no longer needed
      win.forceClose(); win = null;

      var out = { width: W, height: H, channels: C };
      var R = new IntegerResample;
      R.downsamplingMode = IntegerResample.prototype.Minimum;
      R.zoomFactor = -2;
      R.executeOn(mw.mainView);
      var fi = mw.mainView.image;
      out.fineW = fi.width; out.fineH = fi.height;
      out.fine = AM.Crop._readMask(fi);
      R.zoomFactor = -4;
      R.executeOn(mw.mainView);
      var ci = mw.mainView.image;
      out.coarseW = ci.width; out.coarseH = ci.height;
      out.coarse = AM.Crop._readMask(ci);
      return out;
   } finally {
      if (win) try { win.forceClose(); } catch (e) {}
      if (mw && !mw.isNull) try { mw.forceClose(); } catch (e) {}
   }
};

AM.Crop._readMask = function(image)
{
   var w = image.width, h = image.height;
   var u = new Uint8Array(w * h);
   var row = new Float32Array(w);
   for (var y = 0; y < h; ++y) {
      image.getSamples(row, new Rect(0, y, w, y + 1), 0);
      var o = y * w;
      for (var x = 0; x < w; ++x) u[o + x] = row[x] > 0.5 ? 1 : 0;
   }
   return u;
};

// Square erosion of a binary mask by m cells (cells at distance <= m from an invalid cell
// or from the image border... the border is NOT treated as invalid: images are edge-to-edge).
AM.Crop._erode = function(a, w, h, m)
{
   if (m <= 0) return a;
   var t = new Uint8Array(w * h), x, y, d, o;
   // horizontal
   for (y = 0; y < h; ++y) {
      o = y * w; d = 1e9;
      var left = new Int32Array(w);
      for (x = 0; x < w; ++x) { d = a[o + x] ? d + 1 : 0; left[x] = d; }
      d = 1e9;
      for (x = w - 1; x >= 0; --x) { d = a[o + x] ? d + 1 : 0; t[o + x] = (a[o + x] && left[x] > m && d > m) ? 1 : 0; }
   }
   var r = new Uint8Array(w * h);
   var up = new Int32Array(h);
   for (x = 0; x < w; ++x) {
      d = 1e9;
      for (y = 0; y < h; ++y) { d = t[y * w + x] ? d + 1 : 0; up[y] = d; }
      d = 1e9;
      for (y = h - 1; y >= 0; --y) { d = t[y * w + x] ? d + 1 : 0; r[y * w + x] = (t[y * w + x] && up[y] > m && d > m) ? 1 : 0; }
   }
   return r;
};

// Fills the invalid regions that do not touch the image border.
AM.Crop._fillHoles = function(a, w, h)
{
   var n = w * h, mark = new Uint8Array(n), q = new Int32Array(n), qh = 0, qt = 0, i, x, y;
   var push = function(k) { if (!a[k] && !mark[k]) { mark[k] = 1; q[qt++] = k; } };
   for (x = 0; x < w; ++x) { push(x); push((h - 1) * w + x); }
   for (y = 0; y < h; ++y) { push(y * w); push(y * w + w - 1); }
   while (qh < qt) {
      i = q[qh++]; x = i % w; y = (i - x) / w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
   }
   var r = new Uint8Array(n), filled = 0;
   for (i = 0; i < n; ++i) { if (a[i] || !mark[i]) { r[i] = 1; if (!a[i]) ++filled; } }
   return { mask: r, filled: filled };
};

// Coarser version of a mask by an integer factor (minimum pooling).
AM.Crop._pool = function(a, w, h, f)
{
   var nw = Math.floor(w / f), nh = Math.floor(h / f), r = new Uint8Array(nw * nh);
   for (var y = 0; y < nh; ++y)
      for (var x = 0; x < nw; ++x) {
         var v = 1;
         for (var j = 0; j < f && v; ++j) {
            var o = (y * f + j) * w + x * f;
            for (var i = 0; i < f; ++i) if (!a[o + i]) { v = 0; break; }
         }
         r[y * nw + x] = v;
      }
   return { mask: r, w: nw, h: nh };
};

// AND of several masks of identical size
AM.Crop._and = function(list)
{
   var r = new Uint8Array(list[0]);
   for (var k = 1; k < list.length; ++k) {
      var b = list[k];
      for (var i = 0; i < r.length; ++i) if (!b[i]) r[i] = 0;
   }
   return r;
};

// ---------------------------------------------------------------------------
// geometry

// Largest all-valid rectangle of the mask resampled in a frame rotated by theta
// (radians) about the mask centre. Returns {area, u0, v0, u1, v1} in rotated-frame
// cell units relative to the centre (rectangle = [u0,u1) x [v0,v1)).
AM.Crop._bestRect = function(a, w, h, theta)
{
   var cs = Math.cos(theta), sn = Math.sin(theta);
   var cx = w / 2, cy = h / 2;
   var bw = Math.ceil(w * Math.abs(cs) + h * Math.abs(sn)), bh = Math.ceil(w * Math.abs(sn) + h * Math.abs(cs));
   var heights = new Int32Array(bw);
   var stackI = new Int32Array(bw + 1), stackH = new Int32Array(bw + 1);
   var best = { area: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
   var u0 = -bw / 2, v0 = -bh / 2;
   for (var j = 0; j < bh; ++j) {
      var v = v0 + j + 0.5;
      for (var i = 0; i < bw; ++i) {
         var u = u0 + i + 0.5;
         var xs = cx + u * cs - v * sn, ys = cy + u * sn + v * cs;
         var xi = Math.floor(xs), yi = Math.floor(ys);
         var ok = xi >= 0 && yi >= 0 && xi < w && yi < h && a[yi * w + xi];
         heights[i] = ok ? heights[i] + 1 : 0;
      }
      // maximal rectangle in histogram
      var sp = 0;
      for (var i2 = 0; i2 <= bw; ++i2) {
         var hh = (i2 < bw) ? heights[i2] : 0;
         var start = i2;
         while (sp > 0 && stackH[sp - 1] >= hh) {
            --sp;
            var ar = stackH[sp] * (i2 - stackI[sp]);
            if (ar > best.area) {
               best.area = ar; best.u0 = u0 + stackI[sp]; best.u1 = u0 + i2;
               best.v1 = v0 + j + 1; best.v0 = best.v1 - stackH[sp];
            }
            start = stackI[sp];
         }
         stackI[sp] = start; stackH[sp] = hh; ++sp;
      }
   }
   return best;
};

// Is the BOUNDARY of the rectangle fully on valid cells? The rectangle is given in the frame
// rotated by theta about (px,py): [u0,u1] x [v0,v1] (cell units of the mask, step = 1 cell).
AM.Crop._boundaryValid = function(a, w, h, px, py, theta, u0, v0, u1, v1)
{
   var cs = Math.cos(theta), sn = Math.sin(theta);
   var test = function(u, v) {
      var x = px + u * cs - v * sn, y = py + u * sn + v * cs;
      var xi = Math.floor(x), yi = Math.floor(y);
      return xi >= 0 && yi >= 0 && xi < w && yi < h && a[yi * w + xi] == 1;
   };
   var n, k, step = 0.5;
   n = Math.ceil((u1 - u0) / step);
   for (k = 0; k <= n; ++k) { var u = u0 + (u1 - u0) * k / n; if (!test(u, v0) || !test(u, v1)) return false; }
   n = Math.ceil((v1 - v0) / step);
   for (k = 0; k <= n; ++k) { var v = v0 + (v1 - v0) * k / n; if (!test(u0, v) || !test(u1, v)) return false; }
   return true;
};

// Pushes the four sides outwards (coordinate ascent) while the boundary stays valid.
// Rectangle in {u0,v0,u1,v1}; returns the improved rectangle (never worse than the input if valid).
AM.Crop._grow = function(a, w, h, px, py, theta, r)
{
   var cur = { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 };
   var lim = Math.sqrt(w * w + h * h);
   var tryRect = function(c) { return AM.Crop._boundaryValid(a, w, h, px, py, theta, c.u0, c.v0, c.u1, c.v1); };
   for (var round = 0; round < 12; ++round) {
      var gained = 0;
      var sides = ["u0", "v0", "u1", "v1"], dirs = [-1, -1, 1, 1];
      for (var s = 0; s < 4; ++s) {
         var key = sides[s], d = dirs[s];
         var lo = 0, hi = 1;      // extension in cells
         // exponential search for a failing extension
         var ok = true;
         while (ok && hi < lim) {
            var t = { u0: cur.u0, v0: cur.v0, u1: cur.u1, v1: cur.v1 };
            t[key] += d * hi;
            if (tryRect(t)) { lo = hi; hi *= 2; } else ok = false;
         }
         // bisection to 0.25 cell
         while (hi - lo > 0.25) {
            var mid = (lo + hi) / 2;
            var t2 = { u0: cur.u0, v0: cur.v0, u1: cur.u1, v1: cur.v1 };
            t2[key] += d * mid;
            if (tryRect(t2)) lo = mid; else hi = mid;
         }
         if (lo > 0) { cur[key] += d * lo; gained += lo; }
      }
      if (gained < 0.25) break;
   }
   return cur;
};

AM.Crop._rectArea = function(r) { return (r.u1 - r.u0) * (r.v1 - r.v0); };

// Full optimisation on the combined masks. Returns {theta (rad), cx, cy, width, height} in full-resolution
// pixels (the rotated rectangle is centred at (cx,cy)), plus diagnostics.
AM.Crop.optimize = function(M, allowRotation, log)
{
   var fine = M.fine, fw = M.fineW, fh = M.fineH;                    // eroded fine mask (factor 2)
   var cw = M.coarseW, ch = M.coarseH;                               // factor 8 (holes filled)
   var coarse = M.coarse;
   var c16 = AM.Crop._pool(coarse, cw, ch, 2);                       // factor 16
   var t0 = new Date().getTime();

   // 1. angle scan
   var bestTheta = 0, bestArea = -1, a0 = 0, deg = Math.PI / 180;
   var scan = allowRotation ? [] : [0];
   if (allowRotation) for (var d = -45; d < 45; d += 1) scan.push(d * deg);
   else scan = [0];
   for (var i = 0; i < scan.length; ++i) {
      var b = AM.Crop._bestRect(c16.mask, c16.w, c16.h, scan[i]);
      if (scan[i] == 0) a0 = b.area;
      if (b.area > bestArea) { bestArea = b.area; bestTheta = scan[i]; }
   }
   log("  angle scan (coarse): best " + (bestTheta / deg).toFixed(2) + " deg  (" + ((new Date().getTime() - t0) / 1000).toFixed(1) + " s)");
   // 2. refinement on 1/8
   var cands = [];
   if (allowRotation) {
      for (var k = -10; k <= 10; ++k) cands.push(bestTheta + k * 0.1 * deg);
   } else cands.push(0);
   var bestR = null, bestRA = -1, bestRT = 0;
   for (var q = 0; q < cands.length; ++q) {
      var rr = AM.Crop._bestRect(coarse, cw, ch, cands[q]);
      if (rr.area > bestRA) { bestRA = rr.area; bestR = rr; bestRT = cands[q]; }
   }
   if (allowRotation) {
      // comparison with the best axis-aligned rectangle
      var r0 = AM.Crop._bestRect(coarse, cw, ch, 0);
      a0 = r0.area;
      log("  best rotated rectangle: " + (bestRT / deg).toFixed(2) + " deg, area vs axis-aligned: " +
          (100 * (bestRA / a0 - 1)).toFixed(2) + "%");
      if (bestRA < a0 * (1 + AM.CROP_MIN_ROTATION_GAIN)) {
         log("  rotation gain below " + (100 * AM.CROP_MIN_ROTATION_GAIN) + "%: using an axis-aligned crop (no resampling)");
         bestRT = 0; bestR = r0; bestRA = a0;
      }
   }
   // 3. exact refinement on the fine mask. Level-A rectangle (coarse cells, centred frame) -> fine pixels
   var scale = 4;      // coarse cell = 4 fine cells
   var px = cw * 2, py = ch * 2;      // same pivot as the coarse frame (top-left aligned grids)
   var theta = bestRT;
   var start = { u0: bestR.u0 * scale, v0: bestR.v0 * scale, u1: bestR.u1 * scale, v1: bestR.v1 * scale };
   var shrink = function(r, s) { return { u0: r.u0 + s, v0: r.v0 + s, u1: r.u1 - s, v1: r.v1 - s }; };
   var cur = start, tries = 0;
   while (!AM.Crop._boundaryValid(fine, fw, fh, px, py, theta, cur.u0, cur.v0, cur.u1, cur.v1) && tries < 200) {
      cur = shrink(cur, 2); ++tries;
   }
   if (tries >= 200) throw "cannot find a valid crop rectangle";
   cur = AM.Crop._grow(fine, fw, fh, px, py, theta, cur);
   var bestFine = cur, bestFineTheta = theta;
   if (allowRotation && theta != 0) {
      for (var k2 = -6; k2 <= 6; ++k2) {
         if (k2 == 0) continue;
         var th = theta + k2 * 0.03 * deg;
         var s2 = shrink(bestFine, 3), tt = 0;
         while (!AM.Crop._boundaryValid(fine, fw, fh, px, py, th, s2.u0, s2.v0, s2.u1, s2.v1) && tt < 100) { s2 = shrink(s2, 2); ++tt; }
         if (tt >= 100) continue;
         var g = AM.Crop._grow(fine, fw, fh, px, py, th, s2);
         if (AM.Crop._rectArea(g) > AM.Crop._rectArea(bestFine)) { bestFine = g; bestFineTheta = th; }
      }
   }
   // to full-resolution pixel units (fine cell = 2 px); centre of the rectangle
   var cs = Math.cos(bestFineTheta), sn = Math.sin(bestFineTheta);
   var uc = (bestFine.u0 + bestFine.u1) / 2, vc = (bestFine.v0 + bestFine.v1) / 2;
   var cxF = px + uc * cs - vc * sn, cyF = py + uc * sn + vc * cs;
   var res = {
      theta: bestFineTheta,
      cx: cxF * 2, cy: cyF * 2,
      width: Math.floor((bestFine.u1 - bestFine.u0) * 2),
      height: Math.floor((bestFine.v1 - bestFine.v0) * 2),
      axisArea: a0 * 64, seconds: (new Date().getTime() - t0) / 1000
   };
   return res;
};

// ---------------------------------------------------------------------------
// application

// Applies the crop to the mosaic in 'srcPath' and saves it as 'dstPath'. Returns the output size.
AM.Crop.apply = function(srcPath, dstPath, crop, angleSign)
{
   var win = ImageWindow.open(srcPath)[0];
   if (!win) throw "cannot open " + srcPath;
   try {
      win.hide();
      var img = win.mainView.image;
      var W = img.width, H = img.height;
      var P = new DynamicCrop;
      P.refWidth = W; P.refHeight = H;
      P.centerX = crop.cx / W; P.centerY = crop.cy / H;
      P.width = crop.width / W; P.height = crop.height / H;
      P.outWidth = crop.width; P.outHeight = crop.height;
      P.angle = angleSign * crop.theta;
      P.scaleX = 1; P.scaleY = 1;
      P.optimizeFast = false;
      P.interpolation = DynamicCrop.prototype.Lanczos3;
      P.clampingThreshold = 0.3;
      P.noGUIMessages = true;
      P.executeOn(win.mainView);
      var out = win.mainView.image;
      var info = { width: out.width, height: out.height, edgeMin: AM.Crop._edgeMin(out) };
      if (dstPath) win.saveAs(dstPath, false, false, false, false);
      return info;
   } finally {
      try { win.forceClose(); } catch (e) {}
   }
};

// Minimum value over a 1-pixel ring along the borders of an image (all channels).
AM.Crop._edgeMin = function(img)
{
   var w = img.width, h = img.height, m = 1e9, r = [new Rect(0, 0, w, 1), new Rect(0, h - 1, w, h), new Rect(0, 0, 1, h), new Rect(w - 1, 0, w, h)];
   for (var i = 0; i < r.length; ++i) {
      img.selectedRect = r[i];
      m = Math.min(m, img.minimum());
   }
   img.resetSelections();
   return m;
};

// ---------------------------------------------------------------------------
// driver

AM.Crop.cropPath = function(path)
{
   var dir = File.extractDrive(path) + File.extractDirectory(path);
   return AM.joinPath(dir, File.extractName(path) + AM.CROP_SUFFIX + File.extractExtension(path));
};

// Computes one crop common to all given mosaic files (they must have the same size).
AM.Crop.plan = function(paths, opts, log)
{
   var fines = [], coarses = [], first = null;
   for (var i = 0; i < paths.length; ++i) {
      log("  analysing " + paths[i]);
      var M = AM.Crop._masks(paths[i], log);
      if (!first) first = M;
      else if (M.width != first.width || M.height != first.height)
         throw "mosaics have different sizes (" + M.width + "x" + M.height + " vs " + first.width + "x" + first.height + ")";
      fines.push(M.fine); coarses.push(M.coarse);
   }
   var m = Math.ceil((opts.cropMargin > 0 ? opts.cropMargin : AM.CROP_MARGIN) / 2);
   var fine = AM.Crop._erode(AM.Crop._and(fines), first.fineW, first.fineH, m);
   var co = AM.Crop._fillHoles(AM.Crop._and(coarses), first.coarseW, first.coarseH);
   if (co.filled > 0) log("  " + co.filled + " enclosed empty cell(s) at 1/8 scale treated as data");
   var M2 = { fine: fine, fineW: first.fineW, fineH: first.fineH, coarse: co.mask, coarseW: first.coarseW, coarseH: first.coarseH };
   var crop = AM.Crop.optimize(M2, opts.cropRotation !== false, log);
   crop.srcWidth = first.width; crop.srcHeight = first.height;
   return crop;
};

AM.Crop.describe = function(c)
{
   return c.width + "x" + c.height + " px, rotation " + (c.theta * 180 / Math.PI).toFixed(3) + " deg, centre (" +
          c.cx.toFixed(1) + ", " + c.cy.toFixed(1) + ") of " + c.srcWidth + "x" + c.srcHeight;
};

// Crops the OK results of a run. Adds .cropOutput / .cropMessage to each AM.FilterResult.
AM.Crop.run = function(results, opts, abortFn)
{
   var ok = [];
   for (var i = 0; i < results.length; ++i)
      if (results[i].status == "OK" && results[i].output && File.exists(results[i].output)) ok.push(results[i]);
   if (ok.length == 0) return;
   var log = function(t) { AM.Log.info(t); };
   AM.Log.note("Autocrop: " + ok.length + " mosaic(s)");
   var groups = [];
   if (opts.sharedGeometry || ok.length == 1) groups.push(ok);
   else {
      AM.Log.warn("Geometry is not shared between filters: each mosaic gets its own crop, so sizes will differ.");
      for (var g = 0; g < ok.length; ++g) groups.push([ok[g]]);
   }
   for (var gi = 0; gi < groups.length; ++gi) {
      var grp = groups[gi], crop = null;
      try {
         var paths = [];
         for (var k = 0; k < grp.length; ++k) paths.push(grp[k].output);
         crop = AM.Crop.plan(paths, opts, log);
         AM.Log.note("Crop: " + AM.Crop.describe(crop));
      } catch (e) {
         for (var k2 = 0; k2 < grp.length; ++k2) grp[k2].cropMessage = "crop failed: " + e;
         AM.Log.error("Autocrop failed: " + e);
         continue;
      }
      for (var k3 = 0; k3 < grp.length; ++k3) {
         var r = grp[k3];
         if (abortFn && abortFn()) { r.cropMessage = "aborted"; continue; }
         var dst = AM.Crop.cropPath(r.output);
         try {
            if (File.exists(dst)) File.remove(dst);
            var info = AM.Crop._applyVerified(r.output, dst, crop);
            r.cropOutput = dst;
            AM.Log.note("[" + r.filter + "] cropped mosaic: " + dst + " (" + info.width + "x" + info.height + ")");
         } catch (e2) {
            r.cropMessage = "crop failed: " + e2;
            AM.Log.error("[" + r.filter + "] " + r.cropMessage);
         }
      }
   }
};

// DynamicCrop with the rotation convention found valid for this PixInsight build: the result must have the
// requested size and no empty pixel on its border; the opposite angle sign is tried if the first one fails.
AM.Crop._applyVerified = function(src, dst, crop)
{
   var order = (AM.Crop._angleSign === -1) ? [-1, 1] : [1, -1];
   if (crop.theta == 0) order = [1];
   var last = "";
   for (var i = 0; i < order.length; ++i) {
      var info = AM.Crop.apply(src, null, crop, order[i]);
      if (info.width == crop.width && info.height == crop.height && info.edgeMin > 0) {
         AM.Crop._angleSign = order[i];
         return AM.Crop.apply(src, dst, crop, order[i]);
      }
      last = "size " + info.width + "x" + info.height + ", border minimum " + info.edgeMin;
   }
   throw "the cropped image failed verification (" + last + ")";
};

// ---------------------------------------------------------------------------
// display

// Standard linked auto-stretch (shadows clipping -2.8 sigma, target background 0.25).
AM.Crop._autoStretch = function(win)
{
   try {
      var img = win.mainView.image;
      var mtf = function(m, x) { return x <= 0 ? 0 : (x >= 1 ? 1 : (m - 1) * x / ((2 * m - 1) * x - m)); };
      var stf = [], n = Math.min(img.numberOfChannels, 3);
      var med = 0, mad = 0;
      for (var c = 0; c < n; ++c) {
         img.selectedChannel = c;
         med += img.median() / n;
         mad += img.MAD() / n;
      }
      img.resetSelections();
      var c0 = Math.max(0, med + (-2.8) * 1.4826 * mad);
      var m = mtf(0.25, (med - c0) / (1 - c0));
      for (var k = 0; k < 4; ++k) stf.push([c0, m, 1, 0, 1]);   // PixInsight order: shadows, midtones, highlights, low range, high range
      win.mainView.stf = stf;
   } catch (e) {}
};
