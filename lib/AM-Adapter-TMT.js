// AM-Adapter-TMT.js - runs TrimMosaicTile (John Murphy) headless, default settings.
// Same scoped-include strategy as AM-Adapter-MBC.js (S3).
//
// Public API:
//   AM.TMT.run(files, options, ctx) -> AM_StepResult   (outputs in ctx.outDir)
//     options.pixelSize / options.focalLength : used only when the file header
//     has no XPIXSZ / FOCALLEN (PhotometricMosaic needs them).

function AM_TMT_exec(files, outDir, pixelSize, focalLength)
{
   var AM_R = { ok: false, outputs: [], message: "" };

#undef KEYPREFIX
#undef TRIM_PREVIEW_NAME
#include <../src/scripts/JohnMurphy/PhotometricMosaic/TrimMosaicTile.js>
#undef KEYPREFIX
#undef TRIM_PREVIEW_NAME

   function main()
   {
      for (var i = 0; i < files.length; ++i) {
         var win = null;
         try {
            var ws = ImageWindow.open(files[i]);
            if (!ws || ws.length < 1 || ws[0].isNull)
               throw "cannot open " + files[i];
            win = ws[0];

            // PhotometricMosaic needs the pixel size and the focal length in the header.
            var view = win.mainView;
            var kw = win.keywords;
            var px = getPixelSize(view, 0);
            var fl = getFocalLength(view, 0);
            var added = false;
            if (!px) {
               if (!pixelSize) throw "XPIXSZ (pixel size) is missing in the header of " + File.extractNameAndExtension(files[i]) +
                  ". Set the pixel size in the AutoMosaic options.";
               kw.push(new FITSKeyword("XPIXSZ", pixelSize.toFixed(2), "Pixel size including binning, X-axis (um)"));
               added = true;
            }
            if (!fl) {
               if (!focalLength) throw "FOCALLEN (focal length) is missing in the header of " + File.extractNameAndExtension(files[i]) +
                  ". Set the focal length in the AutoMosaic options.";
               kw.push(new FITSKeyword("FOCALLEN", focalLength.toFixed(), "Focal length (mm)"));
               added = true;
            }
            if (added) win.keywords = kw;

            var data = new TrimImageData();        // constructor = default settings
            data.targetView = win.mainView;
            data.checkFitsHeaders = false;         // already handled above, never show a dialog
            trimImage(data);

            var outPath = outDir + "/" + File.extractName(files[i]) + ".xisf";
            if (File.exists(outPath)) File.remove(outPath);
            if (!win.saveAs(outPath, false, false, true, false))
               throw "cannot save " + outPath;
            AM_R.outputs.push(outPath);
         } catch (e) {
            AM_R.message = "TrimMosaicTile failed on " + File.extractNameAndExtension(files[i]) + ": " + e;
            return;
         } finally {
            if (win && !win.isNull) win.forceClose();
         }
      }
      AM_R.ok = true;
   }

   return AM_R;
}

AM.TMT = {};

AM.TMT.run = function(files, options, ctx)
{
   var chk = AM.checkTool("TMT");
   if (!chk.ok) return new AM.StepResult(false, [], chk.message);
   AM.ensureDir(ctx.outDir);
   ctx.log.step("TrimMosaicTile " + chk.version + " on " + files.length + " panels");
   var r;
   try {
      r = AM_TMT_exec(files, AM.normPath(ctx.outDir),
                      (options && options.pixelSize) || 0, (options && options.focalLength) || 0);
   } catch (e) {
      return new AM.StepResult(false, [], "TrimMosaicTile: " + e);
   }
   return new AM.StepResult(r.ok, r.outputs, r.message);
};
