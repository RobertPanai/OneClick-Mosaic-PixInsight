// AM-Reproject.js - integrated registration engine, part 2: reprojection of the panels onto the
// shared frame. Uses PixInsight's own astrometric reprojection (ImageWindow.astrometricReprojection);
// the frame's astrometric solution is built from standard FITS WCS keywords.
//
// AM.Reg.run(files, options, ctx) -> AM.StepResult   (same contract as the legacy AM.MBC.run)
//     options.geometry : null (computed from the panels) or a GeometrySpec to impose
//     outputs          : <ctx.outDir>/<name>_ra.xisf
//     data.geometry    : the GeometrySpec used, data.overflow : pixels of data lost outside the frame

AM.Reg = {};

// Valid PixInsight view identifier derived from a file name.
AM.Reg.viewId = function(s)
{
   s = s.replace(/[^A-Za-z0-9_]/g, "_");
   return /^[A-Za-z_]/.test(s) ? s : "_" + s;
};

AM.Reg._key = function(name, value, comment)
{
   return new FITSKeyword(name, value, comment);
};

// Creates the empty float frame with the astrometric solution of 'spec'.
AM.Reg.createFrame = function(spec, channels, isColor, id, srcKeywords)
{
   var win = new ImageWindow(spec.width, spec.height, channels, 32, true, isColor, id);
   var kw = [];
   var skip = /^(CTYPE\d|CRVAL\d|CRPIX\d|CD\d_\d|PC\d_\d|CDELT\d|CROTA\d|LONPOLE|LATPOLE|RADESYS|EQUINOX|PV\d_\d|NAXIS\d?|BITPIX|SIMPLE|EXTEND|A_.*|B_.*|AP_.*|BP_.*|AMOSAIC.*)$/;
   if (srcKeywords)
      for (var i = 0; i < srcKeywords.length; ++i)
         if (!skip.test(srcKeywords[i].name)) kw.push(srcKeywords[i]);
   var f = function(v) { return v.toExponential(12).replace("e", "E"); };
   var c = spec.cd;
   kw.push(AM.Reg._key("CTYPE1", "'RA---TAN'", "Coordinate type"));
   kw.push(AM.Reg._key("CTYPE2", "'DEC--TAN'", "Coordinate type"));
   kw.push(AM.Reg._key("CRVAL1", spec.centerRA.toFixed(10), "Reference RA (deg)"));
   kw.push(AM.Reg._key("CRVAL2", spec.centerDec.toFixed(10), "Reference Dec (deg)"));
   kw.push(AM.Reg._key("CRPIX1", (spec.width / 2 + 0.5).toFixed(3), "Reference pixel X"));
   kw.push(AM.Reg._key("CRPIX2", (spec.height / 2 + 0.5).toFixed(3), "Reference pixel Y"));
   kw.push(AM.Reg._key("CD1_1", f(c[0]), "Linear transformation"));
   kw.push(AM.Reg._key("CD1_2", f(c[1]), "Linear transformation"));
   kw.push(AM.Reg._key("CD2_1", f(c[2]), "Linear transformation"));
   kw.push(AM.Reg._key("CD2_2", f(c[3]), "Linear transformation"));
   kw.push(AM.Reg._key("RADESYS", "'ICRS'", "Reference system"));
   kw.push(AM.Reg._key("EQUINOX", "2000.0", "Equinox"));
   win.mainView.beginProcess(UndoFlag_NoSwapFile);
   win.keywords = kw;
   // The solution itself lives in the view properties (the keywords are for other software).
   var v = win.mainView;
   var P = function(id, value, type) { v.setPropertyValue(id, value, type, PropertyAttribute_Storable | PropertyAttribute_Permanent); };
   P("PCL:AstrometricSolution:ProjectionSystem", "Gnomonic", PropertyType_String8);
   P("PCL:AstrometricSolution:ReferenceCelestialCoordinates", new Vector([spec.centerRA, spec.centerDec]), PropertyType_F64Vector);
   P("PCL:AstrometricSolution:ReferenceImageCoordinates", new Vector([spec.width / 2, spec.height / 2]), PropertyType_F64Vector);
   var lt = new Matrix(2, 2);
   lt.at(0, 0, c[0]); lt.at(0, 1, -c[1]); lt.at(1, 0, c[2]); lt.at(1, 1, -c[3]);   // image y is down
   P("PCL:AstrometricSolution:LinearTransformationMatrix", lt, PropertyType_F64Matrix);
   P("PCL:AstrometricSolution:ReferenceNativeCoordinates", new Vector([0, 90]), PropertyType_F64Vector);
   P("PCL:AstrometricSolution:CelestialPoleNativeCoordinates", new Vector([spec.centerDec < 90 ? 180 : 0, 90]), PropertyType_F64Vector);
   win.mainView.endProcess();
   win.regenerateAstrometricSolution();
   if (!win.hasAstrometricSolution) {
      win.forceClose();
      throw "cannot build the astrometric solution of the mosaic frame";
   }
   return win;
};

// Reprojects 'srcWin' onto the frame; returns the new window.
AM.Reg.reproject = function(spec, srcWin, id)
{
   var img = srcWin.mainView.image;
   var out = AM.Reg.createFrame(spec, img.numberOfChannels, img.isColor, id, srcWin.keywords);
   img.interpolation = Interpolation_Auto;
   img.interpolationClamping = 0.3;
   out.mainView.beginProcess(UndoFlag_NoSwapFile);
   out.mainView.image.interpolationQuality = 1;
   out.astrometricReprojection(srcWin);
   out.mainView.endProcess();
   return out;
};

AM.Reg.run = function(files, options, ctx)
{
   var log = ctx.log;
   var spec = (options && options.geometry) ? options.geometry : null;
   AM.ensureDir(ctx.outDir);
   log.step("Registration (integrated engine) of " + files.length + " panels, geometry: " + AM.Geo.describe(spec));
   var outputs = [], infos = [], wins = [];
   try {
      // 1. open the panels and read their solutions
      for (var i = 0; i < files.length; ++i) {
         var ws = ImageWindow.open(files[i]);
         if (!ws || ws.length < 1 || ws[0].isNull) throw "cannot open " + files[i];
         wins.push(ws[0]);
         if (!ws[0].hasAstrometricSolution) ws[0].regenerateAstrometricSolution();
         infos.push(AM.Geo.panelInfo(ws[0]));
      }
      // 2. geometry
      var overflow = 0;
      var used = spec;
      if (!used) {
         used = AM.Geo.compute(infos);
         log.info("Computed geometry: " + AM.Geo.describe(used));
      } else {
         for (var k = 0; k < infos.length; ++k) {
            var b = AM.Geo.panelBounds(used, infos[k]);
            if (!b) continue;
            overflow = Math.max(overflow, Math.ceil(-used.width / 2 - b.x0), Math.ceil(b.x1 - used.width / 2),
                                          Math.ceil(-used.height / 2 - b.y0), Math.ceil(b.y1 - used.height / 2));
         }
      }
      // 3. reproject
      for (var j = 0; j < wins.length; ++j) {
         if (ctx.abort()) return new AM.StepResult(false, outputs, "aborted by the user");
         var name = File.extractName(files[j]);
         log.info("Reprojecting " + (j + 1) + "/" + wins.length + ": " + name);
         var out = AM.Reg.reproject(used, wins[j], AM.Reg.viewId(name + "_ra"));
         try {
            var path = ctx.outDir + "/" + name + "_ra.xisf";
            if (File.exists(path)) File.remove(path);
            if (!out.saveAs(path, false, false, true, false)) throw "cannot save " + path;
            outputs.push(path);
         } finally { out.forceClose(); }
      }
      return new AM.StepResult(true, outputs, "", { geometry: used, overflow: overflow });
   } catch (e) {
      return new AM.StepResult(false, outputs, "Registration: " + e);
   } finally {
      for (var q = 0; q < wins.length; ++q) try { if (!wins[q].isNull) wins[q].forceClose(); } catch (e2) {}
   }
};
