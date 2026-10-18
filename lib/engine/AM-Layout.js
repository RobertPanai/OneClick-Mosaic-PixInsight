AM.Layout = {};

// AM-Layout.js - pure geometry, no PixInsight calls. Decides in which order, and in which pairs,
// registered mosaic panels are joined, so that a join that merges only two overlapping images
// (a reference and a target) can build the whole mosaic. As in common astro-mosaic practice, rows
// (or columns) are joined into strips first, then the strips are joined.
//
// Nodes 0..N-1 are the panels; the result of steps[k] is node N+k, so the last step is the final
// mosaic. A step is { ref: node, tgt: node }. ref is the node holding the reference panel when one
// of the two does, otherwise the node holding the panel closest to the reference panel.
//
// AM.Layout.plan(boxes, refIndex)   -> { steps: [{ref, tgt}, ...], strips: [{panels, node}, ...] }
//                                      strips: one entry per row of a grid (top to bottom), or the
//                                      single strip; panels are listed in join order
// AM.Layout.describe(plan, boxes)   -> one line per step, "join <tgt> <- <ref>"
// AM.Layout.adjacent(boxA, boxB)    -> true when the boxes overlap or lie within 1 pixel
//
// Throws a string on empty input, an out-of-range refIndex, or a join of non-adjacent nodes.

(function ()
{
   function median(values)
   {
      var s = values.slice().sort(function (a, b) { return a - b; });
      var n = s.length, m = n >> 1;
      return n % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
   }

   // Clusters panels along one axis. cs[i] is the centre of panel i on that axis. Consecutive centres
   // (in sorted order) further apart than half the median size start a new cluster.
   function clusterAxis(cs, medianSize)
   {
      var idx = [], i, k;
      for (i = 0; i < cs.length; ++i) idx.push(i);
      idx.sort(function (p, q) { return (cs[p] - cs[q]) || (p - q); });
      var groups = [], cur = [], threshold = 0.5 * medianSize;
      for (k = 0; k < idx.length; ++k)
      {
         var j = idx[k];
         if (cur.length > 0 && cs[j] - cs[cur[cur.length - 1]] > threshold)
         {
            groups.push(cur);
            cur = [];
         }
         cur.push(j);
      }
      if (cur.length > 0) groups.push(cur);
      return groups;
   }

   // The member of list whose coordinate is closest to target (ties: smaller coordinate, then smaller index).
   function closestTo(list, coords, target)
   {
      var best = list[0];
      for (var k = 1; k < list.length; ++k)
      {
         var p = list[k];
         var dp = Math.abs(coords[p] - target), db = Math.abs(coords[best] - target);
         if (dp < db || (dp === db && (coords[p] < coords[best] || (coords[p] === coords[best] && p < best))))
            best = p;
      }
      return best;
   }

   AM.Layout.adjacent = function (a, b)
   {
      var gx = Math.max(Math.min(b.x0, b.x1) - Math.max(a.x0, a.x1), Math.min(a.x0, a.x1) - Math.max(b.x0, b.x1), 0);
      var gy = Math.max(Math.min(b.y0, b.y1) - Math.max(a.y0, a.y1), Math.min(a.y0, a.y1) - Math.max(b.y0, b.y1), 0);
      return gx <= 1 && gy <= 1;
   };

   AM.Layout.plan = function (boxes, refIndex)
   {
      if (!boxes || boxes.length === undefined || boxes.length === 0)
         throw "AM.Layout.plan: no panels given";
      var N = boxes.length;
      if (typeof refIndex !== "number" || refIndex % 1 !== 0 || refIndex < 0 || refIndex >= N)
         throw "AM.Layout.plan: refIndex " + refIndex + " is out of range (0 to " + (N - 1) + ")";

      var B = [], cxs = [], cys = [], ws = [], hs = [], i, k, r;
      for (i = 0; i < N; ++i)
      {
         var b = boxes[i];
         if (!b || !isFinite(b.x0) || !isFinite(b.y0) || !isFinite(b.x1) || !isFinite(b.y1))
            throw "AM.Layout.plan: box " + i + " has no numeric x0, y0, x1, y1";
         var n = { x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1) };
         B.push(n);
         cxs.push((n.x0 + n.x1) / 2);
         cys.push((n.y0 + n.y1) / 2);
         ws.push(n.x1 - n.x0);
         hs.push(n.y1 - n.y0);
      }

      var allIdx = [];
      for (i = 0; i < N; ++i) allIdx.push(i);
      var rows = clusterAxis(cys, median(hs));
      var cols = clusterAxis(cxs, median(ws));

      var members = [], steps = [];
      for (i = 0; i < N; ++i) members.push([i]);

      function touches(a, c)
      {
         for (var p = 0; p < members[a].length; ++p)
            for (var q = 0; q < members[c].length; ++q)
               if (AM.Layout.adjacent(B[members[a][p]], B[members[c][q]])) return true;
         return false;
      }

      // Squared centre distance from the reference panel to the nearest panel of a node.
      function nodeDist2(node)
      {
         var best = Infinity;
         for (var p = 0; p < members[node].length; ++p)
         {
            var m = members[node][p];
            var dx = cxs[m] - cxs[refIndex], dy = cys[m] - cys[refIndex];
            if (dx * dx + dy * dy < best) best = dx * dx + dy * dy;
         }
         return best;
      }

      // Joins two nodes; returns the id of the new node.
      function join(a, c)
      {
         if (!touches(a, c))
            throw "AM.Layout.plan: panel " + members[c][0] + " does not overlap the rest of the mosaic";
         var ref = a, tgt = c;
         if (members[c].indexOf(refIndex) >= 0) { ref = c; tgt = a; }
         else if (members[a].indexOf(refIndex) < 0 && nodeDist2(c) < nodeDist2(a)) { ref = c; tgt = a; }
         steps.push({ ref: ref, tgt: tgt });
         var id = N + steps.length - 1;
         members[id] = members[a].concat(members[c]);
         return id;
      }

      // Joins a list of panels into one strip, starting from start and taking the others nearest first
      // along the strip's axis (coords).
      function buildStrip(list, start, coords)
      {
         var others = [];
         for (var q = 0; q < list.length; ++q)
            if (list[q] !== start) others.push(list[q]);
         others.sort(function (p, s)
         {
            var dp = Math.abs(coords[p] - coords[start]), ds = Math.abs(coords[s] - coords[start]);
            return (dp - ds) || (coords[p] - coords[s]) || (p - s);
         });
         var node = start, order = [start];
         for (var j = 0; j < others.length; ++j)
         {
            node = join(node, others[j]);
            order.push(others[j]);
         }
         return { panels: order, node: node };
      }

      var strips = [];
      if (N === 1)
      {
         strips.push({ panels: [0], node: 0 });
      }
      else if (rows.length === 1 || cols.length === 1)
      {
         strips.push(buildStrip(allIdx, refIndex, rows.length === 1 ? cxs : cys));
      }
      else
      {
         var refRow = 0;
         for (r = 0; r < rows.length; ++r)
            if (rows[r].indexOf(refIndex) >= 0) refRow = r;

         for (r = 0; r < rows.length; ++r)
         {
            var start = refIndex;
            if (r !== refRow) start = closestTo(rows[r], cxs, cxs[refIndex]);
            strips.push(buildStrip(rows[r], start, cxs));
         }

         var rowOrder = [];
         for (r = 0; r < rows.length; ++r)
            if (r !== refRow) rowOrder.push(r);
         rowOrder.sort(function (p, s)
         {
            return (Math.abs(p - refRow) - Math.abs(s - refRow)) || (p - s);
         });

         var grown = strips[refRow].node;
         for (k = 0; k < rowOrder.length; ++k)
            grown = join(grown, strips[rowOrder[k]].node);
      }

      return { steps: steps, strips: strips };
   };

   AM.Layout.describe = function (plan, boxes)
   {
      if (!plan || !plan.steps) throw "AM.Layout.describe: no plan given";
      if (plan.steps.length === 0) return "no joins needed (single panel)";
      var lines = [];
      for (var k = 0; k < plan.steps.length; ++k)
         lines.push("join " + plan.steps[k].tgt + " <- " + plan.steps[k].ref);
      return lines.join("\n");
   };
})();
