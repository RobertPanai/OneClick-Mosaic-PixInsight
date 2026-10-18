// AM-Combine.js - integrated join engine, part 4: builds the joined image.
//
// For every pixel: only one panel has data -> that panel (the target is brought to the reference with
// its scale and gradient correction); both have data -> the side of the join line decides (Overlay),
// or, on the reference side of the line within the join region, a transition (Average / Blend).
//
// AM.Combine.compose(refWin, a, b, ov, scale, model, opts, id) -> new ImageWindow
//   opts.mode      "overlay" | "average" | "blend"
//   opts.offset    join line offset from the centre of the overlap, px (default 0)
//   opts.sizePct   join region as % of the reference side of the overlap (average/blend), default 90

AM.Combine = {};

AM.Combine.defaults = function() { return { mode: "overlay", offset: 0, sizePct: 90 }; };

AM.Combine.compose = function(refWin, a, b, ov, scale, model, opts, id)
{
   opts = opts || AM.Combine.defaults();
   var W = a.width, H = a.height, nch = a.numberOfChannels;
   var out = new ImageWindow(W, H, nch, 32, true, a.isColor, id);
   var kw = refWin.keywords;
   out.mainView.beginProcess(UndoFlag_NoSwapFile);
   out.keywords = kw;
   var oi = out.mainView.image;
   var ra = [], rb = [], ro = [], c, x, y;
   for (c = 0; c < nch; ++c) { ra.push(new Float32Array(W)); rb.push(new Float32Array(W)); ro.push(new Float32Array(W)); }
   var vert = ov.vertical, p0 = AM.Overlap.joinPosition(ov, opts.offset), rs = ov.refSign;
   // extent of the reference side of the overlap across the line, and the width of the join region
   var refExtent = rs < 0 ? (p0 - ov.pLo) : (ov.pHi - p0);
   var Rw = Math.max(1, refExtent * (opts.sizePct / 100));
   var mode = opts.mode, EPS = 1e-7;
   for (y = 0; y < H; ++y) {
      for (c = 0; c < nch; ++c) { a.getSamples(ra[c], new Rect(0, y, W, y + 1), c); b.getSamples(rb[c], new Rect(0, y, W, y + 1), c); }
      for (x = 0; x < W; ++x) {
         var va = true, vb = true;
         for (c = 0; c < nch; ++c) { if (!(ra[c][x] > 0)) va = false; if (!(rb[c][x] > 0)) vb = false; }
         if (!va && !vb) { for (c = 0; c < nch; ++c) ro[c][x] = 0; continue; }
         if (va && !vb) { for (c = 0; c < nch; ++c) ro[c][x] = ra[c][x]; continue; }
         var p = vert ? x : y, t = vert ? y : x;
         if (!va) {
            // target only: extend the correction along the join, tapering from the overlap model
            var pmin = ov.pMin[t], pmax = ov.pMax[t], low, q;
            if (p < pmin) { low = true; q = pmin - p; }
            else if (p > pmax) { low = false; q = p - pmax; }
            else { low = (p - pmin) < (pmax - p); q = 0; }
            for (c = 0; c < nch; ++c) {
               var v = scale[c] * rb[c][x] + AM.Gradient.outsideAt(model, c, t, q, low);
               ro[c][x] = v > EPS ? v : EPS;
            }
            continue;
         }
         // overlap
         var u = rs * (p - p0);                    // > 0 on the reference side of the line
         if (u > Rw || (u > 0 && mode === "overlay")) { for (c = 0; c < nch; ++c) ro[c][x] = ra[c][x]; continue; }
         var wT = 1;
         if (u > 0) {
            wT = 1 - u / Rw;                       // 1 at the line, 0 at the end of the join region
            if (mode === "blend") {
               var h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
               wT = ((h % 1000) / 1000) < wT ? 1 : 0;
            }
         }
         for (c = 0; c < nch; ++c) {
            var tc = scale[c] * rb[c][x] + AM.Gradient.overlapAt(model, c, x, y);
            if (tc < EPS) tc = EPS;
            ro[c][x] = wT >= 1 ? tc : (wT <= 0 ? ra[c][x] : ra[c][x] * (1 - wT) + tc * wT);
         }
      }
      for (c = 0; c < nch; ++c) oi.setSamples(ro[c], new Rect(0, y, W, y + 1), c);
   }
   out.mainView.endProcess();
   try { out.copyAstrometricSolution(refWin); } catch (e) {}
   return out;
};

// Residual of the corrected target against the reference over the overlap (diagnostics):
// returns { mean[c], rms[c], noise[c] } with noise = MAD-based sigma of the reference-minus-target differences.
AM.Combine.residual = function(a, b, ov, scale, model)
{
   var nch = a.numberOfChannels, bb = ov.bbox, W = bb.x1 - bb.x0 + 1, res = { mean: [], rms: [], noise: [] };
   var step = Math.max(1, Math.floor(Math.sqrt(W * (bb.y1 - bb.y0 + 1) / 60000)));
   for (var c = 0; c < nch; ++c) {
      var ra = new Float32Array(W), rb = new Float32Array(W), d = [], s = 0, s2 = 0, n = 0;
      for (var y = bb.y0; y <= bb.y1; y += step) {
         a.getSamples(ra, new Rect(bb.x0, y, bb.x1 + 1, y + 1), c);
         b.getSamples(rb, new Rect(bb.x0, y, bb.x1 + 1, y + 1), c);
         for (var x = 0; x < W; x += step) {
            if (!(ra[x] > 0) || !(rb[x] > 0)) continue;
            var e = ra[x] - (scale[c] * rb[x] + AM.Gradient.overlapAt(model, c, bb.x0 + x, y));
            d.push(e); s += e; s2 += e * e; ++n;
         }
      }
      d.sort(function(p, q) { return p - q; });
      var med = d.length ? d[d.length >> 1] : 0, dev = [];
      for (var i = 0; i < d.length; ++i) dev.push(Math.abs(d[i] - med));
      dev.sort(function(p, q) { return p - q; });
      res.mean[c] = n ? s / n : 0;
      res.rms[c] = n ? Math.sqrt(s2 / n) : 0;
      res.noise[c] = dev.length ? 1.4826 * dev[dev.length >> 1] : 0;
   }
   return res;
};
