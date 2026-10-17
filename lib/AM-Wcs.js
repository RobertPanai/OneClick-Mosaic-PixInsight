// AM-Wcs.js - astrometric solution checks and helpers.

AM.Wcs = {};

// Fast check of the file header; returns true/false, or null when inconclusive.
AM.Wcs._quickCheck = function(path)
{
   var f = null;
   try {
      var fmt = new FileFormat(File.extractExtension(path), true /*toRead*/, false /*toWrite*/);
      f = new FileFormatInstance(fmt);
      var d = f.open(path, "verbosity 0");
      if (!d || d.length < 1) return null;
      var hasCtype = false, hasCd = false, hasCrval = false;
      var kw = f.keywords;
      for (var i = 0; i < kw.length; ++i) {
         var n = kw[i].name;
         if (n === "CTYPE1") hasCtype = true;
         else if (n === "CRVAL1") hasCrval = true;
         else if (n === "CD1_1" || n === "PC1_1" || n === "CDELT1") hasCd = true;
      }
      if (hasCtype && hasCrval && hasCd) return true;
      try {
         if (fmt.canStoreProperties) {
            var props = f.properties;
            for (var j = 0; j < props.length; ++j) {
               var id = (props[j].id !== undefined) ? props[j].id : props[j];
               if (("" + id).indexOf("PCL:AstrometricSolution") === 0) return true;
            }
         }
      } catch (e) {}
      return null;
   } catch (e) {
      return null;
   } finally {
      try { if (f) f.close(); } catch (e2) {}
   }
};

// Definitive check: a positive quick check is trusted, otherwise the image is
// opened and asked for its astrometric solution (the window is closed again).
AM.Wcs.hasValidSolution = function(path)
{
   var q = AM.Wcs._quickCheck(path);
   if (q === true) return true;
   var w = null;
   try {
      var ws = ImageWindow.open(path);
      if (!ws || ws.length < 1 || ws[0].isNull) return false;
      w = ws[0];
      return !!w.hasAstrometricSolution;
   } catch (e) {
      return false;
   } finally {
      try { if (w) w.forceClose(); } catch (e2) {}
   }
};

// One-line description of the solution of an open window (for logs).
AM.Wcs.describeWindow = function(w)
{
   try {
      if (!w.hasAstrometricSolution) return "no astrometric solution";
      var s = w.astrometricSolutionSummary();
      return ("" + s).replace(/\s+/g, " ").trim();
   } catch (e) {
      return "astrometric solution: unavailable (" + e + ")";
   }
};

// GeometrySpec <-> text, used for job files and logs.
AM.Wcs.geometryToString = function(g)
{
   if (!g) return "automatic";
   return "center RA=" + g.centerRA.toFixed(5) + " Dec=" + g.centerDec.toFixed(5) +
          ", " + (g.resolution * 3600).toFixed(4) + " arcsec/px, rot=" + g.rotation.toFixed(3) +
          ", " + g.width + "x" + g.height + ", projection=" + g.projection;
};
