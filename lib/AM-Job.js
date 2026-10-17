// AM-Job.js - job files and worker mode (used by the parallel execution).
//
// In parallel mode the main PixInsight instance writes one JSON job per filter and
// starts additional PixInsight instances running AutoMosaic.js in "job mode":
//
//   PixInsight -n --automation-mode --no-startup-scripts -r=<AutoMosaic.js>,--job=<job.json> --force-exit
//
// (command line verified on PixInsight 1.9.3.8 for Windows, see docs/RECON.md).
// The worker runs the pipeline of ONE filter with no user interface and writes
// <filter>.result.json next to the job file.

AM.Job = {};

AM.Job.jobsDir = function(outputDir) { return AM.joinPath(outputDir, "_jobs"); };

AM.Job.write = function(path, obj) { File.writeTextFile(path, JSON.stringify(obj, null, 1)); };

AM.Job.read = function(path) { return JSON.parse(File.readTextFile(path)); };

// Returns the value of --job=<file> in the script arguments, or "".
AM.Job.argument = function()
{
   try {
      if (typeof jsArguments === "undefined" || !jsArguments) return "";
      for (var i = 0; i < jsArguments.length; ++i) {
         var a = "" + jsArguments[i];
         if (a.indexOf("--job=") === 0) return a.substring(6);
      }
   } catch (e) {}
   return "";
};

// Builds the job description of one filter.
AM.Job.make = function(group, opts, geometry, resultFile)
{
   var panels = [];
   for (var i = 0; i < group.panels.length; ++i)
      panels.push({ path: group.panels[i].path, name: group.panels[i].name });
   return {
      format: 1,
      version: AM.VERSION,
      group: { name: group.name, referencePanelIndex: group.referencePanelIndex || 0, panels: panels },
      opts: opts,
      geometry: geometry || null,
      resultFile: resultFile
   };
};

// Worker entry point: runs one job and writes its result file. Never opens a dialog.
AM.Job.runWorker = function(jobPath)
{
   var result = { filter: "?", status: "FAILED", output: "", message: "", seconds: 0, geometry: null };
   var job = null;
   try {
      job = AM.Job.read(jobPath);
      var group = new AM.FilterGroup(job.group.name);
      group.referencePanelIndex = job.group.referencePanelIndex || 0;
      for (var i = 0; i < job.group.panels.length; ++i) {
         var p = new AM.Panel(job.group.panels[i].path);
         group.addPanel(p);
      }
      result.filter = group.name;
      AM.Log.init(AM.Job.jobsDir(job.opts.outputDir), AM.safeName(group.name) + ".log");
      AM.Log.note("AutoMosaic " + AM.VERSION + " worker for filter " + group.name + " (instance " + CoreApplication.instance + ")");
      var tools = AM.checkAllTools(job.opts.solveMode !== "never");
      if (!tools.ok) throw tools.messages.join(" | ");
      var r = AM.Pipeline.runFilter(group, job.opts, job.geometry, function() { return false; });
      result.status = r.status;
      result.output = r.output;
      result.message = r.message;
      result.seconds = r.seconds;
      result.geometry = r.geometry;
   } catch (e) {
      result.message = "worker error: " + e;
      try { AM.Log.error(result.message); } catch (e2) {}
   }
   try {
      var resultFile = job ? job.resultFile : (jobPath + ".result.json");
      AM.Job.write(resultFile, result);
   } catch (e3) {}
   return result;
};
