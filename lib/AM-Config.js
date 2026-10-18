// AM-Config.js - AutoMosaic constants, defaults and tool registry.
//
// AutoMosaic (c) 2026 Robert Panai. Self-contained: registration, trim and photometric join are implemented
// in lib/engine. The only external piece is PixInsight's own ImageSolver script, used to plate-solve panels
// that carry no astrometric data.

var AM = {};

AM.VERSION = "0.3.1";
AM.TITLE = "AutoMosaic";
AM.SETTINGS_KEY = "AutoMosaic";
AM.UNKNOWN_FILTER = "Unknown";
AM.IMAGE_EXTENSIONS = [".xisf", ".fits", ".fit", ".fts"];

// Parallel execution (several PixInsight instances). Set by the job-mode check.
AM.PARALLEL_AVAILABLE = false;
AM.PARALLEL_REASON = "not verified on this PixInsight version (see docs/RECON.md)";

// Sub-folder names inside <out>/<filter>/
AM.DIR_INPUT      = "00_input";
AM.DIR_SOLVED     = "01_solved";   // in the work folder, not per filter
AM.DIR_REGISTERED = "02_registered";
AM.DIR_TRIMMED    = "03_trimmed";

// PixInsight's ImageSolver script. 'script' is relative to <PixInsight>/src/scripts, 'versionRegex' extracts
// the version from the installed source and 'supported' is the version prefix AutoMosaic was tested against.
AM.TOOLS = {
   ImageSolver: {
      title: "ImageSolver", script: "AdP/ImageSolver.js",
      versionRegex: /#define\s+SOLVERVERSION\s+"([^"]+)"/, supported: "6."
   }
};

// Filter name normalisation: [canonical name, regex on a cleaned (lower-case, alnum only) value]
AM.FILTER_ALIASES = [
   ["L",    /^(l|lum|lumi|luminance|clear|clr|uvir|irc|ircut|lpro|lextreme)$/],
   ["R",    /^(r|red)$/],
   ["G",    /^(g|green)$/],
   ["B",    /^(b|blue)$/],
   ["Ha",   /^(ha|halpha|hydrogenalpha|h|h3|ha7nm|ha3nm|ha5nm|ha6nm|ha12nm)$/],
   ["OIII", /^(oiii|o3|oxygen|oiii7nm|oiii3nm|oiii5nm|oiii6nm|oiii12nm)$/],
   ["SII",  /^(sii|s2|sulfur|sulphur|sii7nm|sii3nm|sii5nm|sii6nm|sii12nm)$/]
];

// Patterns searched in the file NAME when the FITS header gives no filter.
// Order matters: more specific first. Each entry [canonical name, regex].
AM.FILENAME_PATTERNS = [
   ["OIII", /(^|[^a-z0-9])(oiii|o3)([^a-z0-9]|$)|filter[-_ ]?oiii|panel\d*oiii/i],
   ["SII",  /(^|[^a-z0-9])(sii|s2)([^a-z0-9]|$)|filter[-_ ]?sii|panel\d*sii/i],
   ["Ha",   /(^|[^a-z0-9])(ha|halpha|h-alpha)([^a-z0-9]|$)|filter[-_ ]?ha|panel\d*ha(?![a-z])/i],
   ["L",    /filter[-_ ]?l([^a-z0-9]|$)|(^|[^a-z0-9])(l|lum|luminance)([^a-z0-9]|$)|panel\d*l(?![a-z])/i],
   ["R",    /filter[-_ ]?r([^a-z0-9]|$)|(^|[^a-z0-9])(r|red)([^a-z0-9]|$)|panel\d*r(?![a-z])/i],
   ["G",    /filter[-_ ]?g([^a-z0-9]|$)|(^|[^a-z0-9])(g|green)([^a-z0-9]|$)|panel\d*g(?![a-z])/i],
   ["B",    /filter[-_ ]?b([^a-z0-9]|$)|(^|[^a-z0-9])(b|blue)([^a-z0-9]|$)|panel\d*b(?![a-z])/i]
];

// Filter order used to choose the default reference filter.
AM.REFERENCE_PREFERENCE = ["L", "Ha", "G", "R", "B", "OIII", "SII"];

AM.defaultOptions = function()
{
   return {
      solve: true,                // plate-solve panels without astrometric data (opens ImageSolver for each one)
      sharedGeometry: true,
      referenceFilter: "",        // "" = automatic (L, otherwise the first filter)
      openCropped: true,          // open the cropped mosaics in PixInsight (default)
      openUncropped: false,       // open the uncropped mosaics in PixInsight
      saveFiles: false,           // write the mosaics to disk (nothing is saved otherwise)
      saveCropped: true,          // when saving: the cropped mosaics
      saveUncropped: false,       // when saving: the uncropped mosaics
      outputDir: "",              // folder for the saved mosaics
      overwrite: false,           // overwrite mosaics already present in outputDir
      execution: "serial",        // serial | parallel
      maxInstances: 2,
      recurse: false,
      cropRotation: true,         // allow a rotated crop rectangle
      cropMargin: 4               // px kept away from any empty pixel
   };
};

AM.needCrop = function(opts) { return !!(opts.openCropped || (opts.saveFiles && opts.saveCropped)); };

// ---------------------------------------------------------------------------
// Paths and third-party script checks
// ---------------------------------------------------------------------------

AM.srcDir = function()
{
   var d = "";
   try { d = CoreApplication.srcDirPath; } catch (e) {}
   if (!d)
      try { d = getEnvironmentVariable("PXI_SRCDIR"); } catch (e) {}
   return d;
};

AM.toolPath = function(key)
{
   return AM.srcDir() + "/scripts/" + AM.TOOLS[key].script;
};

// Returns { ok, version, message }
AM.checkTool = function(key)
{
   var t = AM.TOOLS[key];
   var path = AM.toolPath(key);
   if (!File.exists(path))
      return { ok: false, version: "", message: t.title + " not found at " + path +
         ". Install it from https://pixinsight.astroprocessing.com/ (or update PixInsight)." };
   var version = "";
   try {
      var m = t.versionRegex.exec(File.readTextFile(path));
      if (m) version = m[1];
   } catch (e) {}
   if (!version)
      return { ok: false, version: "", message: t.title + ": cannot determine the installed version; AutoMosaic does not recognize this file." };
   if (version.indexOf(t.supported) !== 0)
      return { ok: false, version: version, message: t.title + " version " + version +
         " is not supported (AutoMosaic " + AM.VERSION + " supports " + t.supported + "x). " +
         "The adapter must be reviewed for this version." };
   return { ok: true, version: version, message: t.title + " " + version };
};

// File / path helpers
AM.joinPath = function(a, b)
{
   a = a.replace(/\\/g, "/");
   if (a.length > 0 && a.charAt(a.length - 1) !== "/") a += "/";
   return a + b;
};

AM.normPath = function(p) { return p.replace(/\\/g, "/"); };

AM.ensureDir = function(dir)
{
   dir = AM.normPath(dir);
   if (File.directoryExists(dir)) return;
   File.createDirectory(dir, true /*createIntermediateDirectories*/);
};

AM.safeName = function(s) { return s.replace(/[^A-Za-z0-9_.\-]+/g, "_"); };

AM.timestamp = function()
{
   var d = new Date();
   function p(n) { return (n < 10 ? "0" : "") + n; }
   return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
};

AM.formatDuration = function(ms)
{
   var s = Math.round(ms / 1000);
   var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
   s = s % 60;
   return (h > 0 ? h + "h " : "") + (h > 0 || m > 0 ? m + "m " : "") + s + "s";
};

// ---------------------------------------------------------------------------
// Temporary work folder: nothing is written anywhere else unless the user chooses to save the mosaics.
// ---------------------------------------------------------------------------

AM._work = "";

AM.workDir = function()
{
   if (!AM._work) {
      var d = AM.joinPath(File.systemTempDirectory, "AutoMosaic_" + AM.timestamp() + "_" + Math.floor(Math.random() * 1e6));
      AM.ensureDir(d);
      AM._work = d;
   }
   return AM._work;
};

// Entries of a folder as [{ path, dir }] (searchDirectory lists files only, so FileFind is used).
AM.listDir = function(dir)
{
   var out = [], f = new FileFind;
   dir = AM.normPath(dir).replace(/\/+$/, "");
   if (f.begin(dir + "/*")) {
      do {
         if (f.name !== "." && f.name !== "..") out.push({ path: dir + "/" + f.name, dir: f.isDirectory });
      } while (f.next());
      f.end();
   }
   return out;
};

AM.removeTree = function(dir)
{
   try {
      dir = AM.normPath(dir).replace(/\/+$/, "");
      if (!File.directoryExists(dir)) return;
      var items = AM.listDir(dir);
      for (var i = 0; i < items.length; ++i) {
         if (items[i].dir) AM.removeTree(items[i].path);
         else try { File.remove(items[i].path); } catch (e) {}
      }
      File.removeDirectory(dir);
   } catch (e2) {}
};

// Deletes the temporary work folder (never touches anything else).
AM.cleanWork = function()
{
   if (AM._work && AM._work.indexOf("AutoMosaic_") > 0) AM.removeTree(AM._work);
   AM._work = "";
};
