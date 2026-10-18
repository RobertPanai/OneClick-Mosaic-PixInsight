// AM-Gradient.js - integrated join engine, part 3: the relative gradient between the two panels.
//
// After the target is multiplied by its photometric scale, what is left of (reference - target) is
// an additive gradient. It is modelled from sample squares laid over the overlap (the median of the
// difference in each square; squares touching empty pixels or lying on bright stars are dropped) and
// a surface spline. Two models are built, as described in the PhotometricMosaic help page (J. Murphy):
//   - the OVERLAP model follows local detail (halos, scattered light): small rejection circles around
//     stars, light smoothing; it corrects the overlap;
//   - the TARGET model only follows the trend: large rejection circles, heavy smoothing; its value along
//     the edge of the overlap is extended, perpendicular to the join, across the rest of the target
//     (only the component parallel to the join is corrected), and the overlap model is tapered into it.
// The smoothing of the overlap model is chosen by cross-validation. The implementation is our own.
//
// AM.Gradient.build(a, b, ov, scale, stars, opts) -> model; AM.Gradient.field(model, c, x, y) etc.

AM.Gradient = {};

AM.Gradient.defaults = function()
{
   return {
      maxSamples: 1200,
      minSampleSize: 16,
      starFraction: 0.03,      // brightest fraction of the detected stars that reject samples
      maxRejectStars: 400,
      overlapGrowth: 1.5,      // rejection radius = growth * star radius (+ half a sample)
      targetGrowth: 6.0,
      targetSmoothFactor: 1000,// the target model is this many times smoother than the overlap one
      taper: 400,              // px over which the overlap model fades into the target model
      gridStep: 8
   };
};

// ---- samples ------------------------------------------------------------------------------------

AM.Gradient.samples = function(a, b, ov, scale, g)
{
   var W = ov.width, nch = a.numberOfChannels, bb = ov.bbox, out = [];
   var rowsA = [], rowsB = [], c, i, j, x, y;
   for (c = 0; c < nch; ++c) { rowsA.push([]); rowsB.push([]); for (j = 0; j < g; ++j) { rowsA[c].push(new Float32Array(W)); rowsB[c].push(new Float32Array(W)); } }
   for (var y0 = bb.y0; y0 + g <= bb.y1 + 1; y0 += g) {
      for (c = 0; c < nch; ++c)
         for (j = 0; j < g; ++j) {
            a.getSamples(rowsA[c][j], new Rect(0, y0 + j, W, y0 + j + 1), c);
            b.getSamples(rowsB[c][j], new Rect(0, y0 + j, W, y0 + j + 1), c);
         }
      for (var x0 = bb.x0; x0 + g <= bb.x1 + 1; x0 += g) {
         var ok = true, vals = [];
         for (c = 0; c < nch && ok; ++c) {
            var d = [];
            for (j = 0; j < g && ok; ++j) {
               var ra = rowsA[c][j], rb = rowsB[c][j];
               for (i = 0; i < g; ++i) {
                  var va = ra[x0 + i], vb = rb[x0 + i];
                  if (!(va > 0) || !(vb > 0)) { ok = false; break; }
                  d.push(va - scale[c] * vb);
               }
            }
            if (!ok) break;
            d.sort(function(p, q) { return p - q; });
            vals.push(d[d.length >> 1]);
         }
         if (ok) out.push({ x: x0 + g / 2, y: y0 + g / 2, z: vals });
      }
   }
   return out;
};

AM.Gradient._reject = function(samples, stars, growth, g)
{
   var keep = [];
   for (var i = 0; i < samples.length; ++i) {
      var s = samples[i], bad = false;
      for (var k = 0; k < stars.length; ++k) {
         var r = growth * stars[k].r + g / 2, dx = s.x - stars[k].x, dy = s.y - stars[k].y;
         if (dx * dx + dy * dy < r * r) { bad = true; break; }
      }
      if (!bad) keep.push(s);
   }
   return keep;
};

// ---- surface spline fit ---------------------------------------------------------------------------

AM.Gradient._spline = function(samples, c, lambda, scaleL, ox, oy)
{
   var n = samples.length, xs = new Array(n), ys = new Array(n), zs = new Array(n);
   for (var i = 0; i < n; ++i) { xs[i] = (samples[i].x - ox) / scaleL; ys[i] = (samples[i].y - oy) / scaleL; zs[i] = samples[i].z[c]; }
   var S = new SurfaceSpline();
   S.smoothing = lambda;
   S.initialize(new Vector(xs), new Vector(ys), new Vector(zs));
   if (!S.isValid) throw "surface spline fit failed";
   return S;
};

// Smoothing chosen by 5-fold cross-validation over a log grid; channel c.
AM.Gradient._chooseLambda = function(samples, c, scaleL, ox, oy)
{
   var n = samples.length;
   if (n < 30) return 1e-3;
   var cands = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1], best = 1e-3, bestErr = 1e99;
   for (var ci = 0; ci < cands.length; ++ci) {
      var err = 0, cnt = 0;
      for (var f = 0; f < 5; ++f) {
         var train = [], test = [];
         for (var i = 0; i < n; ++i) (i % 5 === f ? test : train).push(samples[i]);
         try {
            var S = AM.Gradient._spline(train, c, cands[ci], scaleL, ox, oy);
            for (var k = 0; k < test.length; ++k) {
               var e = S.evaluate(new Point((test[k].x - ox) / scaleL, (test[k].y - oy) / scaleL)) - test[k].z[c];
               err += Math.abs(e); ++cnt;
            }
         } catch (ex) { err = 1e99; break; }
      }
      if (cnt && err / cnt < bestErr) { bestErr = err / cnt; best = cands[ci]; }
   }
   return best;
};

// ---- the model ---------------------------------------------------------------------------------------

AM.Gradient.build = function(a, b, ov, scale, stars, opts)
{
   opts = opts || AM.Gradient.defaults();
   var nch = a.numberOfChannels, bb = ov.bbox, c, t, i;
   var area = (bb.x1 - bb.x0 + 1) * (bb.y1 - bb.y0 + 1);
   var g = Math.max(opts.minSampleSize, Math.ceil(Math.sqrt(area / opts.maxSamples)));
   var all = AM.Gradient.samples(a, b, ov, scale, g);
   if (all.length < 20) throw "too few clean samples (" + all.length + ") in the overlap to model the gradient";
   // bright stars that reject samples
   var nbright = Math.min(opts.maxRejectStars, Math.max(5, Math.floor(stars.length * opts.starFraction)));
   var bright = [];
   for (i = 0; i < Math.min(nbright, stars.length); ++i)
      bright.push({ x: stars[i].x, y: stars[i].y, r: Math.sqrt(stars[i].size) / 2 + 1 });
   var so = AM.Gradient._reject(all, bright, opts.overlapGrowth, g);
   var st = AM.Gradient._reject(all, bright, opts.targetGrowth, g);
   if (so.length < 20) so = all;
   if (st.length < 20) st = so;
   var L = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0, 1), ox = bb.x0, oy = bb.y0;
   var model = { nch: nch, g: g, nAll: all.length, nOverlapModel: so.length, nTargetModel: st.length, lambda: [], opts: opts, bbox: bb, ov: ov, L: L, ox: ox, oy: oy };
   var SO = [], ST = [];
   for (c = 0; c < nch; ++c) {
      var lam = AM.Gradient._chooseLambda(so, c, L, ox, oy);
      model.lambda.push(lam);
      SO.push(AM.Gradient._spline(so, c, lam, L, ox, oy));
      ST.push(AM.Gradient._spline(st, c, Math.min(1, lam * opts.targetSmoothFactor), L, ox, oy));
   }
   var ev = function(S, x, y) { return S.evaluate(new Point((x - ox) / L, (y - oy) / L)); };
   // value range, for clamping the extrapolation of the splines
   model.zlo = []; model.zhi = [];
   for (c = 0; c < nch; ++c) {
      var lo = 1e99, hi = -1e99;
      for (i = 0; i < all.length; ++i) { var z = all[i].z[c]; if (z < lo) lo = z; if (z > hi) hi = z; }
      var span = (hi - lo) * 0.25 + 1e-6;
      model.zlo.push(lo - span); model.zhi.push(hi + span);
   }
   var clamp = function(c2, v) { return v < model.zlo[c2] ? model.zlo[c2] : (v > model.zhi[c2] ? model.zhi[c2] : v); };
   // overlap model on a coarse grid over the bounding box
   var G = opts.gridStep, nx = Math.ceil((bb.x1 - bb.x0) / G) + 2, ny = Math.ceil((bb.y1 - bb.y0) / G) + 2;
   model.G = G; model.nx = nx; model.ny = ny;
   model.grid = [];
   for (c = 0; c < nch; ++c) {
      var tab = new Float32Array(nx * ny);
      for (var j = 0; j < ny; ++j) for (i = 0; i < nx; ++i) tab[j * nx + i] = clamp(c, ev(SO[c], bb.x0 + i * G, bb.y0 + j * G));
      model.grid.push(tab);
   }
   // values on the overlap edges (per line t along the join), for both models
   var n0 = ov.tLo, n1 = ov.tHi, len = n1 - n0 + 1;
   model.t0 = n0; model.len = len;
   model.oMin = []; model.oMax = []; model.tMin = []; model.tMax = [];
   for (c = 0; c < nch; ++c) {
      var a1 = new Float32Array(len), a2 = new Float32Array(len), a3 = new Float32Array(len), a4 = new Float32Array(len);
      for (t = n0; t <= n1; ++t) {
         var pmin = ov.pMin[t], pmax = ov.pMax[t];
         var x1 = ov.vertical ? pmin : t, y1 = ov.vertical ? t : pmin, x2 = ov.vertical ? pmax : t, y2 = ov.vertical ? t : pmax;
         a1[t - n0] = clamp(c, ev(SO[c], x1, y1)); a2[t - n0] = clamp(c, ev(SO[c], x2, y2));
         a3[t - n0] = clamp(c, ev(ST[c], x1, y1)); a4[t - n0] = clamp(c, ev(ST[c], x2, y2));
      }
      model.oMin.push(a1); model.oMax.push(a2); model.tMin.push(a3); model.tMax.push(a4);
   }
   return model;
};

// Correction (to be added to scale*target) inside the overlap: bilinear lookup of the coarse grid.
AM.Gradient.overlapAt = function(model, c, x, y)
{
   var fx = (x - model.bbox.x0) / model.G, fy = (y - model.bbox.y0) / model.G;
   var ix = Math.floor(fx), iy = Math.floor(fy);
   if (ix < 0) ix = 0; if (iy < 0) iy = 0;
   if (ix > model.nx - 2) ix = model.nx - 2; if (iy > model.ny - 2) iy = model.ny - 2;
   var tx = fx - ix, ty = fy - iy, tab = model.grid[c], nx = model.nx;
   var v00 = tab[iy * nx + ix], v10 = tab[iy * nx + ix + 1], v01 = tab[(iy + 1) * nx + ix], v11 = tab[(iy + 1) * nx + ix + 1];
   return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
};

// Correction for a pixel that lies in the target only: along line t, at distance q beyond the overlap
// edge ('low' = the edge with the smaller coordinate across the join).
AM.Gradient.outsideAt = function(model, c, t, q, low)
{
   var k = t - model.t0;
   if (k < 0) k = 0; else if (k >= model.len) k = model.len - 1;
   var o = low ? model.oMin[c][k] : model.oMax[c][k], tg = low ? model.tMin[c][k] : model.tMax[c][k];
   var w = 1 - q / model.opts.taper;
   if (w <= 0) return tg;
   return tg + (o - tg) * w;
};
