// AM-Inputs.js - collecting panels from files, folders and open windows, and
// grouping them by filter.

AM.Inputs = {};

AM.Inputs.isImageFile = function(path)
{
   var ext = File.extractExtension(path).toLowerCase();
   return AM.IMAGE_EXTENSIONS.indexOf(ext) >= 0;
};

// Image files of a directory (optionally recursive), sorted by name.
AM.Inputs.listFolder = function(dir, recurse)
{
   dir = AM.normPath(dir);
   var all = searchDirectory(AM.joinPath(dir, "*"), !!recurse);
   var out = [];
   for (var i = 0; i < all.length; ++i) {
      var p = AM.normPath(all[i]);
      if (AM.Inputs.isImageFile(p) && File.exists(p)) out.push(p);
   }
   out.sort();
   return out;
};

// Header information without loading pixels: { keywords, width, height, channels }
AM.Inputs.readMeta = function(path)
{
   var r = { keywords: [], width: 0, height: 0, channels: 0 };
   var f = null;
   try {
      var fmt = new FileFormat(File.extractExtension(path), true, false);
      f = new FileFormatInstance(fmt);
      var d = f.open(path, "verbosity 0");
      if (d && d.length > 0) {
         r.width = d[0].width;
         r.height = d[0].height;
         r.channels = d[0].numberOfChannels;
         r.keywords = f.keywords;
      }
   } catch (e) {
   } finally {
      try { if (f) f.close(); } catch (e2) {}
   }
   return r;
};

// "'Ha 7nm'" -> "Ha"; returns "" when not recognized.
AM.Inputs.canonicalFilter = function(raw)
{
   if (!raw) return "";
   var v = ("" + raw).replace(/^\s*'|'\s*$/g, "").replace(/^\s+|\s+$/g, "");
   var c = v.toLowerCase().replace(/[^a-z0-9]/g, "");
   if (!c) return "";
   for (var i = 0; i < AM.FILTER_ALIASES.length; ++i)
      if (AM.FILTER_ALIASES[i][1].test(c)) return AM.FILTER_ALIASES[i][0];
   return "";
};

// Order: FITS keyword (FILTER, FILTER1, FILTNAME, INSFLNAM), then file name.
AM.Inputs.detectFilter = function(path, keywords)
{
   var names = ["FILTER", "FILTER1", "FILTNAME", "INSFLNAM"];
   for (var n = 0; n < names.length; ++n)
      for (var i = 0; i < keywords.length; ++i)
         if (keywords[i].name === names[n]) {
            var c = AM.Inputs.canonicalFilter(keywords[i].value);
            if (c) return c;
            // unrecognized name in the header: keep it verbatim as a new filter name
            var raw = ("" + keywords[i].value).replace(/^\s*'|'\s*$/g, "").replace(/^\s+|\s+$/g, "");
            if (raw) return AM.safeName(raw);
         }
   var base = File.extractName(path);
   for (var k = 0; k < AM.FILENAME_PATTERNS.length; ++k)
      if (AM.FILENAME_PATTERNS[k][1].test(base)) return AM.FILENAME_PATTERNS[k][0];
   return AM.UNKNOWN_FILTER;
};

// Creates a panel from a path, reading header information.
AM.Inputs.makePanel = function(path)
{
   var p = new AM.Panel(path);
   var meta = AM.Inputs.readMeta(path);
   p.width = meta.width; p.height = meta.height; p.channels = meta.channels;
   p.filter = AM.Inputs.detectFilter(path, meta.keywords);
   return p;
};

// Adds paths to a list of filter groups (creating groups as needed).
// Returns the number of panels actually added.
AM.Inputs.addPaths = function(groups, paths)
{
   var added = 0;
   for (var i = 0; i < paths.length; ++i) {
      var panel = AM.Inputs.makePanel(paths[i]);
      var g = AM.Inputs.findGroup(groups, panel.filter);
      if (!g) { g = new AM.FilterGroup(panel.filter); groups.push(g); }
      if (g.addPanel(panel)) ++added;
   }
   return added;
};

AM.Inputs.findGroup = function(groups, name)
{
   for (var i = 0; i < groups.length; ++i)
      if (groups[i].name === name) return groups[i];
   return null;
};

// Exports open windows to <dir>/<viewId>.xisf. The user's windows are never
// modified: a copy of each image is created and saved.
AM.Inputs.exportWindows = function(windows, dir)
{
   AM.ensureDir(dir);
   var paths = [];
   for (var i = 0; i < windows.length; ++i) {
      var src = windows[i];
      var id = src.mainView.id;
      var path = AM.joinPath(dir, AM.safeName(id) + ".xisf");
      var img = src.mainView.image;
      var copy = new ImageWindow(img.width, img.height, img.numberOfChannels,
                                 src.bitsPerSample, src.isFloatSample, img.isColor,
                                 "AM_export_" + AM.safeName(id));
      try {
         copy.mainView.beginProcess(UndoFlag_NoSwapFile);
         copy.mainView.image.assign(img);
         copy.mainView.endProcess();
         copy.keywords = src.keywords;
         try { copy.copyAstrometricSolution(src); } catch (e) {}
         copy.saveAs(path, false, false, true, false);
         paths.push(path);
      } finally {
         copy.forceClose();
      }
   }
   return paths;
};

// Validation. Returns an array of problem descriptions (empty = OK).
AM.Inputs.validate = function(groups)
{
   var problems = [];
   if (groups.length === 0) problems.push("No panels loaded.");
   for (var i = 0; i < groups.length; ++i) {
      var g = groups[i];
      if (g.panels.length < 2)
         problems.push("Filter " + g.name + ": at least 2 panels are required (found " + g.panels.length + ").");
      if (g.name === AM.UNKNOWN_FILTER && g.panels.length > 0)
         problems.push("Some panels have an unknown filter: rename the '" + AM.UNKNOWN_FILTER + "' group or move its panels.");
      for (var j = 1; j < g.panels.length; ++j)
         if (g.panels[j].channels !== g.panels[0].channels)
            problems.push("Filter " + g.name + ": panel " + g.panels[j].name + " has a different number of channels than " + g.panels[0].name + ".");
      for (var k = 0; k < g.panels.length; ++k)
         if (!File.exists(g.panels[k].path))
            problems.push("File not found: " + g.panels[k].path);
   }
   return problems;
};

// Default reference filter name for shared geometry.
AM.Inputs.chooseReference = function(groups, wanted)
{
   if (wanted && AM.Inputs.findGroup(groups, wanted)) return wanted;
   for (var i = 0; i < AM.REFERENCE_PREFERENCE.length; ++i)
      if (AM.Inputs.findGroup(groups, AM.REFERENCE_PREFERENCE[i])) return AM.REFERENCE_PREFERENCE[i];
   return groups.length > 0 ? groups[0].name : "";
};
