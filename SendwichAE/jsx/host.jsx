// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Sendwich — After Effects host script (ExtendScript) v0.10. Builds layers from the clip sent by Illustrator.
var VB_AE = VB_AE || (function () {
    function jsonParse(s) {
        var i = 0, n = s.length;
        function err(m) { throw new Error("JSON: " + m + " at " + i); }
        function ws() { while (i < n) { var c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xFEFF) i++; else break; } }
        function str() {
            if (s.charAt(i) !== '"') err("string expected");
            i++;
            var out = [], start = i;
            while (i < n) {
                var c = s.charAt(i);
                if (c === '"') { out.push(s.substring(start, i)); i++; return out.join(""); }
                if (c === "\\") {
                    out.push(s.substring(start, i));
                    var e = s.charAt(i + 1); i += 2;
                    if (e === "n") out.push("\n"); else if (e === "t") out.push("\t"); else if (e === "r") out.push("\r");
                    else if (e === "b") out.push("\b"); else if (e === "f") out.push("\f");
                    else if (e === "u") { out.push(String.fromCharCode(parseInt(s.substr(i, 4), 16))); i += 4; }
                    else out.push(e);
                    start = i;
                } else i++;
            }
            err("unterminated string");
        }
        function num() {
            var st = i;
            while (i < n && "+-0123456789.eE".indexOf(s.charAt(i)) !== -1) i++;
            var v = parseFloat(s.substring(st, i));
            if (isNaN(v)) err("bad number");
            return v;
        }
        function val() {
            ws();
            var c = s.charAt(i);
            if (c === "{") {
                i++; var o = {}; ws();
                if (s.charAt(i) === "}") { i++; return o; }
                while (true) {
                    ws(); var k = str(); ws();
                    if (s.charAt(i) !== ":") err("':' expected"); i++;
                    o[k] = val(); ws();
                    c = s.charAt(i++);
                    if (c === "}") return o;
                    if (c !== ",") err("',' expected");
                }
            }
            if (c === "[") {
                i++; var a = []; ws();
                if (s.charAt(i) === "]") { i++; return a; }
                while (true) {
                    a.push(val()); ws();
                    c = s.charAt(i++);
                    if (c === "]") return a;
                    if (c !== ",") err("',' expected");
                }
            }
            if (c === '"') return str();
            if (s.substr(i, 4) === "true") { i += 4; return true; }
            if (s.substr(i, 5) === "false") { i += 5; return false; }
            if (s.substr(i, 4) === "null") { i += 4; return null; }
            return num();
        }
        return val();
    }
    // fast path: the text is checked to be pure JSON (no code), then evaluated natively; the parser above is the fallback
    function jsonFast(s) {
        var t = s.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                 .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                 .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
        if (/^[\],:{}\s\uFEFF]*$/.test(t)) return eval("(" + s.replace(/^\uFEFF/, "") + ")");
        return jsonParse(s);
    }
    function readText(path) {
        var f = new File(path);
        if (!f.exists) return null;
        f.encoding = "UTF-8";
        if (!f.open("r")) return null;
        var t = f.read(); f.close();
        return t;
    }

    // =====================================================================
    //  BUILDER
    // =====================================================================
    function activeComp() { var c = app.project ? app.project.activeItem : null; return (c && c instanceof CompItem) ? c : null; }

    // bounds over anchors and handles (good enough for centring the anchor point)
    function bounds(it, b) {
        b = b || [1e9, 1e9, -1e9, -1e9];
        var i, j, k;
        if (it.type === "group") { for (i = 0; i < it.children.length; i++) bounds(it.children[i], b); return b; }
        for (i = 0; i < it.paths.length; i++) {
            var pts = it.paths[i].pts;
            for (j = 0; j < pts.length; j++) for (k = 0; k < 3; k++) {
                var p = pts[j][k];
                if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
                if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
            }
        }
        return b;
    }

    function makeShape(pd, ox, oy) {
        var s = new Shape(), v = [], tin = [], tout = [];
        for (var i = 0; i < pd.pts.length; i++) {
            var a = pd.pts[i][0], l = pd.pts[i][1], r = pd.pts[i][2];
            v.push([a[0] - ox, a[1] - oy]);
            tin.push([l[0] - a[0], l[1] - a[1]]);
            tout.push([r[0] - a[0], r[1] - a[1]]);
        }
        s.vertices = v; s.inTangents = tin; s.outTangents = tout; s.closed = !!pd.closed;
        return s;
    }

    // Property references can go stale after addProperty, so containers are always re-resolved
    // from the layer by an index path: [] = root contents, [3, 1] = contents > group 3 > group 1.
    function container(layer, path) {
        var g = layer.property("ADBE Root Vectors Group");
        for (var i = 0; i < path.length; i++) g = g.property(path[i]).property("ADBE Vectors Group");
        return g;
    }
    function addGroup(layer, path, name, opacity) {
        var g = container(layer, path).addProperty("ADBE Vector Group");
        g.name = name;
        if (opacity !== undefined && opacity < 100) g.property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").setValue(opacity);
        return path.concat([g.propertyIndex]);
    }

    var stats;

    // the new property's own reference stays valid while only its values change; defaults are not set again
    function addStroke(layer, path, st) {
        var S = container(layer, path).addProperty("ADBE Vector Graphic - Stroke");
        S.property("ADBE Vector Stroke Color").setValue([st.color[0], st.color[1], st.color[2], 1]);
        S.property("ADBE Vector Stroke Width").setValue(st.width);
        if (st.op !== undefined && st.op < 100) { try { S.property("ADBE Vector Stroke Opacity").setValue(st.op); } catch (e) {} }
        if (st.cap && st.cap !== 1) S.property("ADBE Vector Stroke Line Cap").setValue(st.cap);
        if (st.join && st.join !== 1) S.property("ADBE Vector Stroke Line Join").setValue(st.join);
        if (st.miter && st.miter !== 4) { try { S.property("ADBE Vector Stroke Miter Limit").setValue(st.miter); } catch (e) {} }
        addStrokeDashes(layer, path, S.propertyIndex, st);
    }
    function addStrokeDashes(layer, path, idx, st) {
        if (st.dashes && st.dashes.length) {
            var d = st.dashes.slice(0);
            if (d.length % 2) d = d.concat(d);              // Illustrator repeats odd dash lists
            var names = ["Dash 1", "Gap 1", "Dash 2", "Gap 2", "Dash 3", "Gap 3"];
            for (var i = 0; i < Math.min(d.length, 6); i++) {
                try { container(layer, path).property(idx).property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke " + names[i]).setValue(d[i]); } catch (e) {}
            }
        }
    }
    function addFill(layer, path, color, evenodd, op) {
        var F = container(layer, path).addProperty("ADBE Vector Graphic - Fill");
        F.property("ADBE Vector Fill Color").setValue([color[0], color[1], color[2], 1]);
        if (evenodd) F.property("ADBE Vector Fill Rule").setValue(2);
        if (op !== undefined && op < 100) { try { F.property("ADBE Vector Fill Opacity").setValue(op); } catch (e) {} }
    }

    // blend mode of a Fill / Stroke / Gradient inside a shape layer (values of the "Blend Mode" menu of shape paints)
    var BLEND_SHAPE = { MULTIPLY: 4, SCREEN: 10, OVERLAY: 15, SOFTLIGHT: 16, HARDLIGHT: 17, COLORDODGE: 11, COLORBURN: 5,
                        DARKEN: 3, LIGHTEN: 9, DIFFERENCE: 23, EXCLUSION: 24, HUE: 26, SATURATIONBLEND: 27, COLORBLEND: 28, LUMINOSITY: 29 };
    function setPaintBlend(v, bm) {          // v: the contents of one shape group
        if (!bm) return;
        var val = BLEND_SHAPE[bm];
        if (!val) { warn("blendUnknown"); return; }
        var done = false;
        for (var i = 1; i <= v.numProperties; i++) {
            if (v.property(i).matchName.indexOf("ADBE Vector Graphic - ") !== 0) continue;
            try { v.property(i).property("ADBE Vector Blend Mode").setValue(val); done = true; } catch (e) {}
        }
        if (done) stats.blends = (stats.blends || 0) + 1;
    }
    // effective blend of every leaf inside one layer: its own, or the nearest group's (the layer's own blend is the layer mode)
    function annotateBlend(root) {
        function w(o, inh) {
            if (o.type === "group") { var b = o.blend || inh; for (var i = 0; i < o.children.length; i++) w(o.children[i], b); }
            else o._bm = o.blend || inh || null;
        }
        if (root.type === "group") for (var i = 0; i < root.children.length; i++) w(root.children[i], null);
        else root._bm = null;
    }

    // ---------- parametric shapes: rectangles, rounded rectangles, ellipses, polygons, stars ----------
    var KAPPA = 0.5522847498;
    function vsub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
    function vlen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
    function vdot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
    function deg(r) { return r * 180 / Math.PI; }
    function noHandle(p, tol) { return vlen(vsub(p[1], p[0])) <= tol && vlen(vsub(p[2], p[0])) <= tol; }
    function normAngle(a, w, h) {        // bring a rectangle angle into (-45, 45], swapping width / height if needed
        a = a % 180; if (a > 90) a -= 180; if (a <= -90) a += 180;
        if (a > 45) { a -= 90; var t = w; w = h; h = t; } else if (a <= -45) { a += 90; var t2 = w; w = h; h = t2; }
        if (Math.abs(a) < 0.05) a = 0;
        return { a: a, w: w, h: h };
    }
    function detectPrimitive(pd) {
        if (!pd.closed) return null;
        var pts = pd.pts, n = pts.length, i, b = [1e9, 1e9, -1e9, -1e9];
        for (i = 0; i < n; i++) { var q = pts[i][0]; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }
        var diag = vlen([b[2] - b[0], b[3] - b[1]]); if (diag < 0.5) return null;
        var tol = Math.max(0.02, diag * 0.002), allSharp = true;
        for (i = 0; i < n; i++) if (!noHandle(pts[i], tol)) { allSharp = false; break; }
        var c = [0, 0]; for (i = 0; i < n; i++) { c[0] += pts[i][0][0] / n; c[1] += pts[i][0][1] / n; }
        var r, e0, e1, e2, e3, na;
        // rectangle
        if (n === 4 && allSharp) {
            e0 = vsub(pts[1][0], pts[0][0]); e1 = vsub(pts[2][0], pts[1][0]); e2 = vsub(pts[3][0], pts[2][0]); e3 = vsub(pts[0][0], pts[3][0]);
            if (Math.abs(vlen(e0) - vlen(e2)) <= tol && Math.abs(vlen(e1) - vlen(e3)) <= tol && Math.abs(vdot(e0, e1)) <= tol * (vlen(e0) + vlen(e1))) {
                na = normAngle(deg(Math.atan2(e0[1], e0[0])), vlen(e0), vlen(e1));
                return { k: "rect", c: c, w: na.w, h: na.h, ang: na.a, round: 0 };
            }
        }
        // ellipse: 4 anchors on two perpendicular axes, handles = kappa x radius
        if (n === 4 && !allSharp) {
            var u = vsub(pts[0][0], c), v = vsub(pts[1][0], c);
            if (vlen(vsub(pts[2][0], [c[0] - u[0], c[1] - u[1]])) <= tol && vlen(vsub(pts[3][0], [c[0] - v[0], c[1] - v[1]])) <= tol &&
                Math.abs(vdot(u, v)) <= tol * (vlen(u) + vlen(v))) {
                var ok = true, ax = [vlen(u), vlen(v)];
                for (i = 0; i < 4 && ok; i++) {
                    var other = ax[(i + 1) % 2], hi = vlen(vsub(pts[i][1], pts[i][0])), ho = vlen(vsub(pts[i][2], pts[i][0]));
                    if (Math.abs(hi - KAPPA * other) > tol * 3 || Math.abs(ho - KAPPA * other) > tol * 3) ok = false;
                }
                if (ok) { na = normAngle(deg(Math.atan2(u[1], u[0])), 2 * vlen(u), 2 * vlen(v)); return { k: "ellipse", c: c, w: na.w, h: na.h, ang: na.a }; }
            }
        }
        // rounded rectangle: 8 anchors, straight sides alternate with quarter arcs
        if (n === 8) {
            for (var off = 0; off < 2; off++) {
                var sides = [], arcsOk = true, rr = -1;
                for (i = 0; i < 4; i++) {
                    var a0 = pts[(off + 2 * i) % 8], a1 = pts[(off + 2 * i + 1) % 8], a2 = pts[(off + 2 * i + 2) % 8];
                    // a0 -> a1 straight, a1 -> a2 arc
                    if (vlen(vsub(a0[2], a0[0])) > tol || vlen(vsub(a1[1], a1[0])) > tol) { arcsOk = false; break; }
                    sides.push(vsub(a1[0], a0[0]));
                    var chord = vlen(vsub(a2[0], a1[0])) / Math.SQRT2;
                    if (rr < 0) rr = chord; else if (Math.abs(rr - chord) > tol * 2) { arcsOk = false; break; }
                    if (Math.abs(vlen(vsub(a1[2], a1[0])) - KAPPA * chord) > tol * 3 || Math.abs(vlen(vsub(a2[1], a2[0])) - KAPPA * chord) > tol * 3) { arcsOk = false; break; }
                }
                if (arcsOk && sides.length === 4 && Math.abs(vdot(sides[0], sides[1])) <= tol * (vlen(sides[0]) + vlen(sides[1]) + 1) &&
                    Math.abs(vlen(sides[0]) - vlen(sides[2])) <= tol * 2 && Math.abs(vlen(sides[1]) - vlen(sides[3])) <= tol * 2) {
                    na = normAngle(deg(Math.atan2(sides[0][1], sides[0][0])), vlen(sides[0]) + 2 * rr, vlen(sides[1]) + 2 * rr);
                    return { k: "rect", c: c, w: na.w, h: na.h, ang: na.a, round: rr };
                }
            }
        }
        // polygon / star: sharp corners, equal angle steps
        if (allSharp && n >= 3) {
            var rad = [], ang = [];
            for (i = 0; i < n; i++) { var d = vsub(pts[i][0], c); rad.push(vlen(d)); ang.push(Math.atan2(d[1], d[0])); }
            var stepsEqual = function (step) {
                for (var j = 0; j < n; j++) {
                    var dd = ang[(j + 1) % n] - ang[j];
                    while (dd <= -Math.PI) dd += 2 * Math.PI; while (dd > Math.PI) dd -= 2 * Math.PI;
                    if (Math.abs(Math.abs(dd) - step) > 0.6 * Math.PI / 180) return false;
                }
                return true;
            };
            var rtol = Math.max(tol, rad[0] * 0.01), same = true;
            for (i = 1; i < n; i++) if (Math.abs(rad[i] - rad[0]) > rtol) { same = false; break; }
            if (same && stepsEqual(2 * Math.PI / n))
                return { k: "polygon", c: c, points: n, outer: rad[0], rot: deg(ang[0]) + 90 };
            if (n >= 6 && n % 2 === 0) {
                var R = rad[0], rI = rad[1], alt = R > rI + rtol;
                for (i = 0; i < n && alt; i++) if (Math.abs(rad[i] - (i % 2 ? rI : R)) > rtol) alt = false;
                if (alt && stepsEqual(Math.PI / (n / 2)))
                    return { k: "star", c: c, points: n / 2, outer: R, inner: rI, rot: deg(ang[0]) + 90 };
            }
        }
        return null;
    }
    // the shape group itself (not its contents) at `path`
    function groupProp(layer, path) {
        var c = layer.property("ADBE Root Vectors Group"), g = null;
        for (var i = 0; i < path.length; i++) { g = c.property(path[i]); c = g.property("ADBE Vectors Group"); }
        return g;
    }
    // adds the paths of a shape item; returns the local transform used by the group (for gradient points)
    function addShapePaths(layer, sp, it, ox, oy) {
        var i, xf = { c: [0, 0], ang: 0 }, prim = (it.paths.length === 1) ? detectPrimitive(it.paths[0]) : null;
        if (prim) {
            var cx = prim.c[0] - ox, cy = prim.c[1] - oy, P, idx;
            var PR = function () { return container(layer, sp).property(idx); };
            if (prim.k === "rect" || prim.k === "ellipse") {
                var mn = prim.k === "rect" ? "ADBE Vector Shape - Rect" : "ADBE Vector Shape - Ellipse";
                var pre = prim.k === "rect" ? "ADBE Vector Rect " : "ADBE Vector Ellipse ";
                idx = container(layer, sp).addProperty(mn).propertyIndex;
                PR().property(pre + "Size").setValue([prim.w, prim.h]);
                if (prim.k === "rect" && prim.round) PR().property("ADBE Vector Rect Roundness").setValue(prim.round);
                if (prim.ang) {
                    PR().property(pre + "Position").setValue([0, 0]);
                    var T = groupProp(layer, sp).property("ADBE Vector Transform Group");
                    T.property("ADBE Vector Position").setValue([cx, cy]);
                    groupProp(layer, sp).property("ADBE Vector Transform Group").property("ADBE Vector Rotation").setValue(prim.ang);
                    xf = { c: [cx, cy], ang: prim.ang };
                } else PR().property(pre + "Position").setValue([cx, cy]);
            } else {
                idx = container(layer, sp).addProperty("ADBE Vector Shape - Star").propertyIndex;
                PR().property("ADBE Vector Star Type").setValue(prim.k === "star" ? 1 : 2);
                PR().property("ADBE Vector Star Points").setValue(prim.points);
                PR().property("ADBE Vector Star Position").setValue([cx, cy]);
                PR().property("ADBE Vector Star Rotation").setValue(prim.rot);
                PR().property("ADBE Vector Star Outer Radius").setValue(prim.outer);
                if (prim.k === "star") PR().property("ADBE Vector Star Inner Radius").setValue(prim.inner);
            }
            stats.paths++; stats.prims++;
            return { count: 1, xf: xf };
        }
        for (i = 0; i < it.paths.length; i++) {
            var pi = container(layer, sp).addProperty("ADBE Vector Shape - Group").propertyIndex;
            container(layer, sp).property(pi).property("ADBE Vector Shape").setValue(makeShape(it.paths[i], ox, oy));
            stats.paths++;
        }
        return { count: it.paths.length, xf: xf };
    }

    // adds an item (group or shape) into the container at `path`
    function addItem(layer, path, it, ox, oy) {
        var i;
        if (it.type === "group") {
            var gp = addGroup(layer, path, it.name, it.opacity);
            for (i = 0; i < it.children.length; i++) addItem(layer, gp, it.children[i], ox, oy);
            return;
        }
        var sp = addGroup(layer, path, it.name, it.opacity);
        addShapePaths(layer, sp, it, ox, oy);
        var st = it.style || {};
        if (st.stroke) addStroke(layer, sp, st.stroke);      // stroke above fill, as in Illustrator
        if (st.fill) addFill(layer, sp, st.fill, st.evenodd, st.fillOp);
        if (it._bm) setPaintBlend(container(layer, sp), it._bm);
    }

    function newShapeLayer(comp, name, b, offX, offY) {
        var L = comp.layers.addShape();
        L.name = name;
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        L.property("ADBE Transform Group").property("ADBE Position").setValue([cx + offX, cy + offY]);
        return { layer: L, cx: cx, cy: cy };
    }


    // ---------- classification (same rules as the Illustrator side) ----------
    function pureVector(o) {
        if (o.type === "shape") return true;
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (!pureVector(o.children[i])) return false;
        return true;
    }
    function centerOf(it) {
        var b = it.bounds;
        if (!b && (it.type === "shape" || it.type === "group")) b = bounds(it);
        return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
    }

    var CTX;   // { comp, offX, offY, warn: {}, ... }
    function warn(key) { CTX.warn[key] = (CTX.warn[key] || 0) + 1; }
    function setOpacity(L, op) { if (op !== undefined && op < 100) L.property("ADBE Transform Group").property("ADBE Opacity").setValue(op); }

    // ---------- native shape layer ----------
    function buildShape(it) {
        var nl = newShapeLayer(CTX.comp, it.name, bounds(it), CTX.offX, CTX.offY);
        if (it.type === "group") {
            for (var k = 0; k < it.children.length; k++) addItem(nl.layer, [], it.children[k], nl.cx, nl.cy);
            setOpacity(nl.layer, it.opacity);
        } else addItem(nl.layer, [], it, nl.cx, nl.cy);
        stats.layers++;
        return nl.layer;
    }

    // ---------- gradients ----------
    // Scripts cannot write gradient colours. The extension ships a tiny After Effects project (jsx/gradients.aep)
    // with one shape layer holding 64 gradient fills (GF0..GF63) and 64 gradient strokes (GS0..GS63).
    // For every gradient layer the colours are written straight into a copy of that file (RIFX chunk "Utf8"),
    // the copy is imported, its layer copied into the comp, and the import removed. No setup, no dialogs.
    var TPL_N = 64, tplCache = null, tplN = 0, EXT_DIR = null;
    function tplPath() {
        if (EXT_DIR) return EXT_DIR + "/jsx/gradients.aep";
        try { return new File($.fileName).parent.fsName + "/gradients.aep"; } catch (e) { return ""; }
    }
    function u32(s, i) { return ((s.charCodeAt(i) << 24) >>> 0) + (s.charCodeAt(i + 1) << 16) + (s.charCodeAt(i + 2) << 8) + s.charCodeAt(i + 3); }
    function p32(n) { return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
    function rifxParse(s, start, end) {
        var out = [], i = start;
        while (i + 8 <= end) {
            var id = s.substr(i, 4), size = u32(s, i + 4), body = i + 8;
            if (id === "LIST" || id === "RIFX") out.push({ id: id, type: s.substr(body, 4), kids: rifxParse(s, body + 4, body + size) });
            else out.push({ id: id, data: s.substr(body, size) });
            i = body + size + (size & 1);
        }
        return out;
    }
    function rifxWrite(ch) {
        var body;
        if (ch.kids) { var parts = [ch.type]; for (var i = 0; i < ch.kids.length; i++) parts.push(rifxWrite(ch.kids[i])); body = parts.join(""); }
        else body = ch.data;
        return ch.id + p32(body.length) + body + ((body.length & 1) ? "\u0000" : "");
    }
    function gradChunks(ch, out) {
        out = out || [];
        if (ch.id === "Utf8" && ch.data.indexOf("Gradient Color Data") !== -1) out.push(ch);
        if (ch.kids) for (var i = 0; i < ch.kids.length; i++) gradChunks(ch.kids[i], out);
        return out;
    }
    function readBinary(path) { var f = new File(path); if (!f.exists) return null; f.encoding = "BINARY"; if (!f.open("r")) return null; var d = f.read(); f.close(); return d; }
    function writeBinary(path, data) { var f = new File(path); f.encoding = "BINARY"; if (!f.open("w")) return false; f.write(data); f.close(); return true; }
    function hasTemplate() {
        if (tplCache) return true;
        var d = readBinary(tplPath());
        if (d && d.substr(0, 4) === "RIFX") { tplCache = d; return true; }
        return false;
    }
    function fnum(v) { v = +v; if (!isFinite(v)) v = 0; return String(Math.round(v * 1e6) / 1e6); }
    function stopsXML(kind, rows) {
        var out = ["<prop.pair>", "<key>" + kind + " Stops</key>", "<prop.list>", "<prop.pair>", "<key>Stops List</key>", "<prop.list>"];
        var order = []; for (var i = 0; i < rows.length; i++) order.push(i);
        order.sort(function (a, b) { a = String(a); b = String(b); return a < b ? -1 : (a > b ? 1 : 0); });   // AE keys stops as strings
        for (var k = 0; k < order.length; k++) {
            var j = order[k];
            out.push("<prop.pair>", "<key>Stop-" + j + "</key>", "<prop.list>", "<prop.pair>", "<key>Stops " + kind + "</key>", "<array>", "<array.type><float/></array.type>");
            for (var m = 0; m < rows[j].length; m++) out.push("<float>" + fnum(rows[j][m]) + "</float>");
            out.push("</array>", "</prop.pair>", "</prop.list>", "</prop.pair>");
        }
        out.push("</prop.list>", "</prop.pair>", "<prop.pair>", "<key>Stops Size</key>", "<int type='unsigned' size='32'>" + rows.length + "</int>", "</prop.pair>", "</prop.list>", "</prop.pair>");
        return out;
    }
    function gradientXML(g, version) {
        var st = (g && g.stops && g.stops.length) ? g.stops.slice(0) : [[0, 0.5, 0, 0, 0, 1], [1, 0.5, 1, 1, 1, 1]];
        st.sort(function (a, b) { return a[0] - b[0]; });
        if (st.length === 1) st = [[0, st[0][1], st[0][2], st[0][3], st[0][4], st[0][5]], [1, st[0][1], st[0][2], st[0][3], st[0][4], st[0][5]]];
        var alpha = [], col = [];
        for (var i = 0; i < st.length; i++) {
            var mid = st[i][1]; if (!(mid > 0 && mid < 1)) mid = 0.5;
            var a = +st[i][5]; if (!isFinite(a)) a = 1;
            alpha.push([st[i][0], mid, a]);
            col.push([st[i][0], mid, st[i][2], st[i][3], st[i][4], 1]);
        }
        var lines = ["<?xml version='1.0'?>", "<prop.map version='4'>", "<prop.list>", "<prop.pair>", "<key>Gradient Color Data</key>", "<prop.list>"];
        lines = lines.concat(stopsXML("Alpha", alpha), stopsXML("Color", col));
        lines.push("</prop.list>", "</prop.pair>", "<prop.pair>", "<key>Gradient Colors</key>", "<string>" + (version || "1.0") + "</string>", "</prop.pair>", "</prop.list>", "</prop.map>");
        return lines.join("\n") + "\n";
    }
    function versionOf(data) {
        var a = data.indexOf("<key>Gradient Colors</key>"); if (a < 0) return "1.0";
        var b = data.indexOf("<string>", a), e = data.indexOf("</string>", a);
        return (b >= 0 && e > b) ? data.substring(b + 8, e) : "1.0";
    }
    function matchChunk(chunk, name) {
        return chunk.id === "tdmn" && chunk.data.split("\x00")[0] === name;
    }
    function findPropertyChunk(parent, name) {
        var children = parent.kids || [];
        for (var i = 0; i + 1 < children.length; i++) {
            if (matchChunk(children[i], name) && children[i + 1].kids) return children[i + 1];
        }
        for (i = 0; i < children.length; i++) {
            var found = findPropertyChunk(children[i], name);
            if (found) return found;
        }
        return null;
    }
    function cloneChunk(node) {
        if (!node.kids) return { id: node.id, data: node.data };
        var out = { id: node.id, type: node.type, kids: [] };
        for (var i = 0; i < node.kids.length; i++) out.kids.push(cloneChunk(node.kids[i]));
        return out;
    }
    function slotName(group) {
        var a = group.kids || [];
        for (var i = 0; i < a.length; i++) if (a[i].id === "tdsn") return a[i].data.substr(8).split("\x00")[0];
        return "";
    }
    function contentsChunk(group) {
        var list = group.kids;
        for (var i = 0; i + 1 < list.length; i++) {
            if (matchChunk(list[i], "ADBE Vectors Group")) return list[i + 1];
        }
        throw new Error("Template shape group is missing Contents");
    }
    function setChunkEntries(group, entries) {
        var list = group.kids;
        // Both root and nested Contents begin with tdsb/tdsn and end in ADBE Group End.
        group.kids = list.slice(0, 2).concat(entries, list.slice(-1));
    }
    function gradientTree(root, item) {
        var contents = findPropertyChunk(root, "ADBE Root Vectors Group");
        if (!contents) throw new Error("Gradient template has no root Contents");
        var slots = {}, groupMatch, i;
        for (i = 0; i + 1 < contents.kids.length; i++) {
            if (!matchChunk(contents.kids[i], "ADBE Vector Group")) continue;
            groupMatch = contents.kids[i];
            slots[slotName(contents.kids[i + 1])] = contents.kids[i + 1];
        }
        if (!groupMatch || !slots.GF0 || !slots.GS0 || !slots["GF" + (TPL_N - 1)] || !slots["GS" + (TPL_N - 1)]) {
            throw new Error("Gradient template must have " + TPL_N + " fill and stroke slots");
        }

        function paint(proto, gradient) {
            var source = contentsChunk(proto).kids, pair = [cloneChunk(source[2]), cloneChunk(source[3])];
            var colors = gradChunks(pair[1]);
            if (colors.length !== 1) throw new Error("Invalid template paint");
            colors[0].data = gradientXML(gradient, versionOf(colors[0].data));
            return pair;
        }
        function entries(nodes) {
            var out = [];
            for (var j = 0; j < nodes.length; j++) {
                var node = nodes[j], group = cloneChunk(slots.GF0), children = [];
                if (node.type === "group") children = entries(node.children);
                else {
                    var st = node.style || {};
                    if (st.stroke && st.stroke.grad) children = children.concat(paint(slots.GS0, st.stroke.grad));
                    if (st.fillGrad) children = children.concat(paint(slots.GF0, st.fillGrad));
                }
                setChunkEntries(contentsChunk(group), children);
                out.push(groupMatch, group);
            }
            return out;
        }
        setChunkEntries(contents, entries(item.type === "group" ? item.children : [item]));
    }
    // Bake the source tree into the temp project before AE imports it. No UI grouping command is needed.
    function importTemplate(item) {
        var end = 8 + u32(tplCache, 4), root = rifxParse(tplCache, 0, end)[0], tail = tplCache.substr(end);
        gradientTree(root, item);
        tplN++;
        var dir = new Folder(Folder.temp.fsName + "/VectorBridge"); if (!dir.exists) dir.create();
        var path = dir.fsName + "/grad_" + new Date().getTime() + "_" + tplN + ".aep";
        if (!writeBinary(path, rifxWrite(root) + tail)) throw new Error("cannot write " + path);
        var file = new File(path), folder = null;
        function find(f) {
            for (var k = 1; k <= f.numItems; k++) {
                var x = f.item(k);
                if (x instanceof CompItem && x.name === "VB_TEMPLATE") return x;
                if (x instanceof FolderItem) { var y = find(x); if (y) return y; }
            }
            return null;
        }
        var src = null, info = "", tries;
        for (tries = 0; tries < 2 && !src; tries++) {
            try { folder = app.project.importFile(new ImportOptions(file)); } catch (e) { folder = null; info = "import: " + e.toString(); }
            src = folder instanceof FolderItem ? find(folder) : null;
            if (src) break;
            if (folder) {
                info = (folder instanceof FolderItem) ? "folder \u201C" + folder.name + "\u201D with " + folder.numItems + " item(s)" : "got " + folder.typeName;
                try { folder.remove(); } catch (e) {}
                folder = null;
            }
        }
        CTX.imports.push({ src: src, folder: folder, file: file, keep: !src });
        if (!src) {
            CTX.tplFails = (CTX.tplFails || 0) + 1;
            if (CTX.tplFails >= 2) CTX.tplBroken = true;    // the next layers go straight to solid colours, no more waiting
            throw new Error("gradient template comp not found (" + (info || "empty import") + "; file kept: " + file.fsName + ")");
        }
        return src;
    }
    function copyTemplate(src) {
        src.layer(1).copyToComp(CTX.comp);
        var L = CTX.comp.layer(1);
        if (L.name !== "VB_TEMPLATE") {
            L = null;
            for (var li = 1; li <= CTX.comp.numLayers; li++) if (CTX.comp.layer(li).name === "VB_TEMPLATE") { L = CTX.comp.layer(li); break; }
            if (!L) throw new Error("gradient layer was not copied");
            if (L.index !== 1) L.moveToBeginning();
        }
        try { L.startTime = 0; L.inPoint = 0; L.outPoint = CTX.comp.duration; } catch (e) {}
        L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        return L;
    }
    function dropImport(item) {
        try { item.folder.remove(); } catch (e) {}
        if (!item.keep) try { item.file.remove(); } catch (e2) {}
    }
    function dropImports() {
        while (CTX.imports.length) dropImport(CTX.imports.pop());
    }
    function hasGrad(o) {
        if (o.type === "shape") return !!(o.style && (o.style.fillGrad || (o.style.stroke && o.style.stroke.grad)));
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (hasGrad(o.children[i])) return true;
        return false;
    }
    function findIn(v, matchName) { for (var i = 1; i <= v.numProperties; i++) if (v.property(i).matchName === matchName) return i; return 0; }
    function styleStrokeProp(S, st) {
        try { S().property("ADBE Vector Stroke Width").setValue(st.width); } catch (e) {}
        try { S().property("ADBE Vector Stroke Line Cap").setValue(st.cap || 1); } catch (e) {}
        try { S().property("ADBE Vector Stroke Line Join").setValue(st.join || 1); } catch (e) {}
        if (st.miter) { try { S().property("ADBE Vector Stroke Miter Limit").setValue(st.miter); } catch (e) {} }
    }
    function localPt(p, ox, oy, xf) {
        var x = p[0] - ox - xf.c[0], y = p[1] - oy - xf.c[1];
        if (!xf.ang) return [x, y];
        var a = -xf.ang * Math.PI / 180;
        return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    }
    function setGradProps(G, g, ox, oy, xf) {
        try { G().property("ADBE Vector Grad Type").setValue(g.type === 2 ? 2 : 1); } catch (e) {}
        try { G().property("ADBE Vector Grad Start Pt").setValue(localPt(g.start, ox, oy, xf)); } catch (e) {}
        try { G().property("ADBE Vector Grad End Pt").setValue(localPt(g.end, ox, oy, xf)); } catch (e) {}
    }
    // ---------- text ----------
    var JUST = {
        left: "LEFT_JUSTIFY", center: "CENTER_JUSTIFY", right: "RIGHT_JUSTIFY",
        full: "FULL_JUSTIFY_LASTLINE_FULL", fulll: "FULL_JUSTIFY_LASTLINE_LEFT", fullc: "FULL_JUSTIFY_LASTLINE_CENTER", fullr: "FULL_JUSTIFY_LASTLINE_RIGHT"
    };
    // every property separately: older AE versions reject some of them
    function setp(o, k, v) { try { o[k] = v; return true; } catch (e) { return false; } }
    // a font that failed once is not set again (After Effects can take long on every missing-font attempt)
    // Figma gives family + style; After Effects 24+ can turn that into the PostScript name
    function resolveFont(r) {
        if (!r.family) return;
        var key = r.family + "|" + r.style;
        if (!CTX.famFont) CTX.famFont = {};
        if (!CTX.famFont.hasOwnProperty(key)) {
            var ps = "";
            try { if (app.fonts && typeof app.fonts.getFontsByFamilyNameAndStyleName === "function") { var fl = app.fonts.getFontsByFamilyNameAndStyleName(r.family, r.style); if (fl && fl.length) ps = fl[0].postScriptName; } } catch (e) {}
            CTX.famFont[key] = ps;
        }
        if (CTX.famFont[key]) r.font = CTX.famFont[key];
    }
    function fontOK(name) { return !!name && !(CTX.badFont && CTX.badFont[name]); }
    function fontBad(name) { if (!CTX.badFont) CTX.badFont = {}; CTX.badFont[name] = 1; CTX.missing[name] = 1; }
    function applyRun(d, r) {
        if (fontOK(r.font)) setp(d, "font", r.font);
        if (r.size) setp(d, "fontSize", r.size);
        setp(d, "applyFill", true);
        setp(d, "fillColor", [r.color[0], r.color[1], r.color[2]]);
        setp(d, "applyStroke", false);
        setp(d, "tracking", r.tracking || 0);
        if (r.leading) { setp(d, "autoLeading", false); setp(d, "leading", r.leading); }
    }
    function buildText(it) {
        var t0 = new Date().getTime();
        try { return buildTextRaw(it); } finally { CTX.textMs = (CTX.textMs || 0) + new Date().getTime() - t0; }
    }
    function buildTextRaw(it) {
        var comp = CTX.comp, L;
        L = it.box ? comp.layers.addBoxText([Math.max(1, it.boxW), Math.max(1, it.boxH)], it.text) : comp.layers.addText(it.text);
        L.name = it.name;
        for (var ri = 0; ri < it.runs.length; ri++) resolveFont(it.runs[ri]);
        var tp = L.property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value, r0 = it.runs[0];
        try { d.resetCharStyle(); d.resetParagraphStyle(); } catch (e) {}
        applyRun(d, r0);
        try { d.justification = ParagraphJustification[JUST[it.just] || "LEFT_JUSTIFY"]; } catch (e) {}
        try { tp.setValue(d); }
        catch (e) {   // e.g. font not installed: retry without the font
            d = tp.value; var r1 = {}; for (var kk in r0) r1[kk] = r0[kk]; r1.font = "";
            applyRun(d, r1); tp.setValue(d); fontBad(r0.font);
        }
        // per-character styles (After Effects 24.3+ has TextDocument.characterRange)
        if (it.runs.length > 1) {
            d = tp.value;
            if (typeof d.characterRange === "function") {
                for (var i = 1; i < it.runs.length; i++) {
                    var r = it.runs[i];
                    try {
                        var cr = d.characterRange(r.s, r.s + r.n);
                        if (fontOK(r.font)) setp(cr, "font", r.font);
                        if (r.size) setp(cr, "fontSize", r.size);
                        setp(cr, "fillColor", [r.color[0], r.color[1], r.color[2]]);
                        setp(cr, "tracking", r.tracking || 0);
                        if (r.leading) { setp(cr, "autoLeading", false); setp(cr, "leading", r.leading); }
                    } catch (e) {}
                }
                try { tp.setValue(d); } catch (e) { warn("mixedStyles"); }
            } else warn("mixedStyles");
        }
        // font check
        try { if (fontOK(r0.font) && tp.value.font !== r0.font) fontBad(r0.font); } catch (e) {}
        if (it.gradText) warn("gradText");
        var T = L.property("ADBE Transform Group"), p = it.box ? it.center : it.anchor;
        T.property("ADBE Position").setValue([p[0] + CTX.offX, p[1] + CTX.offY]);
        if (Math.abs(it.rot) > 0.01) T.property("ADBE Rotate Z").setValue(-it.rot);
        if (Math.abs(it.sx - 1) > 0.001 || Math.abs(it.sy - 1) > 0.001) T.property("ADBE Scale").setValue([it.sx * 100, it.sy * 100]);
        setOpacity(L, it.opacity);
        stats.layers++;
        stats.texts++;
        return L;
    }

    // ---------- images ----------
    function assetFolder() {
        var base = app.project.file ? app.project.file.parent.fsName : Folder.myDocuments.fsName;
        var f = new Folder(base + "/Sendwich Assets");
        var legacy = new Folder(base + "/Vector Bridge Assets");
        if (!f.exists && legacy.exists) return legacy;
        if (!f.exists) f.create();
        return f;
    }
    function projectFolder() {
        var legacy = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!(it instanceof FolderItem)) continue;
            if (it.name === "Sendwich") return it;
            if (it.name === "Vector Bridge") legacy = it;
        }
        var folder = legacy || app.project.items.addFolder("Sendwich");
        CTX.assetBin = folder;
        return folder;
    }
    function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, "_").substr(0, 60) || "image"; }
    function buildImage(it) {
        var src = new File(it.file || "");
        if (!it.file || !src.exists) {
            warn("imageMissing");
            CTX.errors.push("image \u201C" + it.name + "\u201D: file not found" + (it.file ? " (" + it.file + ")" : ""));
            return null;
        }
        var dst = new File(assetFolder().fsName + "/" + safeName(it.name) + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000) + ".png");
        if (dst.exists || !src.copy(dst.fsName)) dst = src;
        var asset = { file: dst === src ? null : dst, footage: null };
        CTX.assets.push(asset);
        function importStill(file) {
            var options = new ImportOptions(file);
            options.sequence = false;
            return app.project.importFile(options);
        }
        var foot;
        try { foot = importStill(dst); }
        catch (e) { if (dst === src) throw e; foot = importStill(src); }
        asset.footage = foot;
        try { foot.parentFolder = projectFolder(); } catch (e2) {}

        var comp = CTX.comp, L = comp.layers.add(foot, comp.duration);
        L.name = it.name;
        // Import settings can default a still to one frame. A design raster spans the composition.
        L.startTime = 0;
        L.inPoint = 0;
        L.outPoint = comp.duration;
        var c = centerOf(it), k = 100 / (it.scale > 0 ? it.scale : 1), b = it.bounds;
        var scale = [k, k];
        if (b && b[2] > b[0] && b[3] > b[1] && foot.width > 0 && foot.height > 0) {
            scale = [100 * (b[2] - b[0]) / foot.width, 100 * (b[3] - b[1]) / foot.height];
        }
        var T = L.property("ADBE Transform Group");
        if (foot.width > 0 && foot.height > 0) T.property("ADBE Anchor Point").setValue([foot.width / 2, foot.height / 2]);
        T.property("ADBE Position").setValue([c[0] + CTX.offX, c[1] + CTX.offY]);
        T.property("ADBE Scale").setValue(scale);
        setOpacity(L, it.opacity);
        stats.layers++; stats.images++;
        CTX.imageLayers.push(L.id);
        return L;
    }

    // ---------- mixed groups -> null with parented children ----------
    // ---------- layers: no nulls ----------
    function hasClip(o) {
        if (o.type !== "group") return false;
        if (o.clipped) return true;
        for (var i = 0; i < o.children.length; i++) if (hasClip(o.children[i])) return true;
        return false;
    }
    function leavesOf(o, out) {
        if (o.type === "shape") out.push(o);
        else if (o.type === "group") for (var i = 0; i < o.children.length; i++) leavesOf(o.children[i], out);
        return out;
    }
    function proxy(o, name) { var c = {}; for (var k in o) c[k] = o[k]; c.name = name; return c; }
    function buildNestedLayer(it) {
        annotateBlend(it);
        if (!hasGrad(it)) return [buildShape(it)];
        if (!it._vbTemplate || CTX.forceSolid) {
            warn("gradSolid");
            return [buildShape(it)];
        }

        var b = bounds(it), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        var layer = copyTemplate(it._vbTemplate);
        layer.name = it.name;
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([cx + CTX.offX, cy + CTX.offY]);

        function populate(node, path) {
            var parent = path.slice(0, path.length - 1), index = path[path.length - 1];
            var group = container(layer, parent).property(index);
            group.name = node.name;
            if (node.opacity !== undefined && node.opacity < 100) {
                group.property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").setValue(node.opacity);
            }
            if (node.type === "group") {
                for (var j = 0; j < node.children.length; j++) populate(node.children[j], path.concat([j + 1]));
                return;
            }

            function V() { return container(layer, path); }
            var paints = V().numProperties, result = addShapePaths(layer, path, node, cx, cy), st = node.style || {};
            for (var i = 1; i <= result.count; i++) V().property(paints + i).moveTo(i);
            function gradient(spec, match, opacity, stroke) {
                var index = findIn(V(), match);
                if (!index) throw new Error("Missing gradient property for " + node.name);
                function G() { return V().property(index); }
                setGradProps(G, spec, cx, cy, result.xf);
                if (opacity !== undefined) G().property(stroke ? "ADBE Vector Stroke Opacity" : "ADBE Vector Fill Opacity").setValue(opacity);
                if (stroke) {
                    styleStrokeProp(G, stroke);
                    addStrokeDashes(layer, path, index, stroke);
                } else {
                    G().property("ADBE Vector Fill Rule").setValue(st.evenodd ? 2 : 1);
                }
                stats.gradients++;
            }
            if (st.stroke && st.stroke.grad) gradient(st.stroke.grad, "ADBE Vector Graphic - G-Stroke", st.stroke.op, st.stroke);
            else if (st.stroke) {
                addStroke(layer, path, st.stroke);
                var fillIndex = findIn(V(), "ADBE Vector Graphic - G-Fill");
                if (fillIndex) V().property(V().numProperties).moveTo(fillIndex);
            }
            if (st.fillGrad) gradient(st.fillGrad, "ADBE Vector Graphic - G-Fill", st.fillOp, null);
            else if (st.fill) addFill(layer, path, st.fill, st.evenodd, st.fillOp);
            if (node._bm) setPaintBlend(V(), node._bm);
        }

        if (it.type === "group") {
            for (var i = 0; i < it.children.length; i++) populate(it.children[i], [i + 1]);
            setOpacity(layer, it.opacity);
        } else populate(it, [1]);
        stats.layers++;
        return [layer];
    }

    // ---------- layer plan: the Illustrator hierarchy inside as few shape layers as possible ----------
    // Vectors (with their groups, opacity and blend modes) stay together in one shape layer. Only what a shape layer
    // cannot hold gets a layer of its own: text, images, clipping / opacity masks (content + mask layer), blur and shadow.
    // The vectors on either side of such an item go to two layers with the same group path, so the stacking order is exact.
    function isClipGroup(o) { return o.type === "group" && o.clipped && o.clip && o.clip.paths && o.clip.paths.length; }
    function isBreaker(o) { return o.type === "text" || o.type === "image" || !!o.blur || !!o.shadow || !!o.backdrop || isClipGroup(o); }
    function cloneGroup(g, kids) { var c = {}; for (var k in g) if (g.hasOwnProperty(k)) c[k] = g[k]; c.children = kids; return c; }
    function opOf(o) { return o.opacity === undefined ? 100 : o.opacity; }
    // an item taken out of its groups: the groups' opacity and blend go with it
    function lifted(o, op, bm) { var c = proxy(o, o.name); c.opacity = opOf(o) * op / 100; if (!c.blend && bm) c.blend = bm; return c; }
    // parts, top first: { f: vector-only tree for one shape layer } or { b: item that needs its own layer(s) }
    function splitNode(node, op, bm, top) {
        if (node.type === "shape" && (top || !isBreaker(node))) return [{ f: node }];
        if (node.type !== "group" || (!top && isBreaker(node))) return [{ b: lifted(node, op, bm) }];
        var cop = op * opOf(node) / 100, cbm = top ? null : (node.blend || bm);   // the top item's own blend is set on its layers
        var parts = [], run = [], i, j;
        function flush() { if (run.length) { parts.push({ f: cloneGroup(node, run) }); run = []; } }
        for (i = 0; i < node.children.length; i++) {
            var sub = splitNode(node.children[i], cop, cbm, false);
            for (j = 0; j < sub.length; j++) { if (sub[j].f) run.push(sub[j].f); else { flush(); parts.push(sub[j]); } }
        }
        flush();
        return parts;
    }
    function layerPlan(it) { return splitNode(it, 100, null, true); }
    function buildPlanned(it) {
        var parts = layerPlan(it), out = [];
        for (var i = parts.length - 1; i >= 0; i--) out = out.concat(parts[i].f ? buildFrag(parts[i].f) : buildItem(parts[i].b));   // bottom first
        return out;
    }
    // one shape layer; if the gradient template fails, the same geometry again with solid colours (nothing gets lost)
    function buildFrag(f) {
        var n0 = CTX.comp.numLayers;
        try { return buildNestedLayer(f); }
        catch (e) {
            while (CTX.comp.numLayers > n0) { try { CTX.comp.layer(1).remove(); } catch (e2) { break; } }   // half-built layers
            CTX.errors.push("\u201C" + f.name + "\u201D: " + e.toString() + (e.line ? " (line " + e.line + ")" : "") + ", built with solid colours");
            var was = CTX.forceSolid; CTX.forceSolid = true;
            try { return buildNestedLayer(f); }
            catch (e3) { CTX.errors.push("\u201C" + f.name + "\u201D: " + e3.toString()); return []; }
            finally { CTX.forceSolid = was; }
        }
    }
    function clipContent(it) {   // the masked content only: the group's own effects are applied once, on all its layers
        var c = proxy(it, it.name); c.clipped = false; c.clip = null; c.blur = 0; c.shadow = null; c.blend = null; c.backdrop = null;
        return c;
    }

    // clipping group / opacity mask: the content layer(s) + ONE mask layer right above them, used as Alpha matte by all of them
    function byId(id) {
        try { return app.project.layerByID(id); } catch (e) { return null; }
    }
    function idsOf(layers) {
        var ids = [];
        for (var i = 0; i < layers.length; i++) if (layers[i]) ids.push(layers[i].id);
        return ids;
    }
    function layersOf(ids) {
        var layers = [];
        for (var i = 0; i < ids.length; i++) {
            var layer = byId(ids[i]);
            if (layer) layers.push(layer);
        }
        return layers;
    }
    function buildClipped(it) {
        return layersOf(addClipMatte(it, idsOf(buildItem(clipContent(it)))));
    }
    function addClipMatte(it, ids) {
        var eligible = [], topIndex = 1e9, topId = null;
        for (var i = 0; i < ids.length; i++) {
            var layer = byId(ids[i]);
            if (!layer || layer.guideLayer || layer.hasTrackMatte) continue;
            eligible.push(ids[i]);
            if (layer.index < topIndex) { topIndex = layer.index; topId = ids[i]; }
        }
        if (!eligible.length) return ids;
        var mItem = { type: "shape", name: it.name + " Mask", opacity: 100, paths: it.clip.paths, style: { fill: [1, 1, 1], evenodd: it.clip.evenodd } };
        var nl = newShapeLayer(CTX.comp, mItem.name, bounds(mItem), CTX.offX, CTX.offY);
        addItem(nl.layer, [], mItem, nl.cx, nl.cy);
        var mid = nl.layer.id, top = byId(topId), applied = 0;
        if (typeof top.setTrackMatte === "function") {
            for (i = 0; i < eligible.length; i++) {
                try {
                    byId(eligible[i]).setTrackMatte(byId(mid), TrackMatteType.ALPHA);
                    applied++;
                } catch (e2) { CTX.errors.push(it.name + " mask: " + e2.toString()); }
            }
            byId(mid).enabled = false;
        } else {
            byId(mid).moveBefore(top);
            byId(topId).trackMatteType = TrackMatteType.ALPHA;
            applied++;
        }
        if (!applied) { byId(mid).remove(); return ids; }
        stats.masks++;
        stats.layers++;
        return ids.concat([mid]);
    }

    function hasFxBelow(o) {
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (o.children[i].blur || o.children[i].blend || o.children[i].shadow || o.children[i].backdrop || hasFxBelow(o.children[i])) return true;
        return false;
    }
    function hasClipBelow(o) {
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (hasClip(o.children[i])) return true;
        return false;
    }
    // one shape layer for the whole item: vectors only, no masks or effects inside (they need layers of their own)
    function singleLayer(it) { return pureVector(it) && !hasClipBelow(it) && !hasFxBelow(it); }
    // Illustrator Gaussian Blur -> After Effects Gaussian Blur on the layer(s) of that object
    function addBlur(L, v, strict) {
        try {
            var P = L.property("ADBE Effect Parade"), fx = null;
            try { fx = P.addProperty("ADBE Gaussian Blur 2"); } catch (e) { fx = P.addProperty("ADBE Gaussian Blur"); }   // older AE: legacy blur
            fx.property(1).setValue(v);
            try { fx.property(3).setValue(0); } catch (e) {}           // Repeat Edge Pixels off
            stats.blurs = (stats.blurs || 0) + 1;
        } catch (e) { if (strict) throw e; CTX.errors.push("blur \u201C" + L.name + "\u201D: " + e.toString()); }
    }
    // Figma drop shadow -> After Effects Drop Shadow (direction: 0 = up, clockwise)
    function addShadow(L, sh) {
        try {
            var fx = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            fx.property(1).setValue([sh.color[0], sh.color[1], sh.color[2], 1]);
            var op = fx.property(2); op.setValue((sh.op / 100) * (op.hasMax ? op.maxValue : 100));
            fx.property(3).setValue(Math.atan2(sh.dx, -sh.dy) * 180 / Math.PI);
            fx.property(4).setValue(Math.sqrt(sh.dx * sh.dx + sh.dy * sh.dy));
            fx.property(5).setValue(sh.blur);
            stats.shadows = (stats.shadows || 0) + 1;
        } catch (e) { CTX.errors.push("shadow \u201C" + L.name + "\u201D: " + e.toString()); }
    }
    // Illustrator blend mode -> After Effects layer blending mode
    var BLEND = { MULTIPLY: "MULTIPLY", SCREEN: "SCREEN", OVERLAY: "OVERLAY", SOFTLIGHT: "SOFT_LIGHT", HARDLIGHT: "HARD_LIGHT",
                  COLORDODGE: "COLOR_DODGE", COLORBURN: "COLOR_BURN", DARKEN: "DARKEN", LIGHTEN: "LIGHTEN", DIFFERENCE: "DIFFERENCE",
                  EXCLUSION: "EXCLUSION", HUE: "HUE", SATURATIONBLEND: "SATURATION", COLORBLEND: "COLOR", LUMINOSITY: "LUMINOSITY" };
    function setBlend(L, b) {
        var k = BLEND[b];
        if (!k) { warn("blendUnknown"); return; }
        try { L.blendingMode = BlendingMode[k]; stats.blends = (stats.blends || 0) + 1; } catch (e) { CTX.errors.push("blend \u201C" + L.name + "\u201D: " + e.toString()); }
    }
    function buildItem(it) {
        try {
            var out = buildItemRaw(it) || [];
            return applyItemEffects(it, out);
        }
        catch (e) { CTX.errors.push("“" + it.name + "”: " + e.toString() + (e.line ? " (line " + e.line + ")" : "")); return []; }
    }
    function buildItemRaw(it) {
        if (it.type === "text") return [buildText(it)];
        if (it.type === "image") { var im = buildImage(it); return im ? [im] : []; }
        if (it.type === "group" && it.clipped) {
            if (it.clip && it.clip.paths && it.clip.paths.length) return buildClipped(it);
            warn("clip");
        }
        if (it.type === "group" || it.type === "shape") return buildPlanned(it);
        return [];
    }

    function applyItemEffects(it, layers) {
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (layer.enabled === false || layer.adjustmentLayer) continue;
            if (it.blur) addBlur(layer, it.blur);
            if (it.blend) setBlend(layer, it.blend);
            if (it.shadow) addShadow(layer, it.shadow);
        }
        return layers;
    }

    function buildBackdrop(item) {
        var blur = item.backdrop;
        if (!blur || !blur.paths || !blur.paths.length) return null;
        var comp = CTX.comp, layer, name = item.name + " · Background blur";
        try {
            if (CTX.backdropSource) layer = comp.layers.add(CTX.backdropSource);
            else {
                layer = comp.layers.addSolid([1, 1, 1], "Sendwich · Adjustment", comp.width, comp.height, comp.pixelAspect, comp.duration);
                CTX.backdropSource = layer.source;
                CTX.assets.push({ footage: layer.source, file: null });
                try { layer.source.parentFolder = projectFolder(); } catch (e) {}
            }
            layer.name = name;
            layer.adjustmentLayer = true;
            layer.enabled = false;
            addBlur(layer, blur.radius, true);
            setOpacity(layer, blur.opacity);
            return layer.id;
        } catch (e2) {
            if (layer) try { layer.remove(); } catch (ignored) {}
            CTX.errors.push(name + ": " + e2.toString());
            return null;
        }
    }
    function finishBackdrop(item, adjustmentId, content) {
        if (adjustmentId === null) return content;
        var matteId = null, name = item.name + " · Blur matte";
        try {
            var mItem = { type: "shape", name: name, opacity: 100, paths: item.backdrop.paths,
                          style: { fill: [1, 1, 1], fillOp: 100, evenodd: item.backdrop.evenodd !== false } };
            var nl = newShapeLayer(CTX.comp, name, bounds(mItem), CTX.offX, CTX.offY);
            matteId = nl.layer.id;
            addItem(nl.layer, [], mItem, nl.cx, nl.cy);
            byId(matteId).moveBefore(byId(adjustmentId));
            var adjustment = byId(adjustmentId);
            if (typeof adjustment.setTrackMatte === "function") {
                adjustment.setTrackMatte(byId(matteId), TrackMatteType.ALPHA);
                byId(matteId).enabled = false;
            } else adjustment.trackMatteType = TrackMatteType.ALPHA;
            byId(adjustmentId).enabled = true;
            stats.layers += 2;
            stats.backdrops = (stats.backdrops || 0) + 1;
            return content.concat([matteId, adjustmentId]);
        } catch (e) {
            if (matteId !== null) try { byId(matteId).remove(); } catch (e2) {}
            try { byId(adjustmentId).remove(); } catch (e3) {}
            CTX.errors.push(name + ": " + e.toString());
            return content;
        }
    }
    // Import all template projects before any image footage is staged. Some AE builds
    // remove already-staged footage layers when importing another AEP into the project.
    function prepareItem(job, it) {
        if (it.type !== "group" && it.type !== "shape") return;
        if (isClipGroup(it)) {
            it._vbContent = clipContent(it);
            job.prep.push(function () { prepareItem(job, it._vbContent); });
            return;
        }
        var parts = it._vbPlan = layerPlan(it);
        function queue(part) {
            if (part.b) job.prep.push(function () { prepareItem(job, part.b); });
            else job.prep.push(function () {
                if (CTX.gradMode !== "preset" || CTX.tplBroken || !hasGrad(part.f)) return;
                try { part.f._vbTemplate = importTemplate(part.f); }
                catch (e) { CTX.errors.push("Gradient template for " + part.f.name + ": " + e.toString()); }
            });
        }
        for (var i = parts.length - 1; i >= 0; i--) queue(parts[i]);
    }

    // Keep IDs across host calls. Project edits can invalidate ExtendScript layer handles.
    function queueItem(job, it, append) {
        job.work.push(function () {
            var backdropId = buildBackdrop(it);
            if (it.type !== "group" && it.type !== "shape") {
                append(finishBackdrop(it, backdropId, idsOf(buildItem(it))));
                return;
            }
            var ids = [], clipped = isClipGroup(it);
            function collect(built) { for (var i = 0; i < built.length; i++) ids.push(built[i]); }
            job.work.push(function () {
                try {
                    if (clipped) ids = addClipMatte(it, ids);
                    if (it.blur || it.blend || it.shadow) applyItemEffects(it, layersOf(ids));
                } catch (e) {
                    CTX.errors.push(it.name + ": " + e.toString() + (e.line ? " (line " + e.line + ")" : ""));
                }
                append(finishBackdrop(it, backdropId, ids));
            });
            if (clipped) { queueItem(job, it._vbContent, collect); return; }
            if (it.type === "group" && it.clipped) warn("clip");
            var parts = it._vbPlan;
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].b) queueItem(job, parts[i].b, collect);
                else queueFragment(job, parts[i].f, collect);
            }
        });
    }
    function queueFragment(job, fragment, collect) {
        job.work.push(function () { collect(idsOf(buildFrag(fragment))); });
    }

    var JOB = null, LEASE_MS = 30000;
    function begin(path, id) {
        if (JOB) return "ERR:EX:An After Effects import is already running";
        var raw = readText(path), data;
        if (raw === null) return "ERR:NOCLIP";
        try { data = jsonFast(raw); } catch (e) {
            try { data = jsonParse(raw); } catch (e2) { return "ERR:BAD:" + e2.message; }
        }
        if (!data || !(data.items instanceof Array) || !data.items.length) return "ERR:EMPTY";
        var ab = data.artboard, target = activeComp();
        var w = target ? target.width : Math.min(30000, Math.max(4, Math.round(ab.w)));
        var h = target ? target.height : Math.min(30000, Math.max(4, Math.round(ab.h)));
        var temp = app.project.items.addComp("Sendwich (temp)", w, h, target ? target.pixelAspect : 1,
                                           target ? target.duration : 10, target ? target.frameRate : 30);
        stats = { layers: 0, paths: 0, texts: 0, images: 0, prims: 0, gradients: 0, masks: 0 };
        CTX = { comp: temp, offX: (w - ab.w) / 2, offY: (h - ab.h) / 2,
                warn: {}, missing: {}, errors: [], imports: [], assets: [], imageLayers: [] };
        CTX.gradMode = hasTemplate() ? "preset" : "solid";
        JOB = { id: id, data: data, target: target, temp: temp, w: w, h: h, work: [], prep: [], planned: 0, index: data.items.length - 1,
                started: new Date().getTime(), timer: null };
        JOB.touched = JOB.started;
        armLease(JOB, LEASE_MS);
        return "MORE";
    }

    function armLease(job, delay) {
        if (typeof app.scheduleTask !== "function") return;
        try { job.timer = app.scheduleTask("vb_expire()", Math.max(1, delay), false); } catch (e) {}
    }
    function stopLease(job) {
        if (job.timer === null) return;
        try { app.cancelTask(job.timer); } catch (e) {}
        job.timer = null;
    }
    function expire() {
        if (!JOB) return;
        var remaining = LEASE_MS - (new Date().getTime() - JOB.touched);
        JOB.timer = null;
        if (remaining <= 0) discard(JOB);
        else armLease(JOB, remaining);
    }

    function countImages(items) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].type === "image") CTX.imagesSent = (CTX.imagesSent || 0) + 1;
            if (items[i].children) countImages(items[i].children);
        }
    }

    function discard(job) {
        JOB = null;
        stopLease(job);
        dropImports();
        if (job.temp) try { job.temp.remove(); } catch (e) {}
        for (var i = CTX.assets.length - 1; i >= 0; i--) {
            var a = CTX.assets[i];
            try {
                if (a.footage && a.footage.usedIn.length) continue;
                if (a.footage) a.footage.remove();
                if (a.file) a.file.remove();
            } catch (e2) {}
        }
        if (CTX.assetBin) try { if (!CTX.assetBin.numItems) CTX.assetBin.remove(); } catch (e3) {}
        if (CTX.viewer && job.target) try { job.target.openInViewer(); } catch (e2) {}
    }

    // Commit the staged layers together so one Undo removes the import.
    function commit(job) {
        var temp = job.temp, target = job.target, created = !target, undo = false;
        var i, n = temp.numLayers, mattes = [], parents = [], copied = [];
        if (!n) throw new Error("No layers could be staged");
        for (i = 0; i < CTX.imageLayers.length; i++) {
            if (!byId(CTX.imageLayers[i])) throw new Error("A staged image disappeared before commit");
        }
        for (i = 1; i <= n; i++) {
            var layer = temp.layer(i);
            if (layer.parent) parents.push({ child: i, parent: layer.parent.index });
            try {
                if (layer.hasTrackMatte && layer.trackMatteLayer) mattes.push({ i: i, to: layer.trackMatteLayer.index, type: layer.trackMatteType });
            } catch (e) {}
        }
        try {
            // AE refuses to copy a parented source layer while an undo group is open.
            // Only the temporary layers are detached. Their final parents are set after copying.
            for (i = 0; i < parents.length; i++) temp.layer(parents[i].child).parent = null;
            app.beginUndoGroup("Sendwich: Import"); undo = true;
            if (!target) target = app.project.items.addComp(job.data.artboard.name || job.data.doc || "Artboard", job.w, job.h, 1, 10, 30);
            for (i = n; i >= 1; i--) {
                var before = target.numLayers;
                temp.layer(i).copyToComp(target);
                if (target.numLayers !== before + 1) throw new Error("After Effects did not copy " + temp.layer(i).name);
                copied.push(target.layer(1));
            }
            for (i = 0; i < parents.length; i++) target.layer(parents[i].child).parent = target.layer(parents[i].parent);
            for (i = 0; i < mattes.length; i++) {
                try { target.layer(mattes[i].i).setTrackMatte(target.layer(mattes[i].to), mattes[i].type); target.layer(mattes[i].to).enabled = false; } catch (e2) {}
            }
            var selected = target.selectedLayers;
            for (i = 0; i < selected.length; i++) selected[i].selected = false;
            for (i = 1; i <= n; i++) { try { if (target.layer(i).enabled) target.layer(i).selected = true; } catch (e3) {} }
            temp.remove(); job.temp = null;
        } catch (error) {
            if (created && target) { try { target.remove(); } catch (e5) {} target = null; }
            else for (i = copied.length - 1; i >= 0; i--) try { copied[i].remove(); } catch (e6) {}
            throw error;
        } finally {
            if (undo) app.endUndoGroup();
            if (target && (CTX.viewer || created)) try { target.openInViewer(); } catch (e4) {}
        }
    }

    function step(id) {
        var job = JOB;
        if (!job || job.id !== id) return "ERR:EX:Import is no longer active";
        var items = job.data.items, deadline = new Date().getTime() + 12, operations = 0;
        try {
            if (job.ready) { commit(job); stopLease(job); JOB = null; return result(job); }
            do {
                if (job.prep.length) {
                    job.prep.pop()();
                } else if (job.planned < items.length) {
                    var item = items[job.planned++];
                    countImages([item]);
                    prepareItem(job, item);
                } else if (job.work.length) {
                    job.work.pop()();
                } else if (job.index >= 0) {
                    queueItem(job, items[job.index--], function () {});
                } else if (CTX.imports.length) {
                    dropImport(CTX.imports.pop());
                } else {
                    job.ready = true;
                    break;
                }
            } while (++operations < 8 && new Date().getTime() < deadline);
            job.touched = new Date().getTime();
            return "MORE";
        } catch (e) { discard(job); return "ERR:EX:" + e.toString() + (e.line ? " (line " + e.line + ")" : ""); }
    }

    function cancel(id) {
        if (JOB && JOB.id === id) { discard(JOB); return "CANCELLED"; }
        return "IDLE";
    }

    function summary() {
        var w = CTX.warn, out = [], k, miss = [];
        if (w.gradSolid) out.push(w.gradSolid + " gradient layer(s) imported as solid colour" + (CTX.tplBroken ? ": gradient template could not be imported" : ""));
        if (w.convertFailed) out.push(w.convertFailed + " gradient object(s) could not be converted, built as solid");
        if (w.gradText) out.push(w.gradText + " text gradient(s) imported as solid colour");
        if (w.mixedStyles) out.push("Only the first text style was imported (requires After Effects 24.3+)");
        if (w.clip) out.push(w.clip + " clipping mask(s) skipped because the path is missing");
        if (w.nullOpacity) out.push("Group opacity was not applied to parented layers");
        if (w.imageMissing) out.push(w.imageMissing + " image(s) could not be found");
        if (!w.imageMissing && CTX.imagesSent && stats.images < CTX.imagesSent) out.push("Only " + stats.images + " of " + CTX.imagesSent + " images were imported");
        for (k in CTX.missing) if (CTX.missing.hasOwnProperty(k)) miss.push(k);
        if (miss.length) out.push("missing fonts: " + miss.join(", "));
        if (w.blendUnknown) out.push(w.blendUnknown + " blend mode(s) not available in After Effects");
        for (var i = 0; i < CTX.errors.length; i++) out.push(CTX.errors[i]);
        return out.join(" | ");
    }

    function result(job) {
        var data = job.data, ds = data.stats || {}, now = new Date().getTime();
        if (ds.notes) for (var i = 0; i < ds.notes.length; i++) CTX.errors.push(ds.notes[i]);
        function sec(ms) { return (ms / 1000).toFixed(1) + " s"; }
        var src = data.app === "figma" ? "Figma" : "Illustrator";
        var timing = ds.t0 ? "time " + sec(now - ds.t0) + " (" + src + " " + sec(ds.aiMs || 0) + ", After Effects " + sec(now - job.started) + ")"
                           : "time " + sec(now - job.started);
        return "OK:" + stats.layers + ":" + encodeURIComponent(data.doc || "Illustrator") + ":" + encodeURIComponent(summary()) + ":" + encodeURIComponent(timing) + ":" + stats.masks + ":" + stats.texts;
    }
    function run(path) {
        var id = "legacy", result = begin(path, id);
        while (result === "MORE") result = step(id);
        return result;
    }
    return { run: run, begin: begin, step: step, cancel: cancel, expire: expire, setExt: function (p) { EXT_DIR = String(p).replace(/\\/g, "/"); } };
})();

function vb_root() { return Folder.temp.fsName + "/VectorBridge"; }
function vb_setExt(p) { try { VB_AE.setExt(p); return "OK"; } catch (e) { return "ERR"; } }
function vb_begin(stampId, extensionPath) {
    try { if (extensionPath) VB_AE.setExt(extensionPath); return VB_AE.begin(vb_root() + "/" + stampId + "/clip.json", stampId); }
    catch (e) { return "ERR:EX:" + e.toString(); }
}
function vb_step(stampId) { return VB_AE.step(stampId); }
function vb_cancel(stampId) { return VB_AE.cancel(stampId); }
function vb_expire() { VB_AE.expire(); }
// stampId = folder name written by Illustrator; empty = the latest one
function vb_build(stampId) {
    try {
        if (!stampId) {
            var s = new File(vb_root() + "/stamp.txt");
            if (!s.exists) return "ERR:NOCLIP";
            s.encoding = "UTF-8"; s.open("r"); stampId = s.read(); s.close();
        }
        return VB_AE.run(vb_root() + "/" + stampId + "/clip.json");
    } catch (e) { return "ERR:EX:" + e.toString(); }
}

// ======================================================================================================
// Layer tools: Explode (one shape layer -> a layer per group) and Merge (shape layers -> one layer).
// Gradient colours cannot be read or written by scripts, so nothing is rebuilt here:
//  - Explode duplicates the layer and deletes what the copy does not need (everything stays as it was);
//  - Merge moves groups with After Effects' own Copy / Paste, which keeps gradients.
// ======================================================================================================
var VB_TOOLS = (function () {
    "use strict";
    function isGeom(p) { return p.matchName === "ADBE Vector Group" || p.matchName.indexOf("ADBE Vector Shape") === 0; }
    function isContainer(p) { return p.matchName === "ADBE Root Vectors Group" || p.matchName === "ADBE Vectors Group"; }
    function root(L) { return L.property("ADBE Root Vectors Group"); }
    function contentsOf(g) { return g.property("ADBE Vectors Group"); }
    function geomCount(c) { var n = 0; for (var i = 1; i <= c.numProperties; i++) if (isGeom(c.property(i))) n++; return n; }
    function hasGeom(c) {
        for (var i = 1; i <= c.numProperties; i++) {
            var p = c.property(i);
            if (p.matchName.indexOf("ADBE Vector Shape") === 0) return true;
            if (p.matchName === "ADBE Vector Group" && hasGeom(contentsOf(p))) return true;
        }
        return false;
    }
    // property -> index path from the layer's Contents
    function pathOf(p) {
        var out = [];
        while (p && p.matchName !== "ADBE Root Vectors Group") { out.unshift(p.propertyIndex); p = p.parentProperty; }
        return p ? out : null;
    }
    function resolve(L, path) { var g = root(L); for (var i = 0; i < path.length; i++) g = g.property(path[i]); return g; }
    function cmpPath(a, b) { for (var i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
    function activeComp() { var c = app.project.activeItem; return (c && c instanceof CompItem) ? c : null; }
    function isShape(L) { return L instanceof ShapeLayer; }

    // groups to explode on one layer: the selected groups, or the top groups (one level deeper while there is only one)
    function targetsOf(L) {
        var sel = [], i, j;
        try { sel = L.selectedProperties; } catch (e) {}
        var picked = [];
        for (i = 0; i < sel.length; i++) if (sel[i].matchName === "ADBE Vector Group") { var pp = pathOf(sel[i]); if (pp) picked.push(pp); }
        if (picked.length) {     // a selected group inside another selected group goes with its parent
            var out = [];
            for (i = 0; i < picked.length; i++) {
                var inner = false;
                for (j = 0; j < picked.length; j++) {
                    if (i === j || picked[j].length >= picked[i].length) continue;
                    var same = true; for (var k = 0; k < picked[j].length; k++) if (picked[j][k] !== picked[i][k]) { same = false; break; }
                    if (same) { inner = true; break; }
                }
                if (!inner) out.push(picked[i]);
            }
            return out.sort(cmpPath);
        }
        var c = root(L), base = [];
        for (;;) {
            if (geomCount(c) !== 1) break;
            var only = null;
            for (i = 1; i <= c.numProperties; i++) if (isGeom(c.property(i))) { only = c.property(i); break; }
            if (only.matchName !== "ADBE Vector Group") break;
            base.push(only.propertyIndex, contentsOf(only).propertyIndex);
            c = contentsOf(only);
        }
        var res = [];
        for (i = 1; i <= c.numProperties; i++) if (c.property(i).matchName === "ADBE Vector Group") res.push(base.concat([i]));
        return res;
    }
    // in a copy of the layer: keep only the group at `path` (paints and modifiers of the parent groups stay)
    function keepOnly(L, path) {
        var cur = root(L), d, j;
        for (d = 0; d < path.length; d++) {
            var idx = path[d];
            if (isContainer(cur)) {
                for (j = cur.numProperties; j >= 1; j--) {
                    if (j === idx || !isGeom(cur.property(j))) continue;
                    cur.property(j).remove();
                    if (j < idx) idx--;
                }
            }
            cur = cur.property(idx);
        }
        return cur;
    }
    // anchor point to the centre of the layer's content, without moving the picture (static 2D transforms only)
    function centerAnchor(L, comp) {
        try {
            var T = L.property("ADBE Transform Group"), A = T.property("ADBE Anchor Point"), P = T.property("ADBE Position");
            var S = T.property("ADBE Scale"), R = T.property("ADBE Rotate Z");
            if (L.threeDLayer || P.dimensionsSeparated) return;
            if (A.numKeys || P.numKeys || S.numKeys || R.numKeys || A.expressionEnabled || P.expressionEnabled || S.expressionEnabled || R.expressionEnabled) return;
            var r = L.sourceRectAtTime(comp.time, false);
            if (!(r.width > 0 && r.height > 0)) return;
            var a = A.value, p = P.value, s = S.value, rot = R.value * Math.PI / 180;
            var nx = r.left + r.width / 2, ny = r.top + r.height / 2, dx = (nx - a[0]) * s[0] / 100, dy = (ny - a[1]) * s[1] / 100;
            var c = Math.cos(rot), si = Math.sin(rot);
            A.setValue(a.length > 2 ? [nx, ny, a[2]] : [nx, ny]);
            var np = [p[0] + dx * c - dy * si, p[1] + dx * si + dy * c];
            P.setValue(p.length > 2 ? [np[0], np[1], p[2]] : np);
        } catch (e) {}
    }

    function explode() {
        var comp = activeComp();
        if (!comp) return "ERR:Open a composition first";
        var sel = comp.selectedLayers, layers = [], i, skipped = 0;
        for (i = 0; i < sel.length; i++) { if (isShape(sel[i])) layers.push(sel[i]); else skipped++; }
        if (!layers.length) return "ERR:Select a shape layer";
        var made = [], left = 0, none = 0;
        app.beginUndoGroup("Sendwich: Explode");
        try {
            for (i = 0; i < layers.length; i++) {
                var L = layers[i], tg = targetsOf(L), k;
                if (tg.length < 2 && !(tg.length === 1 && hasGeomOutside(L, tg[0]))) { none++; continue; }
                for (k = 0; k < tg.length; k++) {          // top group first: each copy lands right above the source
                    var D = L.duplicate();
                    var g = keepOnly(D, tg[k]);
                    D.name = g.name;
                    centerAnchor(D, comp);
                    made.push(D);
                }
                var desc = tg.slice(0).sort(cmpPath).reverse();          // the source keeps only what was not exploded
                for (k = 0; k < desc.length; k++) resolve(L, desc[k]).remove();
                if (hasGeom(root(L))) left++; else L.remove();
            }
            for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
            for (i = 0; i < made.length; i++) made[i].selected = true;
        } finally { app.endUndoGroup(); }
        if (!made.length) return "ERR:Nothing to explode: the layer has one group only";
        var notes = [];
        if (left) notes.push(left + " layer(s) kept the shapes outside the groups");
        if (none) notes.push(none + " layer(s) had nothing to explode");
        if (skipped) notes.push(skipped + " non-shape layer(s) skipped");
        return "OK:" + encodeURIComponent("Exploded into " + made.length + " layer" + (made.length === 1 ? "" : "s")) + ":" + encodeURIComponent(notes.join(" | "));
    }
    function hasGeomOutside(L, path) {    // one selected group: worth exploding only if something else stays behind
        var c = root(L);
        return geomCount(c) > 1 || path.length > 1;
    }

    // ---------- merge ----------
    var LBLEND = null;
    function blendValue(mode) {
        if (!LBLEND) {
            LBLEND = [[BlendingMode.NORMAL, 1], [BlendingMode.DARKEN, 3], [BlendingMode.MULTIPLY, 4], [BlendingMode.COLOR_BURN, 5],
                      [BlendingMode.LINEAR_BURN, 6], [BlendingMode.DARKER_COLOR, 7], [BlendingMode.LIGHTEN, 9], [BlendingMode.SCREEN, 10],
                      [BlendingMode.COLOR_DODGE, 11], [BlendingMode.LINEAR_DODGE, 12], [BlendingMode.LIGHTER_COLOR, 13], [BlendingMode.OVERLAY, 15],
                      [BlendingMode.SOFT_LIGHT, 16], [BlendingMode.HARD_LIGHT, 17], [BlendingMode.LINEAR_LIGHT, 18], [BlendingMode.VIVID_LIGHT, 19],
                      [BlendingMode.PIN_LIGHT, 20], [BlendingMode.HARD_MIX, 21], [BlendingMode.DIFFERENCE, 23], [BlendingMode.EXCLUSION, 24],
                      [BlendingMode.HUE, 26], [BlendingMode.SATURATION, 27], [BlendingMode.COLOR, 28], [BlendingMode.LUMINOSITY, 29]];
        }
        for (var i = 0; i < LBLEND.length; i++) if (LBLEND[i][0] === mode) return LBLEND[i][1];
        return 0;
    }
    function paintBlend(c, val) {         // layer blend -> every paint inside that still has Normal
        for (var i = 1; i <= c.numProperties; i++) {
            var p = c.property(i);
            if (p.matchName === "ADBE Vector Group") paintBlend(contentsOf(p), val);
            else if (p.matchName.indexOf("ADBE Vector Graphic - ") === 0) {
                try { var b = p.property("ADBE Vector Blend Mode"); if (b.value === 1) b.setValue(val); } catch (e) {}
            }
        }
    }
    // why a layer cannot be merged without changing how it looks ("" = fine)
    function mergeProblem(L, comp) {
        if (!isShape(L)) return "not a shape layer";
        if (L.threeDLayer) return "3D";
        if (L.parent) return "parented";
        try { if (L.property("ADBE Effect Parade").numProperties) return "effects"; } catch (e) {}
        try { if (L.property("ADBE Mask Parade").numProperties) return "masks"; } catch (e) {}
        try { if (L.hasTrackMatte || L.isTrackMatte) return "track matte"; } catch (e) {}
        try { if (L.timeRemapEnabled) return "time remap"; } catch (e) {}
        try { if (L.property("ADBE Transform Group").property("ADBE Position").dimensionsSeparated) return "separate dimensions"; } catch (e) {}
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).parent === L) return "has children";
        if (!blendValue(L.blendingMode)) return "blend mode";
        return "";
    }
    function dims2(v) { return (v instanceof Array) ? [v[0], v[1]] : v; }
    function ease2(a, n) { var o = []; for (var i = 0; i < n; i++) o.push(a[Math.min(i, a.length - 1)]); return o; }
    // a layer transform property -> the same on a group transform (values, keyframes, eases, expression)
    function copyTr(src, dst, two) {
        var conv = two ? dims2 : function (v) { return v; }, k;
        try {
            if (!src.numKeys) dst.setValue(conv(src.value));
            else {
                for (k = 1; k <= src.numKeys; k++) dst.setValueAtTime(src.keyTime(k), conv(src.keyValue(k)));
                for (k = 1; k <= src.numKeys; k++) {
                    try { dst.setInterpolationTypeAtKey(k, src.keyInInterpolationType(k), src.keyOutInterpolationType(k)); } catch (e) {}
                    try {
                        var n = dst.keyInTemporalEase(k).length;
                        dst.setTemporalEaseAtKey(k, ease2(src.keyInTemporalEase(k), n), ease2(src.keyOutTemporalEase(k), n));
                    } catch (e) {}
                    if (src.isSpatial) try {
                        dst.setSpatialTangentsAtKey(k, conv(src.keyInSpatialTangent(k)), conv(src.keyOutSpatialTangent(k)));
                        dst.setSpatialAutoBezierAtKey(k, src.keySpatialAutoBezier(k));
                        dst.setSpatialContinuousAtKey(k, src.keySpatialContinuous(k));
                    } catch (e) {}
                    try { dst.setRovingAtKey(k, src.keyRoving(k)); } catch (e) {}
                }
            }
        } catch (e) {}
        try { if (src.expression) { dst.expression = src.expression; dst.expressionEnabled = src.expressionEnabled; } } catch (e) {}
    }
    function minKeyTime(g, t) {
        for (var i = 1; i <= g.numProperties; i++) {
            var p = g.property(i);
            if (p.propertyType === PropertyType.PROPERTY) { try { if (p.numKeys && p.keyTime(1) < t) t = p.keyTime(1); } catch (e) {} }
            else t = minKeyTime(p, t);
        }
        return t;
    }
    function cmd(name, dflt) { var id = 0; try { id = app.findMenuCommandId(name); } catch (e) {} return id || dflt; }

    function merge() {
        var comp = activeComp();
        if (!comp) return "ERR:Open a composition first";
        var sel = comp.selectedLayers || [], i, ok = [], skip = [];
        for (i = 0; i < sel.length; i++) { var why = mergeProblem(sel[i], comp); if (why) skip.push("\u201C" + sel[i].name + "\u201D (" + why + ")"); else ok.push(sel[i]); }
        if (ok.length < 2) return "ERR:Select at least two shape layers" + (skip.length ? ": skipped " + skip.join(", ") : "");
        ok.sort(function (a, b) { return a.index - b.index; });          // top first
        var GROUP = cmd("Group Shapes", 0), COPY = cmd("Copy", 19), PASTE = cmd("Paste", 20);
        if (!GROUP) return "ERR:\u201CGroup Shapes\u201D is not available in this After Effects";

        // all the clicking happens in a temporary comp, outside the undo group (executeCommand in an undo group = "Undo group mismatch")
        var temp = app.project.items.addComp("Sendwich (merge)", comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
        var result = null, err = "", t0 = comp.time;
        try {
            temp.openInViewer();
            var M = temp.layers.addShape(); M.name = ok[0].name;
            var MT = M.property("ADBE Transform Group");
            MT.property("ADBE Anchor Point").setValue([0, 0]); MT.property("ADBE Position").setValue([0, 0]);
            var inP = ok[0].inPoint, outP = ok[0].outPoint;
            for (i = ok.length - 1; i >= 0; i--) {         // bottom first: every pasted group goes to the top
                var src = ok[i];
                inP = Math.min(inP, src.inPoint); outP = Math.max(outP, src.outPoint);
                src.copyToComp(temp);
                var C = temp.layer(1), R = root(C), j;
                if (!R.numProperties) { C.remove(); continue; }
                // all the layer's contents into one group
                for (j = 1; j <= temp.numLayers; j++) temp.layer(j).selected = false;
                C.selected = true;
                for (j = 1; j <= R.numProperties; j++) R.property(j).selected = true;
                app.executeCommand(GROUP);
                if (R.numProperties !== 1 || R.property(1).matchName !== "ADBE Vector Group") throw new Error("could not group \u201C" + src.name + "\u201D");
                var G = R.property(1), token = "__vbm" + i;
                G.name = token;
                var GT = G.property("ADBE Vector Transform Group"), LT = C.property("ADBE Transform Group");
                copyTr(LT.property("ADBE Anchor Point"), GT.property("ADBE Vector Anchor"), true);
                copyTr(LT.property("ADBE Position"), GT.property("ADBE Vector Position"), true);
                copyTr(LT.property("ADBE Scale"), GT.property("ADBE Vector Scale"), true);
                copyTr(LT.property("ADBE Rotate Z"), GT.property("ADBE Vector Rotation"), false);
                copyTr(LT.property("ADBE Opacity"), GT.property("ADBE Vector Group Opacity"), false);
                var bv = blendValue(src.blendingMode); if (bv > 1) paintBlend(contentsOf(G), bv);
                // Copy / Paste: pasted keyframes start at the current time, so the time goes to the first keyframe
                temp.time = minKeyTime(G, 1e9) < 1e9 ? minKeyTime(G, 1e9) : 0;
                for (j = 1; j <= temp.numLayers; j++) temp.layer(j).selected = false;
                C.selected = true; G.selected = true;
                app.executeCommand(COPY);
                G.selected = false; C.selected = false;
                M.selected = true;
                for (j = 1; j <= root(M).numProperties; j++) root(M).property(j).selected = false;
                var before = root(M).numProperties;
                app.executeCommand(PASTE);
                var P = null;
                for (j = 1; j <= root(M).numProperties; j++) if (root(M).property(j).name === token) { P = root(M).property(j); break; }
                if (!P || root(M).numProperties !== before + 1) throw new Error("could not paste \u201C" + src.name + "\u201D");
                if (P.propertyIndex !== 1) P.moveTo(1);
                root(M).property(1).name = src.name;
                C.remove();
            }
            try { M.inPoint = inP; M.outPoint = outP; } catch (e) {}
            result = M;
        } catch (e) { err = e.toString(); }

        if (!result) { try { temp.remove(); } catch (e) {} try { comp.openInViewer(); } catch (e) {} return "ERR:Merge failed: " + err; }
        // ---- the one undoable step ----
        app.beginUndoGroup("Sendwich: Merge");
        try {
            var top = ok[0];
            result.copyToComp(comp);
            var N = comp.layer(1);
            if (top.index !== 2) N.moveBefore(top);          // where the top source layer was
            try { N.label = top.label; } catch (e) {}
            for (i = 0; i < ok.length; i++) ok[i].remove();
            for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
            N.selected = true;
        } finally { app.endUndoGroup(); }
        try { temp.remove(); } catch (e) {}
        try { comp.openInViewer(); comp.time = t0; } catch (e) {}
        var notes = [];
        if (skip.length) notes.push("skipped " + skip.join(", "));
        return "OK:" + encodeURIComponent("Merged " + ok.length + " layers") + ":" + encodeURIComponent(notes.join(" | "));
    }
    return { explode: explode, merge: merge };
})();
function vb_explode() { try { return VB_TOOLS.explode(); } catch (e) { return "ERR:" + e.toString() + (e.line ? " (line " + e.line + ")" : ""); } }
function vb_merge() { try { return VB_TOOLS.merge(); } catch (e) { return "ERR:" + e.toString() + (e.line ? " (line " + e.line + ")" : ""); } }
