// AM-Geometry.js - integrated registration engine, part 1: the shared mosaic geometry.
//
// Replaces the geometry stage of MosaicByCoordinates. The method follows the one described in the
// source of MosaicByCoordinates (Copyright (C) 2013-2024 Andres del Pozo, Juan Conejero, BSD
// 2-clause licence, see CREDITS.md): finest resolution of all panels, orientation of the first
// panel, iterative centring on the union of the reprojected panel outlines, size from that union.
// The code below is a new implementation: pixel <-> sky conversion of the panels is done by
// PixInsight itself (ImageWindow.imageToCelestial); the mosaic frame uses a gnomonic (TAN) projection.
//
// A GeometrySpec (also what is shared between filters and serialised to job files):
//   { kind: "tan", centerRA, centerDec,          degrees
//     cd: [cd11, cd12, cd21, cd22],              degrees per pixel, FITS convention (y up)
//     width, height }                            pixels

AM.Geo = {};

AM.Geo.D2R = Math.PI / 180;

// Gnomonic projection of (ra, dec) about (ra0, dec0): standard coordinates in degrees
// (xi towards the east, eta towards the north) or null when the point is not in the hemisphere.
AM.Geo.toPlane = function(ra, dec, ra0, dec0)
{
   var d = AM.Geo.D2R;
   var a = ra * d, b = dec * d, a0 = ra0 * d, b0 = dec0 * d;
   var cosc = Math.sin(b0) * Math.sin(b) + Math.cos(b0) * Math.cos(b) * Math.cos(a - a0);
   if (cosc <= 1e-6) return null;
   return {
      x: Math.cos(b) * Math.sin(a - a0) / cosc / d,
      y: (Math.cos(b0) * Math.sin(b) - Math.sin(b0) * Math.cos(b) * Math.cos(a - a0)) / cosc / d
   };
};

AM.Geo.fromPlane = function(xi, eta, ra0, dec0)
{
   var d = AM.Geo.D2R;
   var x = xi * d, y = eta * d, a0 = ra0 * d, b0 = dec0 * d;
   var rho = Math.sqrt(x * x + y * y);
   if (rho < 1e-15) return { ra: ra0, dec: dec0 };
   var c = Math.atan(rho);
   var dec = Math.asin(Math.cos(c) * Math.sin(b0) + y * Math.sin(c) * Math.cos(b0) / rho);
   var ra = a0 + Math.atan2(x * Math.sin(c), rho * Math.cos(b0) * Math.cos(c) - y * Math.sin(b0) * Math.sin(c));
   ra /= d; dec /= d;
   while (ra < 0) ra += 360;
   while (ra >= 360) ra -= 360;
   return { ra: ra, dec: dec };
};

// Description of the astrometric solution of an open window.
//   info.sky(x, y)  -> { ra, dec } or null   (image coordinates, y down)
//   info.cd         -> [cd11, cd12, cd21, cd22] near the image centre (deg/px, FITS convention)
//   info.scale      -> deg/px
AM.Geo.panelInfo = function(win)
{
   if (!win.hasAstrometricSolution) throw "the image has no astrometric solution";
   var img = win.mainView.image;
   var info = { width: img.width, height: img.height };
   info.sky = function(x, y)
   {
      var p = win.imageToCelestial(new Point(x, y));
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
      return { ra: p.x, dec: p.y };
   };
   var cx = info.width / 2, cy = info.height / 2;
   var c0 = info.sky(cx, cy);
   if (!c0) throw "cannot evaluate the astrometric solution at the image centre";
   var s1 = info.sky(cx + 1, cy), s2 = info.sky(cx, cy + 1);
   if (!s1 || !s2) throw "cannot evaluate the astrometric solution near the image centre";
   var p1 = AM.Geo.toPlane(s1.ra, s1.dec, c0.ra, c0.dec);
   var p2 = AM.Geo.toPlane(s2.ra, s2.dec, c0.ra, c0.dec);
   // derivative with respect to the image x and y; FITS y is the opposite of image y
   info.cd = [p1.x, -p2.x, p1.y, -p2.y];
   info.scale = Math.sqrt(Math.abs(info.cd[0] * info.cd[3] - info.cd[1] * info.cd[2]));
   info.ra = c0.ra; info.dec = c0.dec;
   return info;
};

// Offset in pixels from the centre of the mosaic frame (x right, y down) of a sky position.
AM.Geo.skyToOffset = function(spec, ra, dec)
{
   var p = AM.Geo.toPlane(ra, dec, spec.centerRA, spec.centerDec);
   if (!p) return null;
   var c = spec.cd, det = c[0] * c[3] - c[1] * c[2];
   var dx = (c[3] * p.x - c[1] * p.y) / det;
   var dyf = (-c[2] * p.x + c[0] * p.y) / det;
   return { x: dx, y: -dyf };
};

// Bounding rectangle, as offsets from the centre of the frame 'spec', of the outline of a panel (101x101 samples).
AM.Geo.panelBounds = function(spec, info)
{
   var nx = Math.min(100, info.width), ny = Math.min(100, info.height);
   var b = null;
   for (var j = 0; j <= ny; ++j)
      for (var i = 0; i <= nx; ++i) {
         var s = info.sky(i * info.width / nx, j * info.height / ny);
         if (!s) continue;
         var p = AM.Geo.skyToOffset(spec, s.ra, s.dec);
         if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
         if (!b) b = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
         else {
            if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x;
            if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y;
         }
      }
   return b;
};

// Computes the geometry shared by 'infos' (array of panelInfo).
AM.Geo.compute = function(infos)
{
   if (infos.length < 1) throw "no panels";
   // finest resolution; orientation (rotation and parity) of the first panel
   var res = infos[0].scale;
   for (var i = 1; i < infos.length; ++i) res = Math.min(res, infos[i].scale);
   var k = res / infos[0].scale;
   var cd = [infos[0].cd[0] * k, infos[0].cd[1] * k, infos[0].cd[2] * k, infos[0].cd[3] * k];

   // initial centre: middle of the RA/Dec range of the panel centres (RA unwrapped)
   var ra1 = infos[0].ra, ra2 = ra1, de1 = infos[0].dec, de2 = de1;
   for (var j = 1; j < infos.length; ++j) {
      var r = infos[j].ra;
      while (r < ra1 - 180) r += 360;
      while (r > ra1 + 180) r -= 360;
      ra1 = Math.min(ra1, r); ra2 = Math.max(ra2, r);
      de1 = Math.min(de1, infos[j].dec); de2 = Math.max(de2, infos[j].dec);
   }
   var spec = { kind: "tan", centerRA: (ra1 + ra2) / 2, centerDec: (de1 + de2) / 2, cd: cd, width: 0, height: 0 };

   // refine the centre on the union of the reprojected outlines (at most 20 iterations)
   for (var it = 0; it < 21; ++it) {
      var u = null;
      for (var f = 0; f < infos.length; ++f) {
         var b = AM.Geo.panelBounds(spec, infos[f]);
         if (!b) continue;
         if (!u) u = b;
         else { u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0); u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1); }
      }
      if (!u) throw "the panels cannot be projected on a common plane (field too large for a tangent projection?)";
      var mx = (u.x0 + u.x1) / 2, my = (u.y0 + u.y1) / 2;
      spec.width = Math.ceil(u.x1 - u.x0) + 1;
      spec.height = Math.ceil(u.y1 - u.y0) + 1;
      if (Math.sqrt(mx * mx + my * my) < 0.5 || it === 20) break;
      // move the centre to the middle of the union
      var fx = mx, fy = -my;                          // FITS offsets from the frame centre
      var c = spec.cd;
      var xi = c[0] * fx + c[1] * fy, eta = c[2] * fx + c[3] * fy;
      var sky = AM.Geo.fromPlane(xi, eta, spec.centerRA, spec.centerDec);
      spec.centerRA = sky.ra; spec.centerDec = sky.dec;
   }
   return spec;
};

AM.Geo.describe = function(g)
{
   if (!g) return "automatic";
   return "center RA=" + g.centerRA.toFixed(5) + " Dec=" + g.centerDec.toFixed(5) + ", " +
          (Math.sqrt(Math.abs(g.cd[0] * g.cd[3] - g.cd[1] * g.cd[2])) * 3600).toFixed(4) + " arcsec/px, " +
          g.width + "x" + g.height;
};
