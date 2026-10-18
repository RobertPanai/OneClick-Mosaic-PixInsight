// AM-Runner.js - runs all filters (serial), shared geometry, summary.

AM.Runner = {};

// Order of processing: the reference filter first (its geometry is needed by the others).
AM.Runner.order = function(groups, opts)
{
   var ref = opts.sharedGeometry ? AM.Inputs.chooseReference(groups, opts.referenceFilter) : "";
   var ordered = [];
   var refGroup = ref ? AM.Inputs.findGroup(groups, ref) : null;
   if (refGroup) ordered.push(refGroup);
   for (var i = 0; i < groups.length; ++i) if (groups[i] !== refGroup) ordered.push(groups[i]);
   return { ref: ref, groups: ordered };
};

AM.Runner.summary = function(results, total)
{
   var lines = [];
   lines.push("AutoMosaic " + AM.VERSION + " summary (total " + AM.formatDuration(total) + ")");
   var allOk = true;
   for (var i = 0; i < results.length; ++i) {
      var r = results[i];
      if (r.status !== "OK") allOk = false;
      lines.push("  " + r.filter + ": " + r.status + "  " + AM.formatDuration(r.seconds * 1000) +
                 (r.status === "OK" ? "  " + r.output : "  " + r.message));
      if (r.cropOutput) lines.push("     crop: " + r.cropOutput);
      else if (r.cropMessage) lines.push("     crop: " + r.cropMessage);
   }
   return { text: lines.join("\n"), allOk: allOk };
};

// Common autocrop of the finished mosaics (see AM-Crop.js). Never throws.
AM.Runner._autocrop = function(results, opts, abortFn)
{
   if (!AM.needCrop(opts)) return;
   try { AM.Crop.run(results, opts, abortFn); }
   catch (e) { AM.Log.error("Autocrop failed: " + e); }
};

// Common checks. Returns null when everything is fine, otherwise the array of
// results to report.
AM.Runner._preflight = function(groups, opts)
{
   AM.Log.init("", "");      // the log stays in memory (saved only if the user saves the mosaics)
   AM.Log.note("AutoMosaic " + AM.VERSION + " - work folder: " + opts.workDir);
   if (opts.saveFiles && !opts.overwrite) {
      var clash = AM.Runner.existingOutputs(groups, opts);
      if (clash.length > 0) {
         var cr = new AM.FilterResult("(output)");
         cr.status = "FAILED";
         cr.message = "These files already exist in the output folder: " + clash.join(", ") +
                      ". Choose another folder or enable 'Overwrite existing files'.";
         AM.Log.error(cr.message);
         return [cr];
      }
   }
   var problems = AM.Inputs.validate(groups);
   if (problems.length > 0) {
      for (var p = 0; p < problems.length; ++p) AM.Log.error(problems[p]);
      var vr = new AM.FilterResult("(input)");
      vr.status = "FAILED"; vr.message = problems.join(" ");
      return [vr];
   }
   return null;
};

// Names of the files that would be written to the output folder and already exist there.
AM.Runner.existingOutputs = function(groups, opts)
{
   var out = [];
   for (var i = 0; i < groups.length; ++i) {
      var n = "Mosaic_" + AM.safeName(groups[i].name);
      var names = [];
      if (opts.saveUncropped) names.push(n + ".xisf");
      if (opts.saveCropped) names.push(n + AM.CROP_SUFFIX + ".xisf");
      for (var k = 0; k < names.length; ++k)
         if (File.exists(AM.joinPath(opts.outputDir, names[k]))) out.push(names[k]);
   }
   return out;
};

AM.Runner._skipped = function(name, plan)
{
   var sk = new AM.FilterResult(name);
   sk.status = "SKIPPED";
   sk.message = "the reference filter (" + plan.ref + ") did not complete, so the shared geometry is not available";
   AM.Log.warn("[" + name + "] " + sk.message);
   return sk;
};

AM.Runner._aborted = function(name)
{
   var ab = new AM.FilterResult(name);
   ab.status = "ABORTED"; ab.message = "aborted by the user";
   return ab;
};

// Serial run. Returns an array of AM.FilterResult.
AM.Runner.run = function(groups, opts, abortFn)
{
   var t0 = new Date().getTime();
   var results = [];
   var bad = AM.Runner._preflight(groups, opts);
   if (bad) return bad;

   var plan = AM.Runner.order(groups, opts);
   var geometry = null;
   console.abortEnabled = true;
   for (var i = 0; i < plan.groups.length; ++i) {
      var grp = plan.groups[i];
      if (abortFn && abortFn()) { results.push(AM.Runner._aborted(grp.name)); continue; }
      var useGeometry = null;
      if (opts.sharedGeometry && grp.name !== plan.ref) {
         if (!geometry) { results.push(AM.Runner._skipped(grp.name, plan)); continue; }
         useGeometry = geometry;
      }
      var r = AM.Pipeline.runFilter(grp, opts, useGeometry, abortFn);
      if (opts.sharedGeometry && grp.name === plan.ref && r.geometry && r.status === "OK") {
         geometry = r.geometry;
         AM.Log.info("Shared geometry taken from " + plan.ref + ": " + AM.Wcs.geometryToString(geometry));
      }
      results.push(r);
   }
   AM.Runner._autocrop(results, opts, abortFn);
   var s = AM.Runner.summary(results, new Date().getTime() - t0);
   AM.Log.note(s.text);
   return results;
};

// Parallel run: the reference filter (if the geometry is shared) is processed here,
// then every other filter in its own PixInsight instance, up to opts.maxInstances at
// a time. Returns an array of AM.FilterResult.
AM.Runner.runParallel = function(groups, opts, abortFn, scriptPath)
{
   var t0 = new Date().getTime();
   var results = [];
   var bad = AM.Runner._preflight(groups, opts);
   if (bad) return bad;
   var plan = AM.Runner.order(groups, opts);
   var geometry = null;
   console.abortEnabled = true;

   var queue = plan.groups.slice();
   if (opts.sharedGeometry && plan.ref) {
      var refGroup = queue.shift();
      AM.Log.info("Parallel mode: reference filter " + refGroup.name + " is processed first, in this instance.");
      var rr = AM.Pipeline.runFilter(refGroup, opts, null, abortFn);
      results.push(rr);
      if (rr.status === "OK" && rr.geometry) {
         geometry = rr.geometry;
         AM.Log.info("Shared geometry taken from " + plan.ref + ": " + AM.Wcs.geometryToString(geometry));
      } else {
         for (var q = 0; q < queue.length; ++q) results.push(AM.Runner._skipped(queue[q].name, plan));
         queue = [];
      }
   }

   var exe = CoreApplication.filePath;
   var jobsDir = AM.Job.jobsDir(opts.workDir);
   AM.ensureDir(jobsDir);
   var maxWorkers = Math.max(1, opts.maxInstances | 0);
   var timeoutMs = 6 * 3600 * 1000;
   var running = [];
   var lastBeat = new Date().getTime();

   var finish = function(job, result)
   {
      var fr = new AM.FilterResult(job.group.name);
      fr.status = result.status; fr.output = result.output; fr.message = result.message;
      fr.seconds = result.seconds; fr.geometry = result.geometry;
      results.push(fr);
      if (fr.status === "OK") AM.Log.note("[" + fr.filter + "] finished: " + fr.output);
      else AM.Log.error("[" + fr.filter + "] " + fr.status + ": " + fr.message);
   };

   while (queue.length > 0 || running.length > 0) {
      // start new workers
      while (queue.length > 0 && running.length < maxWorkers && !(abortFn && abortFn())) {
         var g = queue.shift();
         var base = AM.joinPath(jobsDir, AM.safeName(g.name));
         var resultFile = base + ".result.json";
         if (File.exists(resultFile)) File.remove(resultFile);
         AM.Job.write(base + ".job.json", AM.Job.make(g, opts, geometry, resultFile));
         var proc = new ExternalProcess;
         proc.start(exe, ["-n", "--automation-mode", "--no-startup-scripts",
                          "-r=" + scriptPath + ",--job=" + base + ".job.json", "--force-exit"]);
         if (!proc.waitForStarted(15000)) {
            var fr0 = new AM.FilterResult(g.name);
            fr0.status = "FAILED"; fr0.message = "could not start a PixInsight instance";
            results.push(fr0);
            AM.Log.error("[" + g.name + "] " + fr0.message);
            continue;
         }
         AM.Log.note("[" + g.name + "] worker started (" + g.panels.length + " panels), log: " + base + ".log");
         running.push({ group: g, proc: proc, resultFile: resultFile, start: new Date().getTime(), resultSeenAt: 0 });
      }

      processEvents();
      msleep(500);

      if (abortFn && abortFn()) {
         for (var a = 0; a < running.length; ++a) {
            try { running[a].proc.kill(); } catch (e) {}
            results.push(AM.Runner._aborted(running[a].group.name));
         }
         running = [];
         for (var b = 0; b < queue.length; ++b) results.push(AM.Runner._aborted(queue[b].name));
         queue = [];
         break;
      }

      // collect finished workers
      for (var i = running.length - 1; i >= 0; --i) {
         var w = running[i];
         var result = null;
         if (File.exists(w.resultFile)) {
            try { result = AM.Job.read(w.resultFile); } catch (e) { result = null; }   // maybe still being written
         }
         if (result) {
            // give the instance a moment to exit by itself
            var t1 = new Date().getTime();
            while (w.proc.isRunning && new Date().getTime() - t1 < 15000) { processEvents(); msleep(200); }
            if (w.proc.isRunning) w.proc.kill();
            finish({ group: w.group }, result);
            running.splice(i, 1);
         } else if (!w.proc.isRunning) {
            finish({ group: w.group }, { status: "FAILED", output: "", seconds: (new Date().getTime() - w.start) / 1000,
                   message: "the worker instance ended without a result (exit code " + w.proc.exitCode + "); see " +
                            AM.joinPath(jobsDir, AM.safeName(w.group.name)) + ".log", geometry: null });
            running.splice(i, 1);
         } else if (new Date().getTime() - w.start > timeoutMs) {
            w.proc.kill();
            finish({ group: w.group }, { status: "FAILED", output: "", seconds: timeoutMs / 1000,
                   message: "timeout: the worker did not finish in 6 hours", geometry: null });
            running.splice(i, 1);
         }
      }

      if (new Date().getTime() - lastBeat > 30000) {
         lastBeat = new Date().getTime();
         var names = [];
         for (var n = 0; n < running.length; ++n) names.push(running[n].group.name);
         AM.Log.info("Running: " + names.join(", ") + (queue.length ? " (waiting: " + queue.length + ")" : "") +
                     " - " + AM.formatDuration(lastBeat - t0) + " elapsed");
      }
   }

   AM.Runner._autocrop(results, opts, abortFn);
   var s = AM.Runner.summary(results, new Date().getTime() - t0);
   AM.Log.note(s.text);
   return results;
};
