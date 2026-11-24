// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Sendwich — Illustrator host script (ExtendScript) v0.10
// Serializes the selection to a clip for After Effects. The Illustrator document is never modified:
// images and gradient objects are exported through temporary documents that are closed without saving.

function vb_q(s) {
    s = String(s);
    var out = [], i, c, code;
    for (i = 0; i < s.length; i++) {
        c = s.charAt(i); code = s.charCodeAt(i);
        if (c === '"') out.push('\\"');
        else if (c === "\\") out.push("\\\\");
        else if (c === "\n") out.push("\\n");
        else if (c === "\r") out.push("\\r");
        else if (c === "\t") out.push("\\t");
        else if (code < 32 || code === 0x2028 || code === 0x2029) { var h = code.toString(16); out.push("\\u" + "0000".substr(h.length) + h); }
        else out.push(c);
    }
    return '"' + out.join("") + '"';
}
function vb_J(v) {
    var i, parts;
    if (v === null || v === undefined) return "null";
    if (typeof v === "string") return vb_q(v);
    if (typeof v === "number") return isFinite(v) ? String(Math.round(v * 1000) / 1000) : "0";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v instanceof Array) { parts = []; for (i = 0; i < v.length; i++) parts.push(vb_J(v[i])); return "[" + parts.join(",") + "]"; }
    parts = [];
    for (var k in v) if (v.hasOwnProperty(k) && k.charAt(0) !== "_") parts.push(vb_q(k) + ":" + vb_J(v[k]));
    return "{" + parts.join(",") + "}";
}

// mode: "vector" | "image";  scope (image mode): "selection" | "artboard";  scale: raster scale (1, 2, 4)
function vb_send(mode, scope, scale) {
    // All coordinates in document space: artboard-relative coordinates would differ between
    // the source document and the temporary export documents.
    var oldCS = null;
    try { oldCS = app.coordinateSystem; app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM; } catch (e) {}
    $.global.VB_T0 = new Date().getTime();
    vb_flag("busy " + $.global.VB_T0);      // After Effects shows "waiting for Illustrator" meanwhile
    try { return vb__send(mode || "vector", scope || "selection", +scale || 2); }
    catch (e) { return "ERR:EX:" + encodeURIComponent(e.toString() + (e.line ? " (line " + e.line + ")" : "")); }
    finally { try { if (oldCS !== null) app.coordinateSystem = oldCS; } catch (e) {} vb_flag("idle"); }
}
function vb_flag(v) {
    try {
        var d = new Folder(Folder.temp.fsName + "/VectorBridge"); if (!d.exists) d.create();
        var f = new File(d.fsName + "/busy.txt"); f.encoding = "UTF-8";
        if (f.open("w")) { f.write(v); f.close(); }
    } catch (e) {}
}

function vb__send(mode, scope, scale) {
    var VERSION = "0.34.1";
    if (app.documents.length === 0) return "ERR:NODOC";
    var doc = app.activeDocument, sel = doc.selection;
    var needSel = !(mode === "image" && scope === "artboard");
    if (needSel && (!sel || !sel.length || typeof sel === "string")) return "ERR:NOSEL";

    var abIndex = doc.artboards.getActiveArtboardIndex(), ab = doc.artboards[abIndex], r = ab.artboardRect; // [left, top, right, bottom]
    var AB = { name: ab.name, left: r[0], top: r[1], w: r[2] - r[0], h: r[1] - r[3], rect: r };
    var stats = { paths: 0, texts: 0, images: 0, gradients: 0, clips: 0, skipped: {}, errors: [] };

    // ---------- output folder for this send ----------
    var root = new Folder(Folder.temp.fsName + "/VectorBridge");
    if (!root.exists) root.create();
    vb_cleanup(root);
    var stampId = String(new Date().getTime()) + "-" + Math.floor(Math.random() * 1e6);
    var dir = new Folder(root.fsName + "/" + stampId);
    dir.create();
    var fileN = 0;
    function outPath(ext) { fileN++; return dir.fsName + "/a" + fileN + "." + ext; }

    // Illustrator Y goes up, AE Y goes down: everything relative to the artboard's top-left corner.
    function P(p) { return [p[0] - AB.left, AB.top - p[1]]; }
    function B(b) { return [b[0] - AB.left, AB.top - b[1], b[2] - AB.left, AB.top - b[3]]; }   // [x1, y1, x2, y2]

    // ---------- colour ----------
    function color(c, info) {
        if (!c) return null;
        switch (c.typename) {
            case "RGBColor": return [c.red / 255, c.green / 255, c.blue / 255];
            case "CMYKColor":
                var k = c.black / 100;
                return [(1 - c.cyan / 100) * (1 - k), (1 - c.magenta / 100) * (1 - k), (1 - c.yellow / 100) * (1 - k)];
            case "GrayColor": var g = 1 - c.gray / 100; return [g, g, g];
            case "SpotColor": return color(c.spot.color, info);
            case "GradientColor":
                if (info) info.grad = true;
                try { return color(c.gradient.gradientStops[0].color); } catch (e) { return [0.5, 0.5, 0.5]; }
            case "PatternColor": return [0.5, 0.5, 0.5];
            default: return null;
        }
    }
    // full gradient: type, stops (position, midpoint, r, g, b, opacity), start / end points in AE coordinates
    function gradInfo(gc, it) {
        var g = gc.gradient, i, stops = [];
        var type = String(g.type).indexOf("RADIAL") !== -1 ? 2 : 1;
        for (i = 0; i < g.gradientStops.length; i++) {
            var st = g.gradientStops[i], c = color(st.color) || [0, 0, 0], op = 100, mid = 50;
            try { op = st.opacity; } catch (e) {}
            try { mid = st.midPoint; } catch (e) {}
            stops.push([st.rampPoint / 100, mid / 100, c[0], c[1], c[2], op / 100]);
        }
        var o = gc.origin, a = gc.angle * Math.PI / 180, L = gc.length;
        var s0 = [o[0], o[1]], e0 = [o[0] + L * Math.cos(a), o[1] + L * Math.sin(a)];
        // the gradient matrix may carry later object transforms; use it if it puts the gradient closer to the object
        try {
            var m = gc.matrix;
            var ident = Math.abs(m.mValueA - 1) < 1e-6 && Math.abs(m.mValueD - 1) < 1e-6 && Math.abs(m.mValueB) < 1e-6 && Math.abs(m.mValueC) < 1e-6 && Math.abs(m.mValueTX) < 1e-6 && Math.abs(m.mValueTY) < 1e-6;
            if (!ident) {
                var T = function (p) { return [m.mValueA * p[0] + m.mValueC * p[1] + m.mValueTX, m.mValueB * p[0] + m.mValueD * p[1] + m.mValueTY]; };
                var gb = it.geometricBounds, cx = (gb[0] + gb[2]) / 2, cy = (gb[1] + gb[3]) / 2;
                var mid0 = [(s0[0] + e0[0]) / 2 - cx, (s0[1] + e0[1]) / 2 - cy];
                var s1 = T(s0), e1 = T(e0), mid1 = [(s1[0] + e1[0]) / 2 - cx, (s1[1] + e1[1]) / 2 - cy];
                if (mid1[0] * mid1[0] + mid1[1] * mid1[1] < mid0[0] * mid0[0] + mid0[1] * mid0[1]) { s0 = s1; e0 = e1; }
            }
        } catch (e) {}
        var r = { type: type, stops: stops, start: P(s0), end: P(e0) };
        try { r.hlLen = gc.hiliteLength; r.hlAng = gc.hiliteAngle; } catch (e) {}
        return r;
    }
    function capOf(v) { v = String(v); return v.indexOf("ROUND") !== -1 ? 2 : (v.indexOf("PROJECTING") !== -1 ? 3 : 1); }
    function joinOf(v) { v = String(v); return v.indexOf("ROUND") !== -1 ? 2 : (v.indexOf("BEVEL") !== -1 ? 3 : 1); }

    function style(it) {
        var o = { evenodd: false, grad: false };
        try { o.evenodd = !!it.evenodd; } catch (e) {}
        if (it.filled) {
            var f = color(it.fillColor, o); if (f) o.fill = f;
            if (it.fillColor.typename === "GradientColor") { try { o.fillGrad = gradInfo(it.fillColor, it); } catch (e) {} }
        }
        if (it.stroked && it.strokeWidth > 0) {
            var sc = color(it.strokeColor, o);
            if (sc) {
                o.stroke = { color: sc, width: it.strokeWidth, cap: capOf(it.strokeCap), join: joinOf(it.strokeJoin), miter: it.strokeMiterLimit };
                if (it.strokeColor.typename === "GradientColor") { try { o.stroke.grad = gradInfo(it.strokeColor, it); } catch (e) {} }
                try { if (it.strokeDashes && it.strokeDashes.length) { o.stroke.dashes = []; for (var i = 0; i < it.strokeDashes.length; i++) o.stroke.dashes.push(it.strokeDashes[i]); } } catch (e) {}
            }
        }
        if (o.grad) stats.gradients++;
        return o;
    }

    // ---------- effects ----------
    // Scripts can't read the Appearance panel. A live effect shows up as visibleBounds larger than the art itself;
    // an even growth on all four sides is a blur (a shadow or offset grows one-sided and is ignored).
    // returns the growth in points; converted to a blur radius once the whole selection is read (convertBlurs)
    function blurOf(vb, inner, minGrow) {
        if (!vb || !inner) return 0;
        var l = inner[0] - vb[0], t = vb[1] - inner[1], r = vb[2] - inner[2], b = inner[3] - vb[3];
        var mn = Math.min(l, t, r, b), mx = Math.max(l, t, r, b);
        if (mn > (minGrow || 0.5) && mx - mn <= 0.25 * mn + 0.5) return mn;
        return 0;
    }
    // How much Illustrator grows the bounds per point of Gaussian Blur radius: measured once in Illustrator itself
    // (a test square with a 10 pt blur in a temp document), kept for the session.
    var AE_PER_RADIUS = 2;    // Illustrator radius 2 -> After Effects Blurriness 4
    function blurGrowthPerRadius() {
        if ($.global.VB_BLUR_CAL) return $.global.VB_BLUR_CAL;
        var t = null, c = 0;
        try {
            t = app.documents.add(DocumentColorSpace.RGB, 400, 400);
            var r = t.pathItems.rectangle(-150, 150, 100, 100);
            r.stroked = false; r.filled = true;
            var v0 = r.visibleBounds;
            r.applyEffect('<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="R blur 10 "/></LiveEffect>');
            try { app.redraw(); } catch (e) {}
            var v1 = r.visibleBounds;
            c = Math.min(v0[0] - v1[0], v1[1] - v0[1], v1[2] - v0[2], v0[3] - v1[3]) / 10;
        } catch (e) { c = 0; }
        finally { if (t) closeTemp(t); }
        if (c > 0.2 && c < 20) { $.global.VB_BLUR_CAL = c; return c; }
        return 0;
    }
    function convertBlurs(items) {
        var per = blurGrowthPerRadius();
        if (!per) { per = 2; stats.errors.push("blur strength estimated (Illustrator test failed)"); }
        function walk(o) {
            if (o.blur) o.blur = Math.round(o.blur / per * AE_PER_RADIUS * 10) / 10;
            if (o.children) for (var i = 0; i < o.children.length; i++) walk(o.children[i]);
        }
        for (var i = 0; i < items.length; i++) walk(items[i]);
    }
    function grow(gb, a) { return [gb[0] - a, gb[1] + a, gb[2] + a, gb[3] - a]; }
    function strokeAllow(p) {
        var w = 0, miter = false, lim = 4;
        try { if (p.stroked) w = p.strokeWidth; } catch (e) {}
        try { miter = String(p.strokeJoin).indexOf("MITER") !== -1; lim = p.strokeMiterLimit; } catch (e) {}
        return w ? Math.max(w, miter ? w / 2 * Math.min(lim, 4) : 0) : 0;
    }
    function shapeBlur(it, styleSrc) {
        try { return blurOf(it.visibleBounds, grow(it.geometricBounds, strokeAllow(styleSrc)), 0.5); } catch (e) { return 0; }
    }
    function groupBlur(it) {
        try {
            if (it.clipped) return 0;
            var u = null;
            for (var i = 0; i < it.pageItems.length; i++) {
                var c = it.pageItems[i], h = false;
                try { h = c.hidden; } catch (e) {}
                if (h) continue;
                var v = c.visibleBounds;
                if (!u) u = [v[0], v[1], v[2], v[3]];
                else { u[0] = Math.min(u[0], v[0]); u[1] = Math.max(u[1], v[1]); u[2] = Math.max(u[2], v[2]); u[3] = Math.min(u[3], v[3]); }
            }
            return blurOf(it.visibleBounds, u, 0.5);
        } catch (e) { return 0; }
    }

    function pathData(p) {
        var pts = p.pathPoints, out = [];
        for (var i = 0; i < pts.length; i++) { var pp = pts[i]; out.push([P(pp.anchor), P(pp.leftDirection), P(pp.rightDirection)]); }
        return { closed: p.closed, pts: out };
    }

    function base(it, type, fallbackName) {
        var o = { type: type, name: "" };
        try { o.name = it.name; } catch (e) {}
        if (!o.name) o.name = fallbackName || type;
        try { o.opacity = it.opacity; } catch (e) { o.opacity = 100; }
        try { o.bounds = B(it.geometricBounds); } catch (e) {}
        try { var bm = String(it.blendingMode).replace("BlendModes.", ""); if (/^[A-Z]+$/.test(bm) && bm !== "NORMAL") { o.blend = bm; stats.blends = (stats.blends || 0) + 1; } } catch (e) {}
        o._src = it;
        return o;
    }

    // ---------- temporary documents (the source document is never touched) ----------
    function tempDoc(rect, space) {
        var t = app.documents.add(space || DocumentColorSpace.RGB, Math.max(1, rect[2] - rect[0]), Math.max(1, rect[1] - rect[3]));
        t.artboards[0].artboardRect = rect;
        return t;
    }
    // copy items into the temp document at exactly the same coordinates (topmost first keeps the order)
    // keep = true: no translate (a script move leaves opacity masks behind), the caller corrects coordinates itself
    function dupInto(t, items, keep) {
        for (var i = 0; i < items.length; i++) {
            var sb = items[i].geometricBounds;
            var d = items[i].duplicate(t.layers[0], ElementPlacement.PLACEATEND);
            if (keep) continue;
            var db = d.geometricBounds;
            if (Math.abs(sb[0] - db[0]) > 0.001 || Math.abs(sb[1] - db[1]) > 0.001) d.translate(sb[0] - db[0], sb[1] - db[1]);
        }
    }
    function closeTemp(t) { try { t.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} try { doc.activate(); } catch (e) {} }

    function pngOptions(k) {
        var o = new ExportOptionsPNG24();
        o.antiAliasing = true; o.transparency = true; o.artBoardClipping = true;
        o.horizontalScale = k * 100; o.verticalScale = k * 100;
        return o;
    }
    function unionBounds(items) {
        var b = null;
        for (var i = 0; i < items.length; i++) {
            var v = items[i].visibleBounds;
            if (!b) b = [v[0], v[1], v[2], v[3]];
            else { b[0] = Math.min(b[0], v[0]); b[1] = Math.max(b[1], v[1]); b[2] = Math.max(b[2], v[2]); b[3] = Math.min(b[3], v[3]); }
        }
        return b;
    }
    // rasterize items (or the whole artboard) to PNG
    function exportPNG(items, k) {
        var path = outPath("png"), rect;
        if (!items) {
            doc.exportFile(new File(path), ExportType.PNG24, pngOptions(k));
            return { file: path, bounds: [0, 0, AB.w, AB.h] };
        }
        rect = unionBounds(items);
        var t = tempDoc(rect);
        try { dupInto(t, items); t.exportFile(new File(path), ExportType.PNG24, pngOptions(k)); }
        finally { closeTemp(t); }
        return { file: path, bounds: B(rect) };
    }
    // save a vector block as .ai with the source artboard, so AE places it in the same spot
    function exportAI(item) {
        var path = outPath("ai");
        var t = tempDoc(AB.rect, doc.documentColorSpace);
        try {
            dupInto(t, [item]);
            var so = new IllustratorSaveOptions();
            so.pdfCompatible = true;               // After Effects needs PDF-compatible .ai
            t.saveAs(new File(path), so);
        } finally { closeTemp(t); }
        return path;
    }

    function imageItem(it, name) {
        var o = base(it, "image", name || "Image");
        // the PNG must really be on disk: huge images at 2x / 4x can fail silently, then 1x is tried
        var k = scale, res = null, err = "";
        for (;;) {
            try { res = exportPNG([it], k); } catch (e) { res = null; err = e.toString(); }
            if (res && new File(res.file).exists) break;
            if (k <= 1) break;
            k = 1;
        }
        if (!res || !new File(res.file).exists) stats.errors.push("image \u201C" + o.name + "\u201D could not be exported" + (err ? ": " + err : ""));
        else if (k !== scale) stats.errors.push("image \u201C" + o.name + "\u201D exported at 1x (" + scale + "x failed)");
        o.file = res ? res.file : ""; o.bounds = res ? res.bounds : null; o.scale = k;
        stats.images++;
        return o;
    }

    // ---------- text ----------
    function justOf(v) {
        v = String(v);
        if (v.indexOf("FULLJUSTIFYLASTLINECENTER") !== -1) return "fullc";
        if (v.indexOf("FULLJUSTIFYLASTLINERIGHT") !== -1) return "fullr";
        if (v.indexOf("FULLJUSTIFYLASTLINELEFT") !== -1) return "fulll";
        if (v.indexOf("FULLJUSTIFY") !== -1) return "full";
        if (v.indexOf("CENTER") !== -1) return "center";
        if (v.indexOf("RIGHT") !== -1) return "right";
        return "left";
    }
    // every attribute is read separately: one unsupported attribute must not lose the whole text
    function attempt(fn, dflt) { try { var v = fn(); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } }
    function textItem(tf) {
        var t0 = new Date().getTime();
        try { return textItemRaw(tf); } finally { stats.textMs = (stats.textMs || 0) + new Date().getTime() - t0; }
    }
    function textItemRaw(tf) {
        var kind = String(attempt(function () { return tf.kind; }, "TextType.POINTTEXT"));
        if (kind.indexOf("PATH") !== -1) return imageItem(tf, attempt(function () { return tf.name; }, "") || "Path Text");   // text on a path -> image
        var o = base(tf, "text", "Text");
        o.text = String(tf.contents);
        if (!attempt(function () { return tf.name; }, "")) o.name = o.text.replace(/[\r\n]+/g, " ").substr(0, 40) || "Text";
        o.box = kind.indexOf("AREA") !== -1;
        o.just = justOf(attempt(function () { return tf.paragraphs[0].paragraphAttributes.justification; }, "LEFT"));
        // style runs: consecutive characters with the same look
        var runs = [], cur = null, info = {}, chars = attempt(function () { return tf.characters; }, null);
        var n = chars ? Math.min(attempt(function () { return chars.length; }, 0), 3000) : 0;
        var first = attempt(function () { return tf.textRange.characterAttributes; }, null);
        function readStyle(ca) {
            var st = {};
            st.font = attempt(function () { return ca.textFont.name; }, "");
            st.size = attempt(function () { return ca.size; }, 12);
            st.tracking = attempt(function () { return ca.tracking; }, 0);
            st.leading = attempt(function () { return ca.autoLeading ? 0 : ca.leading; }, 0);
            st.color = attempt(function () { return color(ca.fillColor, info); }, null) || [0, 0, 0];
            return st;
        }
        function addRun(ca, s0, len) {
            var st = readStyle(ca);
            var key = st.font + "|" + st.size + "|" + st.tracking + "|" + st.leading + "|" + st.color.join(",");
            if (cur && cur._key === key) cur.n += len;
            else { cur = { _key: key, s: s0, n: len, font: st.font, size: st.size, tracking: st.tracking, leading: st.leading, color: st.color }; runs.push(cur); }
        }
        for (var i = 0; i < n; i++) {
            var ca = attempt(function () { return chars[i].characterAttributes; }, null);
            if (!ca) continue;
            addRun(ca, i, 1);
        }
        if (!runs.length) {
            var fs = first ? readStyle(first) : { font: "", size: 12, tracking: 0, leading: 0, color: [0, 0, 0] };
            runs.push({ s: 0, n: o.text.length, font: fs.font, size: fs.size, tracking: fs.tracking, leading: fs.leading, color: fs.color });
        }
        o.runs = runs;
        if (info.grad) { o.gradText = true; stats.gradients++; }
        // transform
        var m = attempt(function () { return tf.matrix; }, null);
        if (m) {
            o.rot = Math.atan2(m.mValueB, m.mValueA) * 180 / Math.PI;
            o.sx = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
            o.sy = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
        } else { o.rot = 0; o.sx = 1; o.sy = 1; }
        var gbT = attempt(function () { return tf.geometricBounds; }, [0, 0, 0, 0]);
        if (o.box) {
            var tp = attempt(function () { return tf.textPath; }, null), gb = tp ? attempt(function () { return tp.geometricBounds; }, gbT) : gbT;
            o.boxW = tp ? attempt(function () { return tp.width; }, gb[2] - gb[0]) : gb[2] - gb[0];
            o.boxH = tp ? attempt(function () { return tp.height; }, gb[1] - gb[3]) : gb[1] - gb[3];
            o.center = P([(gb[0] + gb[2]) / 2, (gb[1] + gb[3]) / 2]);
        } else {
            var an = attempt(function () { return tf.anchor; }, null);
            o.anchor = P(an ? an : [gbT[0], gbT[3]]);
        }
        stats.texts++;
        return o;
    }

    // ---------- tree ----------
    // every page item gets an id in DFS order (also hidden / skipped ones): the temporary copy used for the
    // SVG export is named "vb<id>" in the same order, so masks found in the SVG map back to these items
    var vbCount = 0;
    function countDesc(it) { var n = 0; try { if (it.typename === "GroupItem") for (var k = 0; k < it.pageItems.length; k++) n += 1 + countDesc(it.pageItems[k]); } catch (e) {} return n; }
    function ser(it) {
        var id = ++vbCount, hid = false;
        try { hid = it.hidden; } catch (e) {}
        if (hid) { vbCount += countDesc(it); return null; }
        var o = serRaw(it);
        if (o) o._vb = id;
        return o;
    }
    function serRaw(it) {
        var t = it.typename, o, i;
        if (t === "GroupItem") {
            o = base(it, "group", it.clipped ? "<Clip Group>" : "<Group>"); o.clipped = !!it.clipped; o.children = [];
            if (it.clipped) {
                stats.clips++;
                // the clipping path itself (a path or a compound path) -> track matte in AE
                for (i = 0; i < it.pageItems.length; i++) {
                    var ci = it.pageItems[i], cps = null;
                    try {
                        if (ci.typename === "PathItem" && ci.clipping) cps = [ci];
                        else if (ci.typename === "CompoundPathItem" && ci.pathItems.length && ci.pathItems[0].clipping) cps = ci.pathItems;
                    } catch (e) {}
                    if (cps) {
                        o.clip = { paths: [], evenodd: false };
                        for (var q = 0; q < cps.length; q++) o.clip.paths.push(pathData(cps[q]));
                        try { o.clip.evenodd = !!cps[0].evenodd; } catch (e) {}
                        break;
                    }
                }
            }
            for (i = 0; i < it.pageItems.length; i++) { var c = ser(it.pageItems[i]); if (c) o.children.push(c); }
            var gbl = groupBlur(it); if (gbl) { o.blur = gbl; stats.blurs = (stats.blurs || 0) + 1; }
            return o.children.length ? o : null;
        }
        if (t === "CompoundPathItem") {
            o = base(it, "shape", "<Compound Path>"); o.paths = [];
            var pis = it.pathItems;
            try { if (pis.length && pis[0].clipping) return null; } catch (e) {}      // compound clipping path: sent as group.clip
            for (i = 0; i < pis.length; i++) o.paths.push(pathData(pis[i]));
            o.style = pis.length ? style(pis[0]) : {};
            var cbl = pis.length ? shapeBlur(it, pis[0]) : 0; if (cbl) { o.blur = cbl; stats.blurs = (stats.blurs || 0) + 1; }
            stats.paths += pis.length;
            return o.paths.length ? o : null;
        }
        if (t === "PathItem") {
            if (it.clipping) return null;
            if (it.pathPoints.length < 2) return null;
            o = base(it, "shape", "<Path>"); o.paths = [pathData(it)]; o.style = style(it);
            var pbl = shapeBlur(it, it); if (pbl) { o.blur = pbl; stats.blurs = (stats.blurs || 0) + 1; }
            stats.paths++;
            return o;
        }
        if (t === "TextFrame") {
            try { return textItem(it); }
            catch (e) { stats.errors.push("text \u201C" + (it.name || "Text") + "\u201D sent as image: " + e.toString()); return imageItem(it, it.name || "Text"); }
        }
        if (t === "RasterItem") return imageItem(it, "<Image>");
        if (t === "PlacedItem") return imageItem(it, attempt(function () { return decodeURI(it.file.name); }, "") || "<Linked File>");
        if (t === "SymbolItem") return imageItem(it, attempt(function () { return it.symbol.name; }, "") || "<Symbol>");
        if (t === "MeshItem" || t === "PluginItem" || t === "GraphItem") return imageItem(it, "<" + t.replace("Item", "") + ">");
        stats.skipped[t] = (stats.skipped[t] || 0) + 1;
        return null;
    }

    // ---------- opacity masks ----------
    // Scripts can't see opacity masks. The selection is copied into a temp document and exported as SVG only to learn
    // WHICH objects are masked (ids) and WHERE the mask is (the <mask> rectangle). The mask art itself is taken from
    // Illustrator: "Release Opacity Mask" (Transparency panel, played as an action) turns it into a normal object
    // in the temp document, and its real paths are read like any clipping path. The source document is never touched.
    function hexStr(t) { var h = ""; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i).toString(16); h += (c.length < 2 ? "0" : "") + c; } return "[ " + t.length + " " + h + " ]"; }
    var OM_SET = "VectorBridgeOM", OM_ACT = "Release";
    function loadReleaseAction() {
        var aia = ["/version 3", "/name " + hexStr(OM_SET), "/isOpen 1", "/actionCount 1", "/action-1 {",
            "	/name " + hexStr(OM_ACT), "	/keyIndex 0", "	/colorIndex 0", "	/isOpen 1", "	/eventCount 1", "	/event-1 {",
            "		/useRulersIn1stQuadrant 0", "		/internalName (ai_plugin_transparency)", "		/localizedName " + hexStr("Transparency"),
            "		/isOpen 0", "		/isOn 1", "		/hasDialog 0", "		/parameterCount 1", "		/parameter-1 {",
            "			/key 1919710053", "			/showInPalette 4294967295", "			/type (ustring)", "			/value [ 0 ]",
            "		}", "	}", "}"].join("\n");
        try { app.unloadAction(OM_SET, ""); } catch (e) {}
        var f = new File(outPath("aia"));
        f.encoding = "UTF-8"; f.lineFeed = "Unix";
        if (!f.open("w")) return false;
        f.write(aia); f.close();
        try { app.loadAction(f); } catch (e) { try { f.remove(); } catch (e2) {} return false; }
        try { f.remove(); } catch (e) {}
        return true;
    }
    function maskPaths(x, out) {          // every filled path of the released mask art
        var t = x.typename, i;
        if (t === "GroupItem") { for (i = 0; i < x.pageItems.length; i++) maskPaths(x.pageItems[i], out); }
        else if (t === "CompoundPathItem") { for (i = 0; i < x.pathItems.length; i++) out.push(pathData(x.pathItems[i])); if (x.pathItems.length > 1) out.evenodd = true; }
        else if (t === "PathItem" && x.pathPoints.length > 1) out.push(pathData(x));
        return out;
    }
    function readOpacityMasks(list) {
        var t = tempDoc(AB.rect), path = outPath("svg"), c2 = 0, k, dups = {}, svg = {}, released = {};
        function nameDup(x) {
            c2++; dups[c2] = x;
            try { x.name = "vb" + c2; } catch (e) {}
            try { if (x.typename === "GroupItem") for (var q = 0; q < x.pageItems.length; q++) nameDup(x.pageItems[q]); } catch (e) {}
        }
        var uil = null;
        try { uil = app.userInteractionLevel; app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (e) {}
        try {
            dupInto(t, list, true);
            var tops = t.layers[0].pageItems;
            for (k = 0; k < tops.length; k++) nameDup(tops[k]);
            // text is not needed to find masks, and exporting it (font lookup / subsetting, slow with missing fonts) costs the most
            try { for (k = t.textFrames.length - 1; k >= 0; k--) t.textFrames[k].remove(); } catch (e) {}
            var o = new ExportOptionsSVG();
            try { o.fontSubsetting = SVGFontSubsetting.None; } catch (e) {}
            try { o.fontType = SVGFontType.SVGFONT; } catch (e) {}
            try { o.embedRasterImages = false; } catch (e) {}
            try { o.coordinatePrecision = 3; } catch (e) {}
            try { o.documentEncoding = SVGDocumentEncoding.UTF8; } catch (e) {}
            try { o.svgId = SVGIdType.SVGIDREGULAR; } catch (e) {}                       // ids = object names
            try { o.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES; } catch (e) {}
            t.exportFile(new File(path), ExportType.SVG, o);
            var f = new File(path);
            if (f.exists) { f.encoding = "UTF-8"; f.open("r"); svg = vbx_masks(f.read()); f.close(); }
            // release the masks found in the SVG, read the real mask art
            var ids = [], id;
            for (id in (svg.masks || {})) if (svg.masks.hasOwnProperty(id)) ids.push(+id);
            if (ids.length && loadReleaseAction()) {
                for (k = 0; k < ids.length; k++) {
                    var x = dups[ids[k]];
                    if (!x) continue;
                    try {
                        var par = x.parent, had = {}, q, xb = B(x.geometricBounds);
                        for (q = 0; q < par.pageItems.length; q++) had[par.pageItems[q].name] = 1;
                        t.selection = null; x.selected = true;
                        app.doScript(OM_ACT, OM_SET);
                        for (q = 0; q < par.pageItems.length; q++) {
                            var n = par.pageItems[q];
                            if (had[n.name] && /^vb\d+$/.test(n.name)) continue;
                            var mp = maskPaths(n, []);
                            if (mp.length) released[ids[k]] = { paths: mp, evenodd: !!mp.evenodd, ref: xb };
                            break;
                        }
                    } catch (e) { stats.errors.push("release mask: " + e.toString()); }
                }
                try { app.unloadAction(OM_SET, ""); } catch (e) {}
            }
        } finally {
            try { if (uil !== null) app.userInteractionLevel = uil; } catch (e) {}
            closeTemp(t);
        }
        return { masks: svg.masks || {}, refs: svg.refs || {}, rects: svg.rects || {}, grads: svg.grads || {}, ops: svg.ops || {}, released: released };
    }
    // masked groups become clip groups (track matte in AE); masked single objects get wrapped in one
    function applyOpacityMasks(list, items) {
        var r = readOpacityMasks(list), masks = r.masks || {}, any = false, id;
        // radial gradients: centre / bar end from the SVG, moved by the object's own SVG -> artboard shift
        function radial(n) {
            if (n.children) for (var j = 0; j < n.children.length; j++) radial(n.children[j]);
            var g = r.grads[n._vb], ref = r.refs[n._vb], st = n.style;
            if (!g || !ref || !n.bounds || !st) return;
            var dx = n.bounds[0] - ref[0], dy = n.bounds[1] - ref[1];
            function put(gi, geo) { if (gi && gi.type === 2 && geo) { gi.start = [geo.s[0] + dx, geo.s[1] + dy]; gi.end = [geo.e[0] + dx, geo.e[1] + dy]; } }
            put(st.fillGrad, g.fill);
            if (st.stroke) put(st.stroke.grad, g.stroke);
        }
        for (var g0 = 0; g0 < items.length; g0++) radial(items[g0]);
        // fill / stroke opacity: what the SVG shows beyond the object's own opacity (already sent as layer / group opacity)
        function paints(n) {
            if (n.children) for (var j = 0; j < n.children.length; j++) paints(n.children[j]);
            var q = r.ops[n._vb], st = n.style;
            if (!q || !st || n.type !== "shape") return;
            var own = (n.opacity === undefined ? 100 : n.opacity) / 100, extra = own > 0 ? Math.min(1, q.o / own) : 1;
            var f = Math.round(extra * q.f * 1000) / 10, sk = Math.round(extra * q.s * 1000) / 10;
            if (f < 99.9) { st.fillOp = f; stats.paintOps = (stats.paintOps || 0) + 1; }
            if (st.stroke && sk < 99.9) st.stroke.op = sk;
        }
        for (var g1 = 0; g1 < items.length; g1++) paints(items[g1]);
        for (id in masks) if (masks.hasOwnProperty(id)) { any = true; break; }
        if (!any) return;
        // SVG -> artboard: the SVG is only shifted. The shift is measured exactly on the masked object's own shapes
        // (SVG curve bounds vs Illustrator geometricBounds); the whole selection is the fallback.
        function shifts(n, out) {
            if (n.children) for (var j = 0; j < n.children.length; j++) shifts(n.children[j], out);
            var ref = r.refs[n._vb];
            if (ref && n.bounds && n.type === "shape") out.push([n.bounds[0] - ref[0], n.bounds[1] - ref[1]]);
            return out;
        }
        function vote(list) {
            var votes = {}, best = null, bestN = 0;
            for (var q = 0; q < list.length; q++) {
                var key = Math.round(list[q][0] * 20) + "," + Math.round(list[q][1] * 20);
                votes[key] = (votes[key] || 0) + 1;
                if (votes[key] > bestN) { bestN = votes[key]; best = list[q]; }
            }
            return best;
        }
        var all = [];
        for (var v0 = 0; v0 < items.length; v0++) shifts(items[v0], all);
        var globalOff = vote(all) || [0, 0];
        function visit(arr, i) {
            var n = arr[i];
            if (n.children) for (var j = 0; j < n.children.length; j++) visit(n.children, j);
            var mp = masks[n._vb];
            if (!mp) return;
            var off = vote(shifts(n, [])) || globalOff, rel = r.released[n._vb], evenodd = false, a, b, c, pts;
            if (rel) {
                // the real mask art, read in the temp document: same shift as its own object between the two documents
                mp = rel.paths; evenodd = rel.evenodd;
                var dx = n.bounds ? n.bounds[0] - rel.ref[0] : 0, dy = n.bounds ? n.bounds[1] - rel.ref[1] : 0;
                if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)
                    for (a = 0; a < mp.length; a++) for (pts = mp[a].pts, b = 0; b < pts.length; b++) for (c = 0; c < 3; c++) { pts[b][c][0] += dx; pts[b][c][1] += dy; }
            } else {
                for (a = 0; a < mp.length; a++) for (pts = mp[a].pts, b = 0; b < pts.length; b++) for (c = 0; c < 3; c++) { pts[b][c][0] += off[0]; pts[b][c][1] += off[1]; }
                stats.errors.push("opacity mask of \u201C" + n.name + "\u201D taken from SVG (release failed)");
            }
            stats.masks = (stats.masks || 0) + 1;
            var clip = { paths: mp, evenodd: evenodd, kind: "opacity" };
            if (n.type === "group" && !n.clipped) { n.clipped = true; n.clip = clip; }
            else arr[i] = { type: "group", name: n.name, opacity: 100, bounds: n.bounds, clipped: true, clip: clip, children: [n] };
        }
        for (var i = 0; i < items.length; i++) visit(items, i);
    }

    // ---------- Illustrator layers / sublayers -> groups, so After Effects gets the same hierarchy ----------
    // [top layer, sublayer, ...] of a selected item; DOM wrappers are not identical objects, so each level gets a key
    function layerChain(it) {
        var out = [], L = attempt(function () { return it.layer; }, null), key;
        while (L && attempt(function () { return L.typename; }, "") === "Layer") {
            out.unshift(L);
            L = attempt(function () { return L.parent; }, null);
        }
        for (var i = 0, k = ""; i < out.length; i++) {
            k += "/" + attempt(function () { return out[i].zOrderPosition; }, 0) + ":" + attempt(function () { return out[i].name; }, "");
            out[i] = { L: out[i], key: k };
        }
        return out;
    }
    function layerNode(c) {
        var L = c.L, o = { type: "group", name: attempt(function () { return L.name; }, "") || "Layer", opacity: 100, children: [], _key: c.key };
        try { o.opacity = L.opacity; } catch (e) {}
        try { var bm = String(L.blendingMode).replace("BlendModes.", ""); if (/^[A-Z]+$/.test(bm) && bm !== "NORMAL") o.blend = bm; } catch (e) {}
        return o;
    }
    // items are topmost first, so the items of one layer are neighbours
    function wrapLayers(items, chains) {
        var root = [];
        for (var i = 0; i < items.length; i++) {
            var arr = root, ch = chains[i] || [];
            for (var d = 0; d < ch.length; d++) {
                var last = arr.length ? arr[arr.length - 1] : null;
                if (!(last && last._key === ch[d].key)) { last = layerNode(ch[d]); arr.push(last); }
                arr = last.children;
            }
            arr.push(items[i]);
        }
        return root;
    }

    function pureVector(o) {
        if (o.type === "shape") return true;
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (!pureVector(o.children[i])) return false;
        return true;
    }
    function hasGrad(o) {
        if (o.type === "shape") return !!(o.style && o.style.grad);
        if (o.type !== "group") return false;
        for (var i = 0; i < o.children.length; i++) if (hasGrad(o.children[i])) return true;
        return false;
    }
    // vector blocks with gradients also go out as .ai, so After Effects can convert them natively (AE 26+)
    function markBlocks(o) {
        if (pureVector(o)) return;      // gradients are rebuilt natively in AE from the exported stops
        if (o.type === "group") for (var i = 0; i < o.children.length; i++) markBlocks(o.children[i]);
    }

    function skippedText() { var t = []; if (stats.textMs > 300) t.push("text read in " + (stats.textMs / 1000).toFixed(1) + " s"); for (var k in stats.skipped) if (stats.skipped.hasOwnProperty(k)) t.push(stats.skipped[k] + " " + k); return t.concat(stats.errors).join(", "); }

    var items = [], i;
    if (mode === "image") {
        var res, nm;
        if (scope === "artboard") { res = exportPNG(null, scale); nm = AB.name; }
        else {
            var list0 = [];
            for (i = 0; i < sel.length; i++) list0.push(sel[i]);
            res = exportPNG(list0, scale);
            nm = (sel.length === 1 && sel[0].name) ? sel[0].name : "Selection";
        }
        items.push({ type: "image", name: nm, file: res.file, bounds: res.bounds, scale: scale, opacity: 100 });
        stats.images++;
    } else {
        var list = [];
        for (i = 0; i < sel.length; i++) list.push(sel[i]);
        try { list.sort(function (a, b) { return b.absoluteZOrderPosition - a.absoluteZOrderPosition; }); } catch (e) {}
        var chains = [];
        for (i = 0; i < list.length; i++) { var s = ser(list[i]); if (s) { items.push(s); chains.push(layerChain(list[i])); } }
        try { applyOpacityMasks(list, items); } catch (e) { stats.errors.push("opacity masks: " + e.toString()); }
        if (stats.blurs) { try { convertBlurs(items); } catch (e) { stats.errors.push("blur: " + e.toString()); } }
        try { items = wrapLayers(items, chains); } catch (e) { stats.errors.push("layers: " + e.toString()); }
        if (!items.length) return "ERR:NOTHING:" + encodeURIComponent(skippedText());
        for (i = 0; i < items.length; i++) markBlocks(items[i]);
    }
    try { doc.activate(); } catch (e) {}

    stats.t0 = $.global.VB_T0 || 0; stats.aiMs = stats.t0 ? new Date().getTime() - stats.t0 : 0;
    var data = { app: "illustrator", version: VERSION, mode: mode, doc: doc.name, artboard: { name: AB.name, w: AB.w, h: AB.h }, items: items, stats: stats };

    var file = new File(dir.fsName + "/clip.json");
    file.encoding = "UTF-8"; file.lineFeed = "Unix";
    if (!file.open("w")) return "ERR:WRITE:" + encodeURIComponent(file.fsName);
    file.write(vb_J(data)); file.close();

    // the stamp points the After Effects panel to the new clip
    var stamp = new File(root.fsName + "/stamp.txt");
    stamp.encoding = "UTF-8";
    if (stamp.open("w")) { stamp.write(stampId); stamp.close(); }

    return "OK:" + items.length + ":" + stats.paths + ":" + stats.texts + ":" + stats.images + ":" + stats.gradients + ":" + stats.clips + ":" + encodeURIComponent(skippedText());
}

// remove clip folders older than a day
function vb_cleanup(root) {
    try {
        var now = new Date().getTime(), fs = root.getFiles(), i, j;
        for (i = 0; i < fs.length; i++) {
            if (!(fs[i] instanceof Folder)) continue;
            var t = parseInt(fs[i].name, 10);
            if (!t || now - t < 24 * 3600 * 1000) continue;
            var inner = fs[i].getFiles();
            for (j = 0; j < inner.length; j++) inner[j].remove();
            fs[i].remove();
        }
    } catch (e) {}
}

// ======================================================================
//  Opacity masks: Illustrator scripting cannot see them, its SVG export can.
//  Tiny XML / SVG geometry reader (ES3, also runs in Node for tests).
// ======================================================================
function vbx_xml(s) {
    s = s.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "")
         .replace(/<!DOCTYPE[\s\S]*?\]>/, "").replace(/<!DOCTYPE[^>]*>/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    var root = { name: "#root", attrs: {}, kids: [] }, stack = [root], re = /<(\/?)([A-Za-z_][\w:.\-]*)((?:\s+[\w:.\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g, m;
    while ((m = re.exec(s))) {
        if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
        var el = { name: m[2], attrs: vbx_attrs(m[3]), kids: [] };
        stack[stack.length - 1].kids.push(el);
        if (!m[4]) stack.push(el);
    }
    return root;
}
function vbx_attrs(s) {
    var o = {}, re = /([\w:.\-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s))) o[m[1]] = m[2].charAt(0) === '"' ? m[3] : m[4];
    return o;
}
function vbx_nums(s) { var out = [], re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, m; while ((m = re.exec(s || ""))) out.push(parseFloat(m[0])); return out; }
function vbx_mul(m1, m2) {   // m1 after m2
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
}
function vbx_transform(s) {
    var M = [1, 0, 0, 1, 0, 0], re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, m;
    while ((m = re.exec(s || ""))) {
        var n = vbx_nums(m[2]), T;
        if (m[1] === "matrix") T = n;
        else if (m[1] === "translate") T = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
        else if (m[1] === "scale") T = [n[0], 0, 0, n.length > 1 ? n[1] : n[0], 0, 0];
        else if (m[1] === "rotate") {
            var a = (n[0] || 0) * Math.PI / 180, R = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
            T = n.length > 2 ? vbx_mul([1, 0, 0, 1, n[1], n[2]], vbx_mul(R, [1, 0, 0, 1, -n[1], -n[2]])) : R;
        } else if (m[1] === "skewX") T = [1, 0, Math.tan(n[0] * Math.PI / 180), 1, 0, 0];
        else T = [1, Math.tan(n[0] * Math.PI / 180), 0, 1, 0, 0];
        M = vbx_mul(M, T);
    }
    return M;
}
function vbx_apply(M, p) { return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]; }
// path "d" -> [{closed, nodes:[{a,i,o}]}]
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
function vbx_ellipse(cx, cy, rx, ry) {
    var K = 0.5522847498, kx = K * rx, ky = K * ry;
    return { closed: true, nodes: [
        { a: [cx, cy - ry], i: [cx - kx, cy - ry], o: [cx + kx, cy - ry] },
        { a: [cx + rx, cy], i: [cx + rx, cy - ky], o: [cx + rx, cy + ky] },
        { a: [cx, cy + ry], i: [cx + kx, cy + ry], o: [cx - kx, cy + ry] },
        { a: [cx - rx, cy], i: [cx - rx, cy + ky], o: [cx - rx, cy - ky] }] };
}
function vbx_poly(pts, closed) {
    var s = { closed: closed, nodes: [] };
    for (var i = 0; i + 1 < pts.length; i += 2) { var p = [pts[i], pts[i + 1]]; s.nodes.push({ a: p, i: p, o: p }); }
    return s;
}
// all vector shapes of an element tree -> [{closed, pts:[[a,i,o]]}] in output coordinates
function vbx_shapes(el, M, off, out) {
    var A = el.attrs, f = parseFloat, subs = [], i, j;
    var Me = A.transform ? vbx_mul(M, vbx_transform(A.transform)) : M;
    switch (el.name) {
        case "path": subs = vbx_parseD(A.d); break;
        case "rect": var x = f(A.x) || 0, y = f(A.y) || 0, w = f(A.width) || 0, h = f(A.height) || 0;
            subs = [vbx_poly([x, y, x + w, y, x + w, y + h, x, y + h], true)]; break;
        case "circle": subs = [vbx_ellipse(f(A.cx) || 0, f(A.cy) || 0, f(A.r) || 0, f(A.r) || 0)]; break;
        case "ellipse": subs = [vbx_ellipse(f(A.cx) || 0, f(A.cy) || 0, f(A.rx) || 0, f(A.ry) || 0)]; break;
        case "polygon": subs = [vbx_poly(vbx_nums(A.points), true)]; break;
        case "polyline": subs = [vbx_poly(vbx_nums(A.points), false)]; break;
        default:
            for (i = 0; i < el.kids.length; i++) vbx_shapes(el.kids[i], Me, off, out);
            return out;
    }
    for (i = 0; i < subs.length; i++) {
        if (subs[i].nodes.length < 2) continue;
        var pts = [];
        for (j = 0; j < subs[i].nodes.length; j++) {
            var n = subs[i].nodes[j], a = vbx_apply(Me, n.a), ii = vbx_apply(Me, n.i), o = vbx_apply(Me, n.o);
            pts.push([[a[0] + off[0], a[1] + off[1]], [ii[0] + off[0], ii[1] + off[1]], [o[0] + off[0], o[1] + off[1]]]);
        }
        out.push({ closed: subs[i].closed, pts: pts, fill: vbx_fill(el) });
    }
    return out;
}
function vbx_fill(el) {
    var A = el.attrs, m = /fill\s*:\s*(#[0-9a-fA-F]{3,6})/.exec(A.style || ""), f = m ? m[1] : (A.fill || "");
    if (!/^#[0-9a-fA-F]{3,6}$/.test(f)) return null;
    if (f.length === 4) f = "#" + f.charAt(1) + f.charAt(1) + f.charAt(2) + f.charAt(2) + f.charAt(3) + f.charAt(3);
    return [parseInt(f.substr(1, 2), 16) / 255, parseInt(f.substr(3, 2), 16) / 255, parseInt(f.substr(5, 2), 16) / 255];
}
// exact bounds of bezier paths (curve extrema, not just anchors)
function vbx_bbox(paths) {
    var b = [1e9, 1e9, -1e9, -1e9];
    function add(x, y) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    function seg(p0, p1, p2, p3) {
        add(p0[0], p0[1]); add(p3[0], p3[1]);
        for (var ax = 0; ax < 2; ax++) {
            var a = -p0[ax] + 3 * p1[ax] - 3 * p2[ax] + p3[ax], bb = 2 * (p0[ax] - 2 * p1[ax] + p2[ax]), c = p1[ax] - p0[ax], ts = [];
            if (Math.abs(a) < 1e-12) { if (Math.abs(bb) > 1e-12) ts.push(-c / bb); }
            else { var disc = bb * bb - 4 * a * c; if (disc >= 0) { var r = Math.sqrt(disc); ts.push((-bb + r) / (2 * a), (-bb - r) / (2 * a)); } }
            for (var k = 0; k < ts.length; k++) {
                var t = ts[k]; if (t <= 0 || t >= 1) continue;
                var u = 1 - t;
                add(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
            }
        }
    }
    for (var i = 0; i < paths.length; i++) {
        var pts = paths[i].pts, n = pts.length;
        for (var j = 0; j < n; j++) {
            if (j === n - 1 && !paths[i].closed) { add(pts[j][0][0], pts[j][0][1]); break; }
            var q = pts[(j + 1) % n];
            seg(pts[j][0], pts[j][2], q[1], q[0]);
        }
    }
    return b;
}
// SVG text -> { masks: { vbId: [paths] }, refs: { vbId: [left, top] of the object's anchors } } in SVG coordinates
function vbx_masks(text) {
    var root = vbx_xml(text), byId = {}, masked = [], refs = {}, res = {}, rects = {}, grads = {}, ops = {};
    var LEAF = { path: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1 };
    var nRefs = 0;
    function walk(el, M, inMask) {
        var A = el.attrs, Me = A.transform ? vbx_mul(M, vbx_transform(A.transform)) : M;
        if (A.id) byId[A.id] = el;
        var vbm = A.id ? /^vb(\d+)/.exec(A.id) : null;
        var sm = /mask\s*:\s*(url\([^)]*\))/.exec(A.style || ""), mref = A.mask || (sm ? sm[1] : "");     // attribute or CSS style
        if (mref && el.name !== "mask") { masked.push({ el: el, M: Me, vb: vbm ? +vbm[1] : 0, ref: mref }); inMask = true; }
        // one Illustrator object = a shape element with its id, or (complex Appearance, e.g. files from Figma) a <g> with
        // that id wrapping the shape(s) that actually paint it, without ids of other objects inside
        var wrap = vbm && el.name === "g" && !el.vbDesc;
        if (vbm && (LEAF[el.name] || wrap)) {
            var id = +vbm[1], need = inMask || nRefs < 40;     // the object's position is only needed where it is used
            var pl = LEAF[el.name] ? { el: el, M: A.transform ? Me : M, o: 1 } : paintLeaf(el, M, 1);
            if (pl) {
                var LA = pl.el.attrs, op = paintOp(A, "opacity") * (pl.el === el ? 1 : pl.o * paintOp(LA, "opacity"));
                var fo = paintOp(LA, "fill-opacity"), so = paintOp(LA, "stroke-opacity");
                if (op < 1 || fo < 1 || so < 1) { ops[id] = { o: op, f: fo, s: so }; need = true; }
                var gf = gradGeo(LA.fill, LA.style, "fill", pl.M), gs = gradGeo(LA.stroke, LA.style, "stroke", pl.M);
                if (gf || gs) { grads[id] = { fill: gf, stroke: gs }; need = true; }
            }
            if (need) {
                var sh = vbx_shapes(el, M, [0, 0], []);
                if (sh.length) { var eb = vbx_bbox(sh); refs[id] = [eb[0], eb[1]]; nRefs++; }     // exact curve bounds = Illustrator geometricBounds
            }
        }
        for (var i = 0; i < el.kids.length; i++) if (el.name !== "mask" && el.name !== "clipPath" && el.name !== "defs") walk(el.kids[i], Me, inMask);
    }
    // one pass: does an element contain other objects' ids below it (instead of searching again for every <g>)
    function markVb(el) {
        var any = false;
        for (var i = 0; i < el.kids.length; i++) { var k = el.kids[i]; if (markVb(k) || (k.attrs.id && /^vb\d/.test(k.attrs.id))) any = true; }
        el.vbDesc = any;
        return any;
    }
    // topmost shape inside a wrapper that has a fill (the visible paint), with its matrix and the opacity of the <g>s between
    function paintLeaf(el, M, o) {
        var best = null;
        for (var i = 0; i < el.kids.length; i++) {
            var k = el.kids[i], KA = k.attrs;
            if (k.name === "defs" || k.name === "mask" || k.name === "clipPath") continue;
            var Mk = KA.transform ? vbx_mul(M, vbx_transform(KA.transform)) : M;
            if (LEAF[k.name]) {
                var fill = KA.fill || ((/fill\s*:\s*([^;]+)/.exec(KA.style || "") || [])[1]) || "";
                if (!/^\s*none/.test(fill)) best = { el: k, M: Mk, o: o };
            } else if (k.name === "g") {
                var r = paintLeaf(k, Mk, o * paintOp(KA, "opacity"));
                if (r) best = r;
            }
        }
        return best;
    }
    function indexAll(el) { if (el.attrs.id) byId[el.attrs.id] = el; for (var i = 0; i < el.kids.length; i++) indexAll(el.kids[i]); }
    function paintOp(A, key) {
        var m = new RegExp("(^|;)\\s*" + key + "\\s*:\\s*([\\d.]+)").exec(A.style || ""), v = m ? m[2] : A[key];
        v = parseFloat(v);
        return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
    }
    // radial gradient geometry exactly as Illustrator draws it: centre and the end of the gradient bar (its x axis)
    function gradGeo(attr, style, key, M) {
        var m = new RegExp(key + "\\s*:\\s*url\\(\\s*#([^)\\s]+)\\s*\\)").exec(style || "");
        var ref = m ? m[1] : (/url\(\s*#([^)\s]+)\s*\)/.exec(attr || "") || [])[1];
        var g = ref ? byId[ref] : null;
        if (!g || g.name !== "radialGradient") return null;
        var a = g.attrs, f = parseFloat, cx = f(a.cx), cy = f(a.cy), r = f(a.r);
        if (isNaN(cx) || isNaN(cy) || !(r > 0) || (a.gradientUnits && a.gradientUnits !== "userSpaceOnUse")) return null;
        var G = a.gradientTransform ? vbx_mul(M, vbx_transform(a.gradientTransform)) : M;
        return { s: vbx_apply(G, [cx, cy]), e: vbx_apply(G, [cx + r, cy]) };
    }
    indexAll(root);
    markVb(root);
    walk(root, [1, 0, 0, 1, 0, 0], false);
    function firstVb(el) {
        var m = el.attrs.id ? /^vb(\d+)/.exec(el.attrs.id) : null;
        if (m) return +m[1];
        for (var i = 0; i < el.kids.length; i++) { var r = firstVb(el.kids[i]); if (r) return r; }
        return 0;
    }
    for (var i = 0; i < masked.length; i++) {
        var ref = /url\(\s*['"]?#([^'")\s]+)/.exec(masked[i].ref);
        var mk = ref ? byId[ref[1]] : null;
        if (!mk) continue;
        var id = masked[i].vb || firstVb(masked[i].el);
        if (!id) continue;
        var paths = vbx_shapes(mk, masked[i].M, [0, 0], []);
        if (!paths.length) continue;
        res[id] = paths;
    }
    return { masks: res, refs: refs, rects: rects, grads: grads, ops: ops };
}
