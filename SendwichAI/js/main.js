// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
(function () {
  "use strict";
  var IS_CEP = !!window.__adobe_cep__;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "vectorbridge.ai.v1";
  var opt = { scope: "selection", scale: "2" };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || "{}"); for (var k in saved) opt[k] = saved[k]; } catch (e) {}
  function saveOpt() { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch (e) {} }

  function paintSeg() {
    Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (seg) {
      var k = seg.getAttribute("data-k");
      Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle("on", b.getAttribute("data-v") === opt[k]); });
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".seg button");
    if (b) { opt[b.parentNode.getAttribute("data-k")] = b.getAttribute("data-v"); saveOpt(); paintSeg(); }
  });

  var idleTimer = null;
  function status(kind, title, anim, lines) {
    clearTimeout(idleTimer);
    $("app").classList.toggle("idle", !kind);
    $("stat").className = "stat " + (kind || "ready");
    $("sTitle").textContent = title;
    var info = $("info"); info.textContent = "";
    (lines || []).forEach(function (l) { if (!l) return; var d = document.createElement("div"); d.textContent = l; info.appendChild(d); });
    info.hidden = !!anim;
    VBAnim.play(anim);
    if (!anim && kind) idleTimer = setTimeout(function () { $("app").classList.add("idle"); }, 3000);
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  var busy = false;
  function send(mode) {
    if (!IS_CEP) { status("warn", "Preview mode", null, ["In Illustrator this sends to After Effects."]); return; }
    if (busy) return;
    busy = true; $("btnSend").disabled = $("btnImage").disabled = true;
    status("busy", "Sending\u2026", "build");
    setTimeout(function () {          // let the panel draw the animation before Illustrator gets busy
      CSI.evalScript('vb_send("' + mode + '","' + opt.scope + '",' + (+opt.scale || 2) + ')', function (res) {
        busy = false; $("btnSend").disabled = $("btnImage").disabled = false;
        res = String(res || "");
        if (res === "ERR:NODOC") { status("err", "Open a document first"); return; }
        if (res === "ERR:NOSEL") { status("err", "Select the objects to send"); return; }
        if (res.indexOf("ERR:NOTHING") === 0) { status("err", "Nothing to send", null, ["Skipped: " + decodeURIComponent(res.split(":")[2] || "")]); return; }
        if (res.indexOf("ERR:WRITE") === 0) { status("err", "Cannot write the clip file", null, [decodeURIComponent(res.split(":")[2] || "")]); return; }
        if (res.indexOf("ERR:EX:") === 0) { status("err", "Script error", null, [decodeURIComponent(res.slice(7))]); return; }
        if (res.indexOf("OK:") !== 0) { status("err", "Script error", null, [res]); return; }
        var p = res.split(":"), items = +p[1], paths = +p[2], texts = +p[3], imgs = +p[4], grads = +p[5], clips = +p[6], sk = decodeURIComponent(p[7] || "");
        if (mode === "image") { status("ok", "Image sent", null, [opt.scope === "artboard" ? "Whole artboard at " + opt.scale + "\u00D7" : "Selection at " + opt.scale + "\u00D7"]); return; }
        var parts = [];
        if (paths) parts.push(plural(paths, "path"));
        if (texts) parts.push(plural(texts, "text"));
        if (imgs) parts.push(plural(imgs, "image"));
        if (grads) parts.push(plural(grads, "gradient"));
        if (clips) parts.push(plural(clips, "clipping mask"));
        status(sk ? "warn" : "ok", "Sent " + plural(items, "object"), null, [parts.join(", ")].concat(sk ? sk.split(", ") : []));
      });
    }, 60);
  }
  $("btnSend").addEventListener("click", function () { send("vector"); });
  $("btnImage").addEventListener("click", function () { send("image"); });
  paintSeg();
  if (IS_CEP) {
    VBAnim.init($("anim"), String(CSI.getSystemPath("extension")).replace(/\\/g, "/"));
    VBAnim.load("build");
  }
})();
