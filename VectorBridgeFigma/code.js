// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Sendwich for Figma: the selection -> a clip for the Sendwich panel in After Effects.
// Same clip format as the Illustrator panel, so After Effects builds it with the same code.
// Coordinates: relative to the frame that holds the selection (the "artboard"), Y down, in pixels.
var VERSION = "1.0.0";
figma.showUI(__html__, { width: 300, height: 330, themeColors: true });

// ---------- SVG path data (Figma geometry) -> bezier points ----------
function vbx_parseD(d) {
    var tok = [], re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g, m;
    while ((m = re.exec(d || ""))) tok.push(m[1] ? m[1] : parseFloat(m[2]));
    var subs = [], sub = null, cur = [0, 0], start = [0, 0], lastC = null, cmd = "", prev = "", k = 0;
    function num() { return tok[k++]; }
    function node(a, i) { var n = { a: a, i: i || a, o: a }; sub.nodes.push(n); return n; }
    function begin(p) { sub = { closed: false, nodes: [] }; subs.push(sub); node(p); start = p; }
    function last() { return sub.nodes[sub.nodes.length - 1]; }
    while (k < tok.length) {
        if (typeof tok[k] === "string") { cmd = tok[k++]; if (cmd === "Z" || cmd === "z") {
            if (sub && sub.nodes.length > 1) {
                var f = sub.nodes[0], l = last();
                if (Math.abs(f.a[0] - l.a[0]) < 1e-3 && Math.abs(f.a[1] - l.a[1]) < 1e-3) { f.i = l.i; sub.nodes.pop(); }
                sub.closed = true;
            }
            cur = start; prev = "Z"; sub = null; continue; } }
        var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), p, c1, c2;
        if (typeof tok[k] !== "number") { k++; continue; }
        if (!sub && C !== "M") begin(cur);
        if (C === "M") { p = [num(), num()]; if (rel) p = [cur[0] + p[0], cur[1] + p[1]]; begin(p); cur = p; cmd = rel ? "l" : "L"; }
        else if (C === "L") { p = [num(), num()]; if (rel) p = [cur[0] + p[0], cur[1] + p[1]]; node(p); cur = p; }
        else if (C === "H") { var x = num(); p = [rel ? cur[0] + x : x, cur[1]]; node(p); cur = p; }
        else if (C === "V") { var y = num(); p = [cur[0], rel ? cur[1] + y : y]; node(p); cur = p; }
        else if (C === "C" || C === "S") {
            if (C === "C") { c1 = [num(), num()]; if (rel) c1 = [cur[0] + c1[0], cur[1] + c1[1]]; }
            else c1 = (lastC && /[CS]/.test(prev)) ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur;
            c2 = [num(), num()]; p = [num(), num()];
            if (rel) { c2 = [cur[0] + c2[0], cur[1] + c2[1]]; p = [cur[0] + p[0], cur[1] + p[1]]; }
            last().o = c1; node(p, c2); cur = p; lastC = c2;
        } else if (C === "Q" || C === "T") {
            var q;
            if (C === "Q") { q = [num(), num()]; if (rel) q = [cur[0] + q[0], cur[1] + q[1]]; }
            else q = (lastC && /[QT]/.test(prev)) ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur;
            p = [num(), num()]; if (rel) p = [cur[0] + p[0], cur[1] + p[1]];
            last().o = [cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1])];
            node(p, [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])]); cur = p; lastC = q;
        } else if (C === "A") {      // arcs are rare in Illustrator SVG: straight line to the end point
            num(); num(); num(); num(); num(); p = [num(), num()]; if (rel) p = [cur[0] + p[0], cur[1] + p[1]]; node(p); cur = p;
        } else k++;
        prev = C;
    }
    return subs;
}

// ---------- matrices: Figma Transform [[a, c, e], [b, d, f]] ----------
function mul(A, B) {
  return [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1], A[0][0] * B[0][2] + A[0][1] * B[1][2] + A[0][2]],
          [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1], A[1][0] * B[0][2] + A[1][1] * B[1][2] + A[1][2]]];
}
function inv(M) {
  var a = M[0][0], c = M[0][1], e = M[0][2], b = M[1][0], d = M[1][1], f = M[1][2], det = a * d - b * c || 1e-12;
  return [[d / det, -c / det, (c * f - d * e) / det], [-b / det, a / det, (b * e - a * f) / det]];
}
function ap(M, p) { return [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2]]; }

var AB = null, stats = null, images = [], SCALE = 2, strokeWorkspace = null;
var IDENTITY = [[1, 0, 0], [0, 1, 0]];
function rel(n) { return mul(AB.inv, n.absoluteTransform); }

// ---------- colour / paint ----------
function vis(arr) { if (!arr || arr === figma.mixed) return []; var o = []; for (var i = 0; i < arr.length; i++) if (arr[i].visible !== false) o.push(arr[i]); return o; }
function visiblePaints(paints) {
  return vis(paints).filter(function (paint) {
    return paint.opacity !== 0 && (!paint.gradientStops || paint.gradientStops.some(function (stop) { return stop.color.a > 0; }));
  });
}
function rgb(c) { return [c.r, c.g, c.b]; }
function gradOf(p, n, M) {
  var stops = [], i, gs = p.gradientStops;
  for (i = 0; i < gs.length; i++) stops.push([gs[i].position, 0.5, gs[i].color.r, gs[i].color.g, gs[i].color.b, gs[i].color.a]);
  var T = p.gradientTransform, I = inv([[T[0][0], T[0][1], T[0][2]], [T[1][0], T[1][1], T[1][2]]]), w = n.width || 1, h = n.height || 1;
  function loc(q) { var u = ap(I, q); return ap(M, [u[0] * w, u[1] * h]); }
  var radial = p.type !== "GRADIENT_LINEAR";
  if (p.type === "GRADIENT_ANGULAR" || p.type === "GRADIENT_DIAMOND") stats.notes[p.type === "GRADIENT_ANGULAR" ? "angular gradient as radial" : "diamond gradient as radial"] = 1;
  return { type: radial ? 2 : 1, stops: stops, start: loc(radial ? [0.5, 0.5] : [0, 0.5]), end: loc([1, 0.5]) };
}
// one paint -> fill part of a style
function fillPaint(st, p, n, M) {
  if (p.type === "SOLID") st.fill = rgb(p.color);
  else if (p.type.indexOf("GRADIENT") === 0) { st.fillGrad = gradOf(p, n, M); st.fill = st.fillGrad.stops.length ? st.fillGrad.stops[0].slice(2, 5) : [0.5, 0.5, 0.5]; st.grad = true; stats.gradients++; }
  if (p.opacity !== undefined && p.opacity < 1) st.fillOp = Math.round(p.opacity * 1000) / 10;
}
var CAP = { NONE: 1, ROUND: 2, SQUARE: 3 }, JOIN = { MITER: 1, ROUND: 2, BEVEL: 3 };
function strokeOf(n, M) {
  var ps = visiblePaints(n.strokes);
  if (!ps.length) return null;
  var p = ps[ps.length - 1], w = n.strokeWeight;
  if (w === figma.mixed) w = Math.max(n.strokeTopWeight || 0, n.strokeRightWeight || 0, n.strokeBottomWeight || 0, n.strokeLeftWeight || 0);
  if (!(w > 0)) return null;
  var s = { width: w, cap: CAP[n.strokeCap] || 1, join: JOIN[n.strokeJoin] || 1, miter: n.strokeMiterLimit || 4 };
  if (p.type === "SOLID") s.color = rgb(p.color);
  else if (p.type.indexOf("GRADIENT") === 0) { s.grad = gradOf(p, n, M); s.color = s.grad.stops[0].slice(2, 5); stats.gradients++; }
  else return null;
  if (p.opacity !== undefined && p.opacity < 1) s.op = Math.round(p.opacity * 1000) / 10;
  if (n.dashPattern && n.dashPattern.length) s.dashes = n.dashPattern.slice(0);
  return s;
}

function hasBackdrop(n) { return vis(n.effects).some(function (effect) { return effect.type === "BACKGROUND_BLUR" && effect.radius > 0; }); }

function alignedStroke(n) {
  if (!(n.strokeAlign === "INSIDE" || n.strokeAlign === "OUTSIDE" || n.strokeWeight === figma.mixed) || !visiblePaints(n.strokes).length) return null;
  var sourceTransform = rel(n), clone = null, outlined = null, layers = [];
  try {
    if (typeof n.outlineStroke === "function") {
      // Generate the outline at page origin. Figma can give the temporary node an offset in nested containers.
      if (!strokeWorkspace) {
        strokeWorkspace = figma.createFrame();
        strokeWorkspace.relativeTransform = IDENTITY;
        strokeWorkspace.clipsContent = false;
        strokeWorkspace.fills = [];
      }
      clone = n.clone();
      strokeWorkspace.appendChild(clone);
      clone.relativeTransform = IDENTITY;
      outlined = clone.outlineStroke();
    }
    if (outlined && outlined !== clone) {
      var M = mul(sourceTransform, outlined.absoluteTransform);
      var paths = geometry(outlined, M), fills = visiblePaints(outlined.fills);
      for (var i = fills.length - 1; i >= 0 && paths.length; i--) {
        var st = { evenodd: paths.evenodd };
        fillPaint(st, fills[i], outlined, M);
        if (st.fill) layers.push({ type: "shape", name: "Stroke · " + n.strokeAlign, opacity: 100, paths: paths, style: st, bounds: boundsOf(paths) });
      }
      if (layers.length) { stats.paths += paths.length * layers.length; return layers; }
    }
  } catch (e) {}
  finally {
    if (outlined && outlined !== clone) outlined.remove();
    if (clone) clone.remove();
  }
  stats.notes["Some aligned strokes could not be outlined and use a centered stroke"] = 1;
  return null;
}

// ---------- geometry ----------
function pathsOf(list, M, round) {
  var out = [], evenodd = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].windingRule === "EVENODD") evenodd = true;
    var subs = vbx_parseD(list[i].data);
    for (var j = 0; j < subs.length; j++) {
      if (subs[j].nodes.length < 2) continue;
      if (round) subs[j] = roundSub(subs[j], round);
      var pts = [];
      for (var k = 0; k < subs[j].nodes.length; k++) { var q = subs[j].nodes[k]; pts.push([ap(M, q.a), ap(M, q.i), ap(M, q.o)]); }
      out.push({ closed: subs[j].closed, pts: pts });
    }
  }
  out.evenodd = evenodd;
  return out;
}
// ---------- corner radius on vector paths ----------
// Figma keeps the radius as a setting (per vertex or for the whole vector); vectorPaths come without it.
// Every sharp corner between two straight segments gets the same arc Figma draws: tangent points at r / tan(angle / 2).
function radiusFn(n) {
  var all = typeof n.cornerRadius === "number" ? n.cornerRadius : 0, vs = null;
  try { vs = n.vectorNetwork && n.vectorNetwork.vertices; } catch (e) {}
  var any = all > 0;
  if (vs) for (var i = 0; i < vs.length; i++) if (vs[i].cornerRadius > 0) any = true;
  if (!any) return null;
  return function (p) {
    if (vs) for (var i = 0; i < vs.length; i++)
      if (Math.abs(vs[i].x - p[0]) < 0.01 && Math.abs(vs[i].y - p[1]) < 0.01) return vs[i].cornerRadius > 0 ? vs[i].cornerRadius : all;
    return all;
  };
}
function roundSub(sub, rf) {
  var N = sub.nodes, n = N.length, out = [], K = 0.5522847498, i;
  function sharp(q) { return Math.abs(q.i[0] - q.a[0]) + Math.abs(q.i[1] - q.a[1]) + Math.abs(q.o[0] - q.a[0]) + Math.abs(q.o[1] - q.a[1]) < 1e-6; }
  function straight(a, b) { return Math.abs(a.o[0] - a.a[0]) + Math.abs(a.o[1] - a.a[1]) + Math.abs(b.i[0] - b.a[0]) + Math.abs(b.i[1] - b.a[1]) < 1e-6; }
  for (i = 0; i < n; i++) {
    var q = N[i], pv = N[(i - 1 + n) % n], nx = N[(i + 1) % n], r = rf(q.a);
    var inner = sub.closed || (i > 0 && i < n - 1);
    if (!(r > 0) || !inner || !sharp(q) || !straight(pv, q) || !straight(q, nx)) { out.push({ a: q.a, i: q.i, o: q.o }); continue; }
    var u = [pv.a[0] - q.a[0], pv.a[1] - q.a[1]], v = [nx.a[0] - q.a[0], nx.a[1] - q.a[1]];
    var lu = Math.sqrt(u[0] * u[0] + u[1] * u[1]), lv = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    if (lu < 1e-6 || lv < 1e-6) { out.push({ a: q.a, i: q.i, o: q.o }); continue; }
    u = [u[0] / lu, u[1] / lu]; v = [v[0] / lv, v[1] / lv];
    var cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])), ang = Math.acos(cos);     // angle between the two edges
    if (ang < 1e-3 || Math.PI - ang < 1e-3) { out.push({ a: q.a, i: q.i, o: q.o }); continue; }
    var d = Math.min(r / Math.tan(ang / 2), lu / 2, lv / 2);                 // tangent distance, at most half of each edge
    var rr = d * Math.tan(ang / 2), sweep = Math.PI - ang;                   // effective radius and arc angle
    var h = 4 / 3 * Math.tan(sweep / 4) * rr;                                // bezier handle length for that arc
    var p1 = [q.a[0] + u[0] * d, q.a[1] + u[1] * d], p2 = [q.a[0] + v[0] * d, q.a[1] + v[1] * d];
    out.push({ a: p1, i: p1, o: [p1[0] - u[0] * h, p1[1] - u[1] * h] });
    out.push({ a: p2, i: [p2[0] - v[0] * h, p2[1] - v[1] * h], o: p2 });
  }
  return { closed: sub.closed, nodes: out };
}
function geometry(n, M) {
  var list = null, round = null;
  if (n.type === "VECTOR" && n.vectorPaths && n.vectorPaths.length) {
    // closed and filled: Figma's own fill geometry already has the corners rounded (also smoothing);
    // open paths (strokes) keep their path, rounded here
    var closed = true;
    for (var i = 0; i < n.vectorPaths.length; i++) if (!/z\s*$/i.test(n.vectorPaths[i].data)) closed = false;
    if (closed && n.fillGeometry && n.fillGeometry.length) list = n.fillGeometry;
    else { list = n.vectorPaths; round = radiusFn(n); }
  }
  else if (n.type === "LINE") list = [{ windingRule: "NONZERO", data: "M 0 0 L " + n.width + " 0" }];
  else if (n.fillGeometry && n.fillGeometry.length) list = n.fillGeometry;
  else if (n.type === "ELLIPSE" && !(n.arcData && (n.arcData.innerRadius > 0 || Math.abs(n.arcData.endingAngle - n.arcData.startingAngle - 2 * Math.PI) > 1e-3))) list = [{ windingRule: "NONZERO", data: ellipseD(n.width, n.height) }];
  else if (n.type !== "VECTOR" && n.type !== "POLYGON" && n.type !== "STAR" && n.type !== "BOOLEAN_OPERATION") list = [{ windingRule: "NONZERO", data: rectD(n.width, n.height, n) }];
  else if (n.type === "POLYGON" || n.type === "STAR") list = [{ windingRule: "NONZERO", data: polyD(n) }];
  else { stats.notes["“" + n.name + "” has no fill geometry and was skipped"] = 1; list = []; }
  return pathsOf(list || [], M, round);
}
function rectD(w, h, n) {
  var all = typeof n.cornerRadius === "number" ? n.cornerRadius : 0;
  function c(v) { return Math.max(0, Math.min(typeof v === "number" ? v : all, w / 2, h / 2)); }
  var tl = c(n.topLeftRadius), tr = c(n.topRightRadius), br = c(n.bottomRightRadius), bl = c(n.bottomLeftRadius), K = 1 - 0.5522847498;
  var d = "M " + tl + " 0 L " + (w - tr) + " 0";
  if (tr) d += " C " + (w - tr * K) + " 0 " + w + " " + (tr * K) + " " + w + " " + tr;
  d += " L " + w + " " + (h - br);
  if (br) d += " C " + w + " " + (h - br * K) + " " + (w - br * K) + " " + h + " " + (w - br) + " " + h;
  d += " L " + bl + " " + h;
  if (bl) d += " C " + (bl * K) + " " + h + " 0 " + (h - bl * K) + " 0 " + (h - bl);
  d += " L 0 " + tl;
  if (tl) d += " C 0 " + (tl * K) + " " + (tl * K) + " 0 " + tl + " 0";
  return d + " Z";
}
function ellipseD(w, h) {
  var rx = w / 2, ry = h / 2, kx = rx * 0.5522847498, ky = ry * 0.5522847498;
  return "M " + rx + " 0 C " + (rx + kx) + " 0 " + w + " " + (ry - ky) + " " + w + " " + ry + " C " + w + " " + (ry + ky) + " " + (rx + kx) + " " + h + " " + rx + " " + h +
         " C " + (rx - kx) + " " + h + " 0 " + (ry + ky) + " 0 " + ry + " C 0 " + (ry - ky) + " " + (rx - kx) + " 0 " + rx + " 0 Z";
}
// polygon / star without fills (no fillGeometry): the same points Figma draws, fitted to the layer size
function polyD(n) {
  var k = Math.max(3, n.pointCount || 3), star = n.type === "STAR", ir = star ? (n.innerRadius || 0.382) : 1, pts = [], i;
  var steps = star ? 2 * k : k;
  for (i = 0; i < steps; i++) {
    var a = -Math.PI / 2 + i * 2 * Math.PI / steps, r = star && (i % 2) ? ir : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  var b = [1e9, 1e9, -1e9, -1e9];
  for (i = 0; i < pts.length; i++) { b[0] = Math.min(b[0], pts[i][0]); b[1] = Math.min(b[1], pts[i][1]); b[2] = Math.max(b[2], pts[i][0]); b[3] = Math.max(b[3], pts[i][1]); }
  var d = "";
  for (i = 0; i < pts.length; i++) d += (i ? " L " : "M ") + ((pts[i][0] - b[0]) / (b[2] - b[0]) * n.width) + " " + ((pts[i][1] - b[1]) / (b[3] - b[1]) * n.height);
  return d + " Z";
}
function boundsOf(paths) {
  var b = [1e9, 1e9, -1e9, -1e9];
  for (var i = 0; i < paths.length; i++) for (var j = 0; j < paths[i].pts.length; j++) {
    var p = paths[i].pts[j][0];
    if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
  }
  return b;
}

// ---------- common: opacity, blend, effects ----------
var BLEND = { MULTIPLY: "MULTIPLY", SCREEN: "SCREEN", OVERLAY: "OVERLAY", SOFT_LIGHT: "SOFTLIGHT", HARD_LIGHT: "HARDLIGHT",
              COLOR_DODGE: "COLORDODGE", COLOR_BURN: "COLORBURN", DARKEN: "DARKEN", LIGHTEN: "LIGHTEN", DIFFERENCE: "DIFFERENCE",
              EXCLUSION: "EXCLUSION", HUE: "HUE", SATURATION: "SATURATIONBLEND", COLOR: "COLORBLEND", LUMINOSITY: "LUMINOSITY" };
var FIG_BLUR = 1;   // Figma layer blur radius -> After Effects Blurriness
function common(o, n, raster) {
  o.opacity = Math.round((n.opacity === undefined ? 1 : n.opacity) * 1000) / 10;
  if (n.blendMode && BLEND[n.blendMode]) { o.blend = BLEND[n.blendMode]; stats.blends++; }
  var fx = vis(n.effects);
  for (var i = 0; i < fx.length; i++) {
    var e = fx[i];
    if (e.type === "BACKGROUND_BLUR" && e.radius > 0) {
      var outline = geometry(n, rel(n));
      var paths = outline.filter(function (path) { return path.closed; });
      if (paths.length) o.backdrop = { radius: Math.round(e.radius * FIG_BLUR * 10) / 10, paths: paths, evenodd: outline.evenodd, opacity: o.opacity };
      else stats.notes["Background blur could not be outlined"] = 1;
      continue;
    }
    if (raster) continue;
    if (e.type === "LAYER_BLUR") { o.blur = Math.round(e.radius * FIG_BLUR * 10) / 10; stats.blurs++; }
    else if (e.type === "DROP_SHADOW") {
      o.shadow = { color: rgb(e.color), op: Math.round(e.color.a * 1000) / 10, dx: e.offset.x, dy: e.offset.y, blur: e.radius };
      stats.shadows++;
    } else stats.notes[(e.type === "INNER_SHADOW" ? "inner shadow" : "effect") + " not transferred"] = 1;
  }
  if (raster) o.opacity = 100;
  return o;
}

// ---------- items ----------
function shapeItem(n) {
  var M = rel(n), paths = geometry(n, M);
  if (!paths.length) return null;
  var fills = visiblePaints(n.fills);
  for (var i = 0; i < fills.length; i++) if (fills[i].type === "IMAGE" || fills[i].type === "VIDEO") return null;   // -> image
  var outline = alignedStroke(n), stroke = outline ? null : strokeOf(n, M);
  if (!fills.length && !stroke && !outline) return hasBackdrop(n) ? common({ type: "group", name: n.name, children: [] }, n) : null;
  stats.paths += paths.length;
  function leaf(name, p, withStroke) {
    var st = { evenodd: paths.evenodd };
    if (p) fillPaint(st, p, n, M);
    if (withStroke && stroke) st.stroke = stroke;
    return { type: "shape", name: name, opacity: 100, paths: paths, style: st, bounds: boundsOf(paths) };
  }
  var o, i;
  if (outline) {
    o = { type: "group", name: n.name, children: outline, bounds: boundsOf(paths) };
    for (i = fills.length - 1; i >= 0; i--) o.children.push(leaf(n.name + " Fill", fills[i], false));
  } else if (fills.length <= 1) o = leaf(n.name, fills[0], true);
  else {                                        // several fills: one shape per fill, the stroke on the top one
    o = { type: "group", name: n.name, children: [] };
    for (i = fills.length - 1; i >= 0; i--) o.children.push(leaf(n.name + " Fill " + (i + 1), fills[i], i === fills.length - 1));
    o.bounds = boundsOf(paths);
  }
  return common(o, n);
}

function textItem(n) {
  var M = rel(n), w = n.width, h = n.height;
  var segs = n.getStyledTextSegments(["fontName", "fontSize", "fills", "letterSpacing", "lineHeight"]), runs = [];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i], size = s.fontSize, f = vis(s.fills), col = [0, 0, 0];
    for (var k = f.length - 1; k >= 0; k--) { if (f[k].type === "SOLID") { col = rgb(f[k].color); break; } if (f[k].gradientStops) { col = rgb(f[k].gradientStops[0].color); break; } }
    var ls = s.letterSpacing, lh = s.lineHeight;
    var tracking = !ls ? 0 : (ls.unit === "PERCENT" ? ls.value * 10 : ls.value / size * 1000);
    var leading = !lh || lh.unit === "AUTO" ? 0 : (lh.unit === "PIXELS" ? lh.value : size * lh.value / 100);
    var fam = s.fontName.family, sty = s.fontName.style;
    runs.push({ s: s.start, n: s.end - s.start, font: fam.replace(/\s+/g, "") + "-" + sty.replace(/\s+/g, ""), family: fam, style: sty,
                size: size, tracking: Math.round(tracking), leading: leading, color: col });
  }
  if (!runs.length) return null;
  var size0 = runs[0].size, bw = w + Math.max(2, w * 0.02), bh = h + size0 * 0.6;    // a little air: After Effects wraps a bit earlier
  var A = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "full" };
  var dx = A[n.textAlignHorizontal] === "center" ? -(bw - w) / 2 : (A[n.textAlignHorizontal] === "right" ? -(bw - w) : 0);
  var c = ap(M, [dx + bw / 2, bh / 2]);
  stats.texts++;
  return common({ type: "text", name: n.name, text: n.characters.replace(/\r\n|\n|\u2028|\u2029/g, "\r"), box: true,
    boxW: bw, boxH: bh, center: c, rot: -Math.atan2(M[1][0], M[0][0]) * 180 / Math.PI,
    sx: Math.sqrt(M[0][0] * M[0][0] + M[1][0] * M[1][0]), sy: Math.sqrt(M[0][1] * M[0][1] + M[1][1] * M[1][1]),
    just: A[n.textAlignHorizontal] || "left", runs: runs }, n);
}

function frameBounds(n) {        // absolute render bounds -> artboard rectangle [x1, y1, x2, y2]
  var r = n.absoluteRenderBounds || n.absoluteBoundingBox;
  var corners = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
  var bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (var i = 0; i < corners.length; i++) {
    var p = ap(AB.inv, corners[i]);
    bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]);
    bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]);
  }
  return bounds;
}
async function imageItem(n, name) {
  var bytes = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: SCALE } });
  var file = "img" + (images.length + 1) + ".png";
  images.push({ name: file, b64: figma.base64Encode(bytes) });
  stats.images++;
  return common({ type: "image", name: name || n.name, file: file, bounds: frameBounds(n), scale: SCALE }, n, true);
}

async function frameImageFill(n, fills) {
  var tile = figma.createRectangle();
  try {
    tile.resize(n.width, n.height);
    tile.fills = fills;
    tile.relativeTransform = n.absoluteTransform;
    tile.topLeftRadius = n.topLeftRadius || 0;
    tile.topRightRadius = n.topRightRadius || 0;
    tile.bottomLeftRadius = n.bottomLeftRadius || 0;
    tile.bottomRightRadius = n.bottomRightRadius || 0;
    if (typeof n.cornerSmoothing === "number") tile.cornerSmoothing = n.cornerSmoothing;
    return await imageItem(tile, n.name + " Background");
  } finally { tile.remove(); }
}

var CONTAINER = { GROUP: 1, FRAME: 1, COMPONENT: 1, COMPONENT_SET: 1, INSTANCE: 1, SECTION: 1, BOOLEAN_OPERATION: 0 };
async function kids(n) {
  var ch = n.children || [], out = [], i = 0;                 // Figma: bottom -> top
  while (i < ch.length) {
    var c = ch[i];
    if (c.isMask && c.visible) {                               // a mask clips every sibling above it
      var mp = geometry(c, rel(c)), inner = [], j = i + 1;
      for (; j < ch.length && !ch[j].isMask; j++) { var it = await ser(ch[j]); if (it) inner.push(it); }
      if (inner.length && mp.length) { stats.clips++; out.push({ type: "group", name: c.name, opacity: 100, clipped: true, figmaGroup: true, clip: { paths: mp, evenodd: mp.evenodd }, children: inner.reverse() }); }
      else for (var q = 0; q < inner.length; q++) out.push(inner[q]);
      i = j; continue;
    }
    var o = await ser(c); if (o) out.push(o);
    i++;
  }
  return out.reverse();                                        // clip format: top first
}
async function groupItem(n) {
  var children = await kids(n), M = rel(n);
  if (n.type !== "GROUP") {                                    // frames: background (fills / strokes) under the content
    var fills = visiblePaints(n.fills), outline = alignedStroke(n), stroke = outline ? null : strokeOf(n, M);
    if (outline) children = outline.concat(children);
    if (fills.length || stroke) {
      var hasImg = false; for (var i = 0; i < fills.length; i++) if (fills[i].type === "IMAGE") hasImg = true;
      var bg = null;
      if (hasImg) {
        try { bg = await frameImageFill(n, fills); }
        catch (e) { stats.notes["An image fill on a frame could not be exported"] = 1; }
        if (stroke) {
          var sp = geometry(n, M);
          if (sp.length) { children.unshift({ type: "shape", name: n.name + " Stroke", opacity: 100, paths: sp, style: { stroke: stroke }, bounds: boundsOf(sp) }); stats.paths += sp.length; }
        }
      } else {
        var paths = geometry(n, M), st = { evenodd: false };
        if (fills.length) fillPaint(st, fills[fills.length - 1], n, M);
        if (stroke) st.stroke = stroke;
        if (paths.length && (st.fill || st.stroke)) { bg = { type: "shape", name: n.name + " Background", opacity: 100, paths: paths, style: st, bounds: boundsOf(paths) }; stats.paths += paths.length; }
      }
      if (bg) children.push(bg);
    }
  }
  if (!children.length && !hasBackdrop(n)) return null;
  var o = { type: "group", name: n.name, figmaGroup: true, children: children };
  return common(o, n);
}

async function ser(n) {
  if (!n.visible) return null;
  var t = n.type;
  try {
    if (t === "TEXT") return textItem(n);
    if (CONTAINER[t]) return await groupItem(n);
    if (t === "RECTANGLE" || t === "ELLIPSE" || t === "POLYGON" || t === "STAR" || t === "VECTOR" || t === "LINE" || t === "BOOLEAN_OPERATION") {
      var s = shapeItem(n);
      if (s) return s;
      var f = visiblePaints(n.fills); for (var i = 0; i < f.length; i++) if (f[i].type === "IMAGE" || f[i].type === "VIDEO") return await imageItem(n);
      return null;
    }
    return await imageItem(n, n.name);                          // anything else (stickies, embeds, ...) as an image
  } catch (e) {
    stats.notes["\u201C" + n.name + "\u201D could not be transferred"] = 1;
    return null;
  }
}

// ---------- the artboard: the top frame that holds the selection ----------
// the top frame: the outermost frame under the page; sections only organise frames, they are skipped
function topOf(n) {
  var p = n;
  while (p.parent && p.parent.type !== "PAGE" && p.parent.type !== "DOCUMENT" && p.parent.type !== "SECTION") p = p.parent;
  return p;
}
function artboardFor(sel) {
  var top = topOf(sel[0]), same = true;
  for (var i = 1; i < sel.length; i++) if (topOf(sel[i]) !== top) same = false;
  if (same && top.type !== "GROUP" && "width" in top && top.absoluteTransform) {
    return { name: top.name, w: Math.round(top.width), h: Math.round(top.height), inv: inv(top.absoluteTransform), node: top };
  }
  var b = [1e9, 1e9, -1e9, -1e9];
  for (i = 0; i < sel.length; i++) { var r = sel[i].absoluteBoundingBox; if (!r) continue;
    b[0] = Math.min(b[0], r.x); b[1] = Math.min(b[1], r.y); b[2] = Math.max(b[2], r.x + r.width); b[3] = Math.max(b[3], r.y + r.height); }
  return { name: "Selection", w: Math.max(1, Math.round(b[2] - b[0])), h: Math.max(1, Math.round(b[3] - b[1])), inv: [[1, 0, -b[0]], [0, 1, -b[1]]], node: null };
}

async function send(mode, scope, scale) {
  var t0 = Date.now(), sel = figma.currentPage.selection.slice(0);
  SCALE = +scale || 2; images = [];
  stats = { paths: 0, texts: 0, images: 0, gradients: 0, clips: 0, blurs: 0, shadows: 0, blends: 0, notes: {} };
  if (mode === "image" && scope === "artboard") {
    var top = sel.length ? topOf(sel[0]) : null;
    if (!top) throw new Error("Select a layer inside a frame");
    sel = [top];
  }
  if (!sel.length) throw new Error("Select the layers to send");
  // the stacking order in Figma's layer panel, top first
  var order = sel.slice(0).sort(function (a, b) { return a.parent === b.parent ? b.parent.children.indexOf(b) - b.parent.children.indexOf(a) : 0; });
  AB = artboardFor(order);
  var items = [];
  try {
    for (var i = 0; i < order.length; i++) {
      var it = mode === "image" ? await imageItem(order[i], order[i].name) : await ser(order[i]);
      if (it) items.push(it);
    }
  } finally {
    if (strokeWorkspace) {
      strokeWorkspace.remove();
      strokeWorkspace = null;
    }
  }
  if (!items.length) throw new Error("Nothing to send");
  var notes = []; for (var k in stats.notes) notes.push(k);
  var data = { app: "figma", version: VERSION, mode: mode, doc: figma.root.name, artboard: { name: AB.name, w: AB.w, h: AB.h }, items: items,
               stats: { t0: t0, aiMs: Date.now() - t0, notes: notes } };
  return { data: data, images: images, summary: { items: items.length, paths: stats.paths, texts: stats.texts, images: stats.images, gradients: stats.gradients, clips: stats.clips, notes: notes } };
}

function friendly(e) {
  var m = String(e && e.message || e);
  return /^(Select|Nothing)/.test(m) ? m : "Something went wrong while reading the selection";
}
function selState() { figma.ui.postMessage({ type: "selection", count: figma.currentPage.selection.length }); }
figma.on("selectionchange", selState);
figma.on("currentpagechange", selState);
var pendingPosts = {};
figma.ui.onmessage = async function (msg) {
  if (msg.type === "ready") {
    selState();
    var key;
    try { key = await figma.clientStorage.getAsync("ae-pair-v1"); } catch (e) {}
    figma.ui.postMessage({ type: "saved-key", key: key });
    return;
  }
  if (msg.type === "save-key" && /^[a-f0-9]{32}$/.test(msg.key)) {
    try { await figma.clientStorage.setAsync("ae-pair-v1", msg.key); } catch (e) {}
    return;
  }
  if (msg.type === "abort-post") {
    if (pendingPosts[msg.id]) pendingPosts[msg.id].abort();
    return;
  }
  if (msg.type === "post") {       // fallback when the UI frame can't reach After Effects itself
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller) pendingPosts[msg.id] = controller;
    try {
      if (["/busy", "/idle", "/clip", "/pair", "/pair/status", "/progress"].indexOf(msg.path) === -1) throw new Error("Unknown request");
      var res = await fetch("http://localhost:7789" + msg.path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: msg.body, ...(controller ? { signal: controller.signal } : {}) });
      figma.ui.postMessage({ type: "posted", id: msg.id, ok: true, text: await res.text() });
    } catch (e) { figma.ui.postMessage({ type: "posted", id: msg.id, ok: false }); }
    finally { delete pendingPosts[msg.id]; }
    return;
  }
  if (msg.type !== "send") return;
  try { var r = await send(msg.mode, msg.scope, msg.scale); figma.ui.postMessage({ type: "clip", clip: r.data, images: r.images, summary: r.summary }); }
  catch (e) { figma.ui.postMessage({ type: "error", text: friendly(e) }); }
};
