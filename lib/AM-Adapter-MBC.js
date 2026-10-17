// AM-Adapter-MBC.js - runs MosaicByCoordinates (Andres del Pozo, Juan Conejero)
// headless, with its default settings.
//
// Strategy S3 (see docs/RECON.md): the installed script is #included INSIDE the
// body of a function, so all its globals stay local, and main() is redeclared
// after the include. Function declarations are hoisted and the last one wins, so
// the 'main();' call at the end of MosaicByCoordinates.js runs OUR main(). The
// original file is never copied or modified.
//
// Public API:
//   AM.MBC.run(files, options, ctx) -> AM_StepResult
//     options.geometry : null (automatic geometry) or a GeometrySpec
//     ctx.outDir       : output folder (files get the '_ra' suffix)
//   result.data.geometry : GeometrySpec actually used by MBC

function AM_MBC_exec(files, spec, outDir)
{
   var AM_R = { ok: false, outputs: [], geometry: null, message: "", overflow: 0 };

#undef VERSION
#undef TITLE
#undef SETTINGS_MODULE
#undef SETTINGS_MODULE_SCRIPT
#undef __ADP_COMMONUICONTROLS_js
#undef __ADP_PROJECTIONS_jsh
#undef __ADP_VIEWDIALOG_js
#undef __ADP_SEARCHCOORDINATES_jsh
#undef __ADP_CATALOGDOWNLOADER_js
#undef Ext_DataType_Complex
#undef Ext_DataType_StringArray
#undef Ext_DataType_JSON
#undef WCS_MIN_CATALOG_STARS
#undef WCS_MAX_CATALOG_STARS
#undef WCS_DEFAULT_RBF_TYPE
#undef WCS_MIN_SPLINE_POINTS
#undef WCS_MAX_DENSE_SPLINE_POINTS
#undef WCS_MAX_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_MAX_SPLINE_POINTS
#include <../src/scripts/AdP/MosaicByCoordinates.js>
#undef VERSION
#undef TITLE
#undef SETTINGS_MODULE
#undef __ADP_COMMONUICONTROLS_js
#undef __ADP_PROJECTIONS_jsh
#undef __ADP_VIEWDIALOG_js
#undef __ADP_SEARCHCOORDINATES_jsh
#undef __ADP_CATALOGDOWNLOADER_js
#undef Ext_DataType_Complex
#undef Ext_DataType_StringArray
#undef Ext_DataType_JSON
#undef WCS_MIN_CATALOG_STARS
#undef WCS_MAX_CATALOG_STARS
#undef WCS_DEFAULT_RBF_TYPE
#undef WCS_MIN_SPLINE_POINTS
#undef WCS_MAX_DENSE_SPLINE_POINTS
#undef WCS_MAX_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_DDM_SPLINE_POINTS
#undef WCS_DEFAULT_MAX_SPLINE_POINTS

   // Replaces the main() of MosaicByCoordinates.js (hoisted: the last declaration wins).
   function main()
   {
      var engine = new MosaicByCoordinatesEngine;   // constructor = default settings
      engine.files = files.slice();
      engine.outputDir = outDir;
      engine.suffix = "_ra";
      engine.overwrite = true;                      // the step owns its output folder
      engine.errorPolicy = ErrorPolicy.prototype.Abort;   // never ask: no modal dialogs

      if (spec) {
         engine.centerCoordsAuto = false;
         engine.centerRA = spec.centerRA;
         engine.centerDec = spec.centerDec;
         engine.resolutionAuto = false;
         engine.resolution = spec.resolution;
         engine.rotationAuto = false;
         engine.rotation = spec.rotation;
         engine.projectionAuto = false;
         engine.projection = spec.projection;
         engine.projectionOriginMode = spec.projectionOriginMode;
         engine.projectionOriginRA = spec.projectionOriginRA;
         engine.projectionOriginDec = spec.projectionOriginDec;
         engine.dimensionsAuto = false;
         engine.width = spec.width;
         engine.height = spec.height;
      }

      // Remove stale outputs so that "file exists" is a reliable success test.
      var expected = [];
      for (var i = 0; i < files.length; ++i) {
         var p = outDir + "/" + File.extractName(files[i]) + engine.suffix + ".xisf";
         expected.push(p);
         if (File.exists(p)) File.remove(p);
      }

      try {
         engine.Execute();
      } catch (e) {
         AM_R.message = "MosaicByCoordinates failed: " + e;
         return;
      }

      for (var j = 0; j < expected.length; ++j) {
         if (!File.exists(expected[j])) {
            AM_R.message = "MosaicByCoordinates did not produce " + expected[j] + " (see the console)";
            return;
         }
         AM_R.outputs.push(expected[j]);
      }
      // How far (in pixels) the panels extend beyond the mosaic area? (only > 0 matters)
      try {
         var md0 = engine.CreateMetadata(0, 0);
         for (var f = 0; f < files.length; ++f) {
            var meta = engine.metadataCache[files[f]];
            if (!meta) continue;
            var b = WarpImage.reprojectedBounds(md0, meta);
            var needW = Math.ceil(2 * Math.max(Math.abs(b.x0), Math.abs(b.x1)));
            var needH = Math.ceil(2 * Math.max(Math.abs(b.y0), Math.abs(b.y1)));
            AM_R.overflow = Math.max(AM_R.overflow, needW - engine.width, needH - engine.height);
         }
      } catch (eOv) {}
      AM_R.geometry = {
         projection: engine.projection,
         projectionOriginMode: engine.projectionOriginMode,
         projectionOriginRA: engine.projectionOriginRA,
         projectionOriginDec: engine.projectionOriginDec,
         centerRA: engine.centerRA,
         centerDec: engine.centerDec,
         resolution: engine.resolution,       // degrees per pixel (as used internally by MBC)
         rotation: engine.rotation,
         width: engine.width,
         height: engine.height
      };
      AM_R.ok = true;
   }

   return AM_R;
}

AM.MBC = {};

AM.MBC.run = function(files, options, ctx)
{
   var chk = AM.checkTool("MBC");
   if (!chk.ok) return new AM.StepResult(false, [], chk.message);
   AM.ensureDir(ctx.outDir);
   var spec = (options && options.geometry) ? options.geometry : null;
   ctx.log.step("MosaicByCoordinates " + chk.version + " on " + files.length + " panels, geometry: " +
                AM.Wcs.geometryToString(spec));
   var r;
   try {
      r = AM_MBC_exec(files, spec, AM.normPath(ctx.outDir));
   } catch (e) {
      return new AM.StepResult(false, [], "MosaicByCoordinates: " + e);
   }
   if (!r.ok) return new AM.StepResult(false, r.outputs, r.message);
   ctx.log.info("MBC geometry used: " + AM.Wcs.geometryToString(r.geometry));
   return new AM.StepResult(true, r.outputs, "", { geometry: r.geometry, overflow: r.overflow });
};
