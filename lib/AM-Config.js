// AM-Config.js - AutoMosaic constants, defaults and tool registry.
//
// AutoMosaic (c) 2026. Runs ImageSolver, MosaicByCoordinates, TrimMosaicTile and
// PhotometricMosaic (third-party scripts, NOT bundled) with default settings.

var AM = {};

AM.VERSION = "0.2.0";
AM.TITLE = "AutoMosaic";
AM.SETTINGS_KEY = "AutoMosaic";
AM.UNKNOWN_FILTER = "Unknown";
AM.IMAGE_EXTENSIONS = [".xisf", ".fits", ".fit", ".fts"];

// Parallel execution (several PixInsight instances). Set by the job-mode check.
AM.PARALLEL_AVAILABLE = false;
AM.PARALLEL_REASON = "not verified on this PixInsight version (see docs/RECON.md)";

// Sub-folder names inside <out>/<filter>/
AM.DIR_INPUT      = "00_input";
AM.DIR_SOLVED     = "01_solved";
AM.DIR_REGISTERED = "02_registered";
AM.DIR_TRIMMED    = "03_trimmed";

// Third-party scripts. 'script' is relative to <PixInsight>/src/scripts.
// 'versionRegex' extracts the version from the installed source, 'supported' is
// the version prefix AutoMosaic was written and tested against.
AM.TOOLS = {
   ImageSolver: {
      title: "ImageSolver", script: "AdP/ImageSolver.js",
      versionRegex: /#define\s+SOLVERVERSION\s+"([^"]+)"/, supported: "6."
   },
   MBC: {
      title: "MosaicByCoordinates", script: "AdP/MosaicByCoordinates.js",
      versionRegex: /#define\s+VERSION\s+"([^"]+)"/, supported: "1.3."
   },
   TMT: {
      title: "TrimMosaicTile", script: "JohnMurphy/PhotometricMosaic/TrimMosaicTile.js",
      versionRegex: /function\s+VERSION\(\)\s*\{\s*return\s+"([^"]+)"/, supported: "4."
   },
   PMM: {
      title: "PhotometricMosaic", script: "JohnMurphy/PhotometricMosaic/PhotometricMosaic.js",
      versionRegex: /function\s+VERSION\(\)\s*\{\s*return\s+"([^"]+)"/, supported: "4."
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
      solveMode: "ifMissing",     // never | ifMissing | always
      sharedGeometry: true,
      referenceFilter: "",        // "" = automatic (L, otherwise the first filter)
      keepIntermediate: true,
      overwrite: false,
      execution: "serial",        // serial | parallel
      maxInstances: 2,
      recurse: false,
      autocrop: true,             // common, rotation-optimised crop of the mosaics (adds Mosaic_<filter>_crop.xisf)
      cropRotation: true,         // allow a rotated crop rectangle
      cropMargin: 4,              // px kept away from any empty pixel
      outputDir: "",
      pixelSize: 0,               // um, 0 = use FITS header (only needed if missing)
      focalLength: 0              // mm, 0 = use FITS header (only needed if missing)
   };
};

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

// Checks all four tools. Returns { ok, messages[] }
AM.checkAllTools = function(needSolver)
{
   var res = { ok: true, messages: [] };
   var keys = ["MBC", "TMT", "PMM"];
   if (needSolver) keys.unshift("ImageSolver");
   for (var i = 0; i < keys.length; ++i) {
      var r = AM.checkTool(keys[i]);
      res.messages.push(r.message);
      if (!r.ok) res.ok = false;
   }
   return res;
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
