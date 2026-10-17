// AM-Model.js - data model shared by all modules.

// A panel is always a file on disk.
function AM_Panel(path)
{
   this.path = AM.normPath(path);
   this.name = File.extractName(path);
   this.filter = AM.UNKNOWN_FILTER;
   this.hasWcs = null;          // null = not checked yet
   this.sourceViewId = "";      // set when the panel was exported from an open window
   this.width = 0;
   this.height = 0;
   this.channels = 0;
}

function AM_FilterGroup(name)
{
   this.name = name;
   this.panels = [];            // order = merge order in PhotometricMosaic
   this.referencePanelIndex = 0;
}

AM_FilterGroup.prototype.addPanel = function(panel)
{
   for (var i = 0; i < this.panels.length; ++i)
      if (this.panels[i].path.toLowerCase() === panel.path.toLowerCase())
         return false;
   panel.filter = this.name;
   this.panels.push(panel);
   return true;
};

function AM_StepResult(ok, outputs, message, data)
{
   this.ok = ok;
   this.outputs = outputs || [];
   this.message = message || "";
   this.data = data || null;
}

// Result of a whole filter pipeline
function AM_FilterResult(filter)
{
   this.filter = filter;
   this.status = "PENDING";     // PENDING | OK | FAILED | ABORTED | SKIPPED
   this.output = "";
   this.message = "";
   this.seconds = 0;
   this.geometry = null;        // GeometrySpec produced by MBC for this filter
}

// Context passed to every adapter
//   outDir : output directory of the step
//   log    : AM.Log
//   abort  : function() -> true when the user asked to abort
function AM_Context(outDir, abortFn)
{
   this.outDir = outDir;
   this.log = AM.Log;
   this.abort = abortFn || function() { return false; };
   this.options = null;
}

AM.Panel = AM_Panel;
AM.FilterGroup = AM_FilterGroup;
AM.StepResult = AM_StepResult;
AM.FilterResult = AM_FilterResult;
AM.Context = AM_Context;
