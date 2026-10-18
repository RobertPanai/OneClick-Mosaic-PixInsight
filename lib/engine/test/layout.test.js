// Node tests for lib/engine/AM-Layout.js. Run: node lib/engine/test/layout.test.js
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var AM = {};
eval(fs.readFileSync(path.join(__dirname, "..", "AM-Layout.js"), "utf8"));

function box(x, y, w, h) { return { x0: x, y0: y, x1: x + w, y1: y + h }; }

// Row-major grid of square panels, size 100, neighbours 80 apart (20 px overlap).
function grid(cols, rows, step, size)
{
   var out = [];
   for (var r = 0; r < rows; ++r)
      for (var c = 0; c < cols; ++c)
         out.push(box(c * step, r * step, size || 100, size || 100));
   return out;
}

// Independent checks (do not reuse the module's own helpers).
function touching(a, b)
{
   var gx = Math.max(b.x0 - a.x1, a.x0 - b.x1, 0), gy = Math.max(b.y0 - a.y1, a.y0 - b.y1, 0);
   return gx <= 1 && gy <= 1;
}
function minDist2(list, ref, boxes)
{
   var best = Infinity;
   function c(b) { return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
   var rc = c(boxes[ref]);
   for (var i = 0; i < list.length; ++i)
   {
      var pc = c(boxes[list[i]]);
      var d = (pc[0] - rc[0]) * (pc[0] - rc[0]) + (pc[1] - rc[1]) * (pc[1] - rc[1]);
      if (d < best) best = d;
   }
   return best;
}

// Replays the plan: every step must join live, adjacent nodes; ref must hold the reference panel
// when one of the two does, else the panel closest to it; the last node must hold every panel.
function checkPlan(boxes, ref, plan)
{
   var N = boxes.length, alive = {}, members = {}, i, k;
   assert.strictEqual(plan.steps.length, N - 1, "number of steps");
   for (i = 0; i < N; ++i) { alive[i] = true; members[i] = [i]; }
   for (k = 0; k < plan.steps.length; ++k)
   {
      var s = plan.steps[k], id = N + k;
      assert.ok(alive[s.ref] && alive[s.tgt] && s.ref !== s.tgt, "step " + k + " uses a dead node");
      var A = members[s.ref], C = members[s.tgt], hit = false;
      for (var p = 0; p < A.length; ++p)
         for (var q = 0; q < C.length; ++q)
            if (touching(boxes[A[p]], boxes[C[q]])) hit = true;
      assert.ok(hit, "step " + k + " joins non-adjacent nodes");
      var refInA = A.indexOf(ref) >= 0, refInC = C.indexOf(ref) >= 0;
      if (refInA || refInC)
         assert.ok(refInA, "step " + k + ": ref must be the node holding the reference panel");
      else
         assert.ok(minDist2(A, ref, boxes) <= minDist2(C, ref, boxes),
            "step " + k + ": ref must be the node holding the panel closest to the reference");
      delete alive[s.ref];
      delete alive[s.tgt];
      alive[id] = true;
      members[id] = A.concat(C);
   }
   var last = N + plan.steps.length - 1;
   assert.deepStrictEqual(Object.keys(alive), [String(last)], "a single final node must remain");
   var all = [];
   for (i = 0; i < N; ++i) all.push(i);
   assert.deepStrictEqual(members[last].slice().sort(function (a, b) { return a - b; }), all, "final node holds all panels");
}

function steps(plan) { return plan.steps.map(function (s) { return { ref: s.ref, tgt: s.tgt }; }); }

// 1x2
var b12 = [box(0, 0, 100, 100), box(80, 0, 100, 100)];
var p12 = AM.Layout.plan(b12, 0);
checkPlan(b12, 0, p12);
assert.deepStrictEqual(steps(p12), [{ ref: 0, tgt: 1 }]);
assert.strictEqual(AM.Layout.describe(p12, b12), "join 1 <- 0");
var p12b = AM.Layout.plan(b12, 1);
checkPlan(b12, 1, p12b);
assert.deepStrictEqual(steps(p12b), [{ ref: 1, tgt: 0 }]);

// 1x3, reference in the middle: the strip grows left and right from it.
var b13 = grid(3, 1, 80);
var p13 = AM.Layout.plan(b13, 1);
checkPlan(b13, 1, p13);
assert.deepStrictEqual(steps(p13), [{ ref: 1, tgt: 0 }, { ref: 3, tgt: 2 }]);

// 3x1 (a column): strip along y, reference at the bottom.
var b31 = grid(1, 3, 80);
var p31 = AM.Layout.plan(b31, 2);
checkPlan(b31, 2, p31);
assert.deepStrictEqual(steps(p31), [{ ref: 2, tgt: 1 }, { ref: 3, tgt: 0 }]);

// 2x2, reference at the top-left corner.
var b22 = grid(2, 2, 80);
var p22 = AM.Layout.plan(b22, 0);
checkPlan(b22, 0, p22);
assert.deepStrictEqual(steps(p22), [{ ref: 0, tgt: 1 }, { ref: 2, tgt: 3 }, { ref: 4, tgt: 5 }]);

// 3 columns x 2 rows, reference in the middle of the bottom row.
var b32 = grid(3, 2, 80);
var p32 = AM.Layout.plan(b32, 4);
checkPlan(b32, 4, p32);
assert.deepStrictEqual(steps(p32), [
   { ref: 1, tgt: 0 }, { ref: 6, tgt: 2 }, { ref: 4, tgt: 3 }, { ref: 8, tgt: 5 }, { ref: 9, tgt: 7 }
]);
assert.strictEqual(AM.Layout.describe(p32, b32).split("\n").length, 5);

// Sparse 2x2 with the bottom-right panel missing (L shape).
var bL = [box(0, 0, 100, 100), box(80, 0, 100, 100), box(0, 80, 100, 100)];
var pL = AM.Layout.plan(bL, 1);
checkPlan(bL, 1, pL);
assert.deepStrictEqual(steps(pL), [{ ref: 1, tgt: 0 }, { ref: 3, tgt: 2 }]);

// Rotated-tile-like 2x2: bounding boxes of differing size and offset, overlapping irregularly.
var bR = [
   box(0, 0, 120, 120),
   box(100, 8, 120, 120),
   box(4, 104, 120, 120),
   box(108, 112, 120, 120)
];
var pR = AM.Layout.plan(bR, 3);
checkPlan(bR, 3, pR);
assert.deepStrictEqual(steps(pR), [{ ref: 1, tgt: 0 }, { ref: 3, tgt: 2 }, { ref: 5, tgt: 4 }]);

// Single panel: no joins.
var b1 = [box(0, 0, 100, 100)];
var p1 = AM.Layout.plan(b1, 0);
checkPlan(b1, 0, p1);
assert.strictEqual(p1.steps.length, 0);
assert.strictEqual(AM.Layout.describe(p1, b1), "no joins needed (single panel)");

// Error cases: thrown values are strings.
function throwsString(fn, pattern)
{
   var thrown = null;
   try { fn(); } catch (e) { thrown = e; }
   assert.strictEqual(typeof thrown, "string", "expected a thrown string");
   assert.ok(pattern.test(thrown), "unexpected message: " + thrown);
}
throwsString(function () { AM.Layout.plan([], 0); }, /no panels/);
throwsString(function () { AM.Layout.plan(b12, 2); }, /out of range/);
throwsString(function () { AM.Layout.plan(b12, -1); }, /out of range/);

// Disconnected: panel 2 sits 200 px away from the rest of the single row.
var bD = [box(0, 0, 100, 100), box(100, 0, 100, 100), box(400, 0, 100, 100)];
throwsString(function () { AM.Layout.plan(bD, 1); }, /panel 2 does not overlap the rest of the mosaic/);

// adjacent()
assert.strictEqual(AM.Layout.adjacent(box(0, 0, 100, 100), box(100, 0, 100, 100)), true, "touching");
assert.strictEqual(AM.Layout.adjacent(box(0, 0, 100, 100), box(101, 0, 100, 100)), true, "1 px gap");
assert.strictEqual(AM.Layout.adjacent(box(0, 0, 100, 100), box(102, 0, 100, 100)), false, "2 px gap");
assert.strictEqual(AM.Layout.adjacent(box(0, 0, 100, 100), box(50, 50, 100, 100)), true, "overlap");

console.log("layout tests passed");
