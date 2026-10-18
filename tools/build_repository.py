#!/usr/bin/env python3
"""Builds the PixInsight update repository (pixinsight-repository/updates.xri + package zip).

Usage:  python3 tools/build_repository.py [YYYYMMDD]

The package installs into <PixInsight>/src/scripts/AutoMosaic/ . Add this URL in
PixInsight (RESOURCES > Updates > Manage Repositories > Add):
  https://raw.githubusercontent.com/RobertPanai/OneClick-Mosaic-PixInsight/main/pixinsight-repository/
"""
import hashlib, os, re, sys, zipfile, datetime

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
date = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().strftime("%Y%m%d")
version = re.search(r'AM\.VERSION\s*=\s*"([^"]+)"', open(os.path.join(root, "lib", "AM-Config.js")).read()).group(1)
outdir = os.path.join(root, "pixinsight-repository")
os.makedirs(outdir, exist_ok=True)
for f in os.listdir(outdir):
    if f.endswith(".zip"):
        os.remove(os.path.join(outdir, f))
name = "%s-OneClickMosaic.zip" % date
files = ["AutoMosaic.js", "LICENSE", "CREDITS.md", "README.md"]
files += ["lib/" + f for f in sorted(os.listdir(os.path.join(root, "lib"))) if f.endswith(".js")]
with zipfile.ZipFile(os.path.join(outdir, name), "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        zi = zipfile.ZipInfo("src/scripts/AutoMosaic/" + f, date_time=(2026, 1, 1, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, open(os.path.join(root, f), "rb").read())
sha1 = hashlib.sha1(open(os.path.join(outdir, name), "rb").read()).hexdigest()
xri = '''<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <p>OneClick Mosaic - PixInsight, by Robert Panai. One run, one cropped mosaic per filter.</p>
   </description>
   <package fileName="%(name)s" sha1="%(sha1)s" type="script" releaseDate="%(date)s">
      <title>OneClick Mosaic - PixInsight %(version)s</title>
      <description>
         <p>Builds one mosaic per filter with ImageSolver, MosaicByCoordinates, TrimMosaicTile and PhotometricMosaic
         (default settings), then applies one common, rotation-optimised autocrop to every filter.
         Requires those four scripts, which are the work of Andr&#233;s del Pozo, Juan Conejero and John Murphy.
         Installs as SCRIPT &gt; Mosaic &gt; AutoMosaic.</p>
         <p>Project page and credits: https://github.com/RobertPanai/OneClick-Mosaic-PixInsight</p>
      </description>
      <platform os="all" arch="noarch" version="1.8.9:1.9.99"/>
   </package>
</xri>
''' % dict(name=name, sha1=sha1, date=date, version=version)
open(os.path.join(outdir, "updates.xri"), "w", encoding="utf-8").write(xri)
print("built", name, sha1, version)
