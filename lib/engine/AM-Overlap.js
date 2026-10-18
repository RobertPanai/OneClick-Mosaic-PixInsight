// AM-Overlap.js - integrated join engine, part 1: where the two panels overlap and where to join them.
//
// A pixel is "valid" in a panel when it is non-zero in all channels. The overlap is the set of pixels
// valid in both panels. The join is a straight line, across the overlap, perpendicular to its shorter
// direction.
//
// AM.Overlap.analyse(imgRef, imgTgt) -> {
//    width, height, nRef, nTgt, nBoth,
//    bbox: {x0, y0, x1, y1}         inclusive bounds of the overlap
//    vertical: true when the join line is vertical (the panels sit side by side)
//    pMin[], pMax[]                 per line along the join (index t): first/last overlap pixel across the line, -1 if none
//    refCentroid, tgtCentroid       centroids (along the axis perpendicular to the join) of the ref-only / tgt-only pixels
//    refSign                        -1 when the reference lies at smaller coordinates than the join, +1 otherwise
// }

AM.Overlap = {};

// Returns a Uint8Array row mask: 1 where all channels of 'img' are > 0 in row y.
AM.Overlap.validRow = function(img, y, rows, out)
{
   var W = img.width, nch = img.numberOfChannels, x, c;
   for (c = 0; c < nch; ++c) img.getSamples(rows[c], new Rect(0, y, W, y + 1), c);
   var r0 = rows[0];
   for (x = 0; x < W; ++x) out[x] = r0[x] > 0 ? 1 : 0;
   for (c = 1; c < nch; ++c) {
      var rc = rows[c];
      for (x = 0; x < W; ++x) if (!(rc[x] > 0)) out[x] = 0;
   }
};

AM.Overlap.analyse = function(a, b)
{
   var W = a.width, H = a.height;
   if (b.width !== W || b.height !== H) throw "the two panels have different sizes (" + W + "x" + H + " and " + b.width + "x" + b.height + "): they are not registered to the same frame";
   var na = a.numberOfChannels, nb = b.numberOfChannels;
   if (na !== nb) throw "the two panels have a different number of channels";
   var ra = [], rb = [], c;
   for (c = 0; c < na; ++c) { ra.push(new Float32Array(W)); rb.push(new Float32Array(W)); }
   var va = new Uint8Array(W), vb = new Uint8Array(W);
   var o = { width: W, height: H, nRef: 0, nTgt: 0, nBoth: 0, bbox: { x0: W, y0: H, x1: -1, y1: -1 } };
   // first pass: bounding box, counts, centroids along x and along y of the single-owner areas
   var refX = 0, refY = 0, tgtX = 0, tgtY = 0, nR = 0, nT = 0;
   var rowFirst = new Int32Array(H), rowLast = new Int32Array(H), colFirst = new Int32Array(W), colLast = new Int32Array(W);
   var x, y;
   for (x = 0; x < W; ++x) { colFirst[x] = -1; colLast[x] = -1; }
   for (y = 0; y < H; ++y) {
      AM.Overlap.validRow(a, y, ra, va);
      AM.Overlap.validRow(b, y, rb, vb);
      var f = -1, l = -1;
      for (x = 0; x < W; ++x) {
         if (va[x] && vb[x]) {
            ++o.nBoth;
            if (f < 0) f = x;
            l = x;
            if (colFirst[x] < 0) colFirst[x] = y;
            colLast[x] = y;
         } else if (va[x]) { ++nR; refX += x; refY += y; }
         else if (vb[x]) { ++nT; tgtX += x; tgtY += y; }
      }
      rowFirst[y] = f; rowLast[y] = l;
      if (f >= 0) {
         if (f < o.bbox.x0) o.bbox.x0 = f;
         if (l > o.bbox.x1) o.bbox.x1 = l;
         if (y < o.bbox.y0) o.bbox.y0 = y;
         if (y > o.bbox.y1) o.bbox.y1 = y;
      }
   }
   o.nRef = nR; o.nTgt = nT;
   if (o.nBoth < 100) throw "the two panels do not overlap (or overlap by less than 100 pixels)";
   var bw = o.bbox.x1 - o.bbox.x0 + 1, bh = o.bbox.y1 - o.bbox.y0 + 1;
   // overlap taller than wide -> the panels are side by side -> vertical join line
   o.vertical = bh > bw;
   if (o.vertical) {
      // per row (t = y): extent across the line (x)
      o.pMin = rowFirst; o.pMax = rowLast;
      o.length = H;
      o.refCentroid = nR ? refX / nR : -1; o.tgtCentroid = nT ? tgtX / nT : -1;
      o.pLo = o.bbox.x0; o.pHi = o.bbox.x1;
      o.tLo = o.bbox.y0; o.tHi = o.bbox.y1;
   } else {
      o.pMin = colFirst; o.pMax = colLast;     // per column (t = x): extent across the line (y)
      o.length = W;
      o.refCentroid = nR ? refY / nR : -1; o.tgtCentroid = nT ? tgtY / nT : -1;
      o.pLo = o.bbox.y0; o.pHi = o.bbox.y1;
      o.tLo = o.bbox.x0; o.tHi = o.bbox.x1;
   }
   o.refSign = (o.refCentroid <= o.tgtCentroid) ? -1 : 1;
   // lines without overlap take the extent of the nearest line that has one
   var last = -1, t;
   for (t = 0; t < o.length; ++t) if (o.pMin[t] >= 0) { for (var k = 0; k < t; ++k) { o.pMin[k] = o.pMin[t]; o.pMax[k] = o.pMax[t]; } last = t; break; }
   for (t = last + 1; t < o.length; ++t) if (o.pMin[t] < 0) { o.pMin[t] = o.pMin[t - 1]; o.pMax[t] = o.pMax[t - 1]; }
   return o;
};

// Position of the join line (coordinate across the line) for a given offset in pixels.
AM.Overlap.joinPosition = function(ov, offset)
{
   return (ov.pLo + ov.pHi) / 2 + (offset || 0);
};
