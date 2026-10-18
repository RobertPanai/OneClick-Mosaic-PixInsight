// AM-Photometry.js - integrated join engine, part 2: the brightness scale between two panels.
//
// Stellar photometry is used so that the scale is not distorted by gradients or by differences in the
// star profiles. The method
// implemented here is our own: stars are detected in the overlap of both panels with PixInsight's
// StarDetector, matched by position, measured with square-aperture photometry (local background from
// a surrounding ring), and the scale is a robust least-squares slope through the origin.
//
// AM.Photometry.analyse(a, b, ov, opts) -> {
//    scale[c]        factor to multiply the target channel c by to match the reference,
//    nStars[c], method[c] ("photometry" | "median"),
//    stars           bright detected stars in the overlap (frame coordinates): {x, y, flux, r}
// }

AM.Photometry = {};

AM.Photometry.defaults = function()
{
   return {
      maxStars: 2000,        // brightest matched stars used
      searchRadius: 3.0,     // px, star match radius
      fluxTolerance: 1.5,    // matches whose flux ratio differs from the typical one by more than this are dropped
      outlierPercent: 2,     // percent of the stars with the largest residuals removed
      linearFraction: 0.7,   // stars with a peak above this fraction of the image maximum are not used
      minStars: 12
   };
};

// Crop of the overlap bounding box as a new Image; returns { img, x0, y0 }.
AM.Photometry._crop = function(img, bbox)
{
   var c = new Image();
   c.assign(img);
   c.cropTo(bbox.x0, bbox.y0, bbox.x1 + 1, bbox.y1 + 1);
   return { img: c, x0: bbox.x0, y0: bbox.y0 };
};

AM.Photometry._detect = function(crop)
{
   var sd = new StarDetector();
   var stars = sd.stars(crop.img);
   var out = [];
   for (var i = 0; i < stars.length; ++i) {
      var s = stars[i];
      out.push({ x: s.pos.x + crop.x0, y: s.pos.y + crop.y0, flux: s.flux, size: s.size });
   }
   out.sort(function(p, q) { return q.flux - p.flux; });
   return out;
};

// Aperture flux of a star at (x, y) in channel c of 'img': returns null when the aperture or the
// background ring touch empty pixels or leave the image.
AM.Photometry._flux = function(img, x, y, half, c)
{
   var ring = 4, gap = 2;
   var R = half + gap + ring;
   var cx = Math.round(x), cy = Math.round(y);
   if (cx - R < 0 || cy - R < 0 || cx + R >= img.width || cy + R >= img.height) return null;
   var n = 2 * R + 1;
   var buf = new Float32Array(n * n);
   img.getSamples(buf, new Rect(cx - R, cy - R, cx + R + 1, cy + R + 1), c);
   var bg = [], sum = 0, cnt = 0, peak = 0, i, j;
   var inner = half + gap;
   for (j = 0; j < n; ++j) {
      var dy = Math.abs(j - R);
      for (i = 0; i < n; ++i) {
         var dx = Math.abs(i - R), v = buf[j * n + i];
         var m = dx > dy ? dx : dy;
         if (m <= half) {
            if (!(v > 0)) return null;
            if (v > peak) peak = v;
            ++cnt; sum += v;
         } else if (m > inner) {
            if (!(v > 0)) return null;
            bg.push(v);
         } else if (!(v > 0)) return null;
      }
   }
   bg.sort(function(p, q) { return p - q; });
   var bkg = bg[bg.length >> 1];
   return { flux: sum - bkg * cnt, peak: peak };
};

AM.Photometry.analyse = function(a, b, ov, opts)
{
   opts = opts || AM.Photometry.defaults();
   var nch = a.numberOfChannels, res = { scale: [], nStars: [], method: [], stars: [] };
   var ca = AM.Photometry._crop(a, ov.bbox), cb = AM.Photometry._crop(b, ov.bbox);
   var sa = AM.Photometry._detect(ca), sb = AM.Photometry._detect(cb);
   var maxA = a.maximum(), maxB = b.maximum();
   res.stars = sa.slice(0, 400);
   // match: grid hash of the target stars
   var cell = Math.max(1, opts.searchRadius), grid = {}, i, k;
   var nB = Math.min(sb.length, opts.maxStars * 3);
   for (i = 0; i < nB; ++i) {
      var key = Math.floor(sb[i].x / cell) + "," + Math.floor(sb[i].y / cell);
      (grid[key] || (grid[key] = [])).push(i);
   }
   var pairs = [], nA = Math.min(sa.length, opts.maxStars * 3);
   for (i = 0; i < nA; ++i) {
      var gx = Math.floor(sa[i].x / cell), gy = Math.floor(sa[i].y / cell), best = -1, bd = opts.searchRadius * opts.searchRadius;
      for (var dy = -1; dy <= 1; ++dy)
         for (var dx = -1; dx <= 1; ++dx) {
            var lst = grid[(gx + dx) + "," + (gy + dy)];
            if (!lst) continue;
            for (k = 0; k < lst.length; ++k) {
               var q = sb[lst[k]], d2 = (q.x - sa[i].x) * (q.x - sa[i].x) + (q.y - sa[i].y) * (q.y - sa[i].y);
               if (d2 <= bd) { bd = d2; best = lst[k]; }
            }
         }
      if (best >= 0) pairs.push({ a: sa[i], b: sb[best] });
   }
   for (var c = 0; c < nch; ++c) {
      var fa = [], fb = [];
      for (i = 0; i < pairs.length && fa.length < opts.maxStars; ++i) {
         var p = pairs[i];
         var half = Math.max(3, Math.min(20, Math.ceil(Math.sqrt(Math.max(p.a.size, p.b.size)) / 2) + 2));
         var ma = AM.Photometry._flux(a, p.a.x, p.a.y, half, c), mb = AM.Photometry._flux(b, p.b.x, p.b.y, half, c);
         if (!ma || !mb || !(ma.flux > 0) || !(mb.flux > 0)) continue;
         if (ma.peak > opts.linearFraction * maxA || mb.peak > opts.linearFraction * maxB) continue;
         fa.push(ma.flux); fb.push(mb.flux);
      }
      var scale = 0, method = "median";
      if (fa.length >= opts.minStars) {
         // typical ratio, then drop pairs whose ratio is out of tolerance
         var ratios = [];
         for (i = 0; i < fa.length; ++i) ratios.push(fa[i] / fb[i]);
         var sorted = ratios.slice().sort(function(p2, q2) { return p2 - q2; });
         var med = sorted[sorted.length >> 1];
         var idx = [];
         for (i = 0; i < fa.length; ++i) if (ratios[i] <= med * opts.fluxTolerance && ratios[i] >= med / opts.fluxTolerance) idx.push(i);
         var s = med;
         for (var it = 0; it < 4 && idx.length >= opts.minStars; ++it) {
            var num = 0, den = 0, j;
            for (j = 0; j < idx.length; ++j) { num += fa[idx[j]] * fb[idx[j]]; den += fb[idx[j]] * fb[idx[j]]; }
            s = num / den;
            if (it < 3) {
               // remove the outliers by relative residual
               var res2 = [];
               for (j = 0; j < idx.length; ++j) res2.push({ i: idx[j], r: Math.abs(fa[idx[j]] - s * fb[idx[j]]) / fa[idx[j]] });
               res2.sort(function(p3, q3) { return p3.r - q3.r; });
               var keep = Math.max(opts.minStars, Math.floor(res2.length * (1 - opts.outlierPercent / 100)));
               idx = [];
               for (j = 0; j < keep && j < res2.length; ++j) idx.push(res2[j].i);
            }
         }
         if (idx.length >= opts.minStars) { scale = s; method = "photometry"; res.nStars[c] = idx.length; }
      }
      if (method === "median") {
         // no usable stars: ratio of the medians of the overlap
         var ma2 = AM.Photometry._overlapMedian(a, ov, c), mb2 = AM.Photometry._overlapMedian(b, ov, c);
         scale = ma2 / mb2;
         res.nStars[c] = fa.length;
      }
      if (!(scale > 0.2 && scale < 5)) throw "implausible brightness scale (" + scale + ") for channel " + c + ": check that the panels are linear and overlap";
      res.scale[c] = scale;
      res.method[c] = method;
   }
   try { ca.img.free(); cb.img.free(); } catch (eFree) {}
   return res;
};

// Median of channel c over a coarse grid of the overlap bounding box (pixels valid in the channel).
AM.Photometry._overlapMedian = function(img, ov, c)
{
   var vals = [], step = Math.max(1, Math.floor(Math.sqrt((ov.bbox.x1 - ov.bbox.x0) * (ov.bbox.y1 - ov.bbox.y0) / 20000)));
   var W = ov.bbox.x1 - ov.bbox.x0 + 1, row = new Float32Array(W);
   for (var y = ov.bbox.y0; y <= ov.bbox.y1; y += step) {
      img.getSamples(row, new Rect(ov.bbox.x0, y, ov.bbox.x1 + 1, y + 1), c);
      for (var x = 0; x < W; x += step) if (row[x] > 0) vals.push(row[x]);
   }
   vals.sort(function(p, q) { return p - q; });
   return vals.length ? vals[vals.length >> 1] : 1;
};
