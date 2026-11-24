// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
(function () {
  "use strict";
  var IS_CEP = !!window.__adobe_cep__;
  var $ = function (id) { return document.getElementById(id); };
  function updateTheme() {
    try {
      var skin = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo;
      var rgb = skin.panelBackgroundColor.color;
      document.documentElement.classList.toggle("theme-light", (rgb.red * 0.213 + rgb.green * 0.715 + rgb.blue * 0.072) >= 130);
      document.documentElement.style.setProperty("--bg", "rgb(" + rgb.red + "," + rgb.green + "," + rgb.blue + ")");
    } catch (e) {} // Keep the default dark theme if the CEP host cannot report its colors.
  }
  if (IS_CEP && typeof window.__adobe_cep__.getHostEnvironment === "function") {
    updateTheme();
    window.__adobe_cep__.addEventListener("com.adobe.csxs.events.ThemeColorChanged", updateTheme);
  }
  var root = null, ext = "", lastStamp = null, lastBusy = null, busy = false, waitSince = 0, idleTimer = null;

  // kind: "" | busy | ok | warn | err;  anim: wait | build | none;  info: html-free text lines
  function status(kind, title, anim, lines) {
    $("report").hidden = true;
    $("report").parentNode.classList.remove("has-report");
    clearTimeout(idleTimer);
    $("app").classList.toggle("idle", !kind);
    $("stat").className = "stat " + (kind || "ready");
    $("sTitle").textContent = title;
    $("stat").removeAttribute("title");
    var info = $("info"); info.textContent = "";
    (lines || []).forEach(function (l, i) { if (!l) return; var d = document.createElement("div"); if (i === 0) d.className = "time"; d.textContent = l; info.appendChild(d); });
    info.hidden = !!anim;
    VBAnim.play(anim);
    // active only while Illustrator / After Effects work; a result stays bright for a moment, then dims
    if (!anim && kind) idleTimer = setTimeout(function () { $("app").classList.add("idle"); }, 3000);
  }
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

  var server = null, pollTimer = null, closed = false;
  var pending = {};      // Figma requests waiting for their import result
  var activeTransfer = null;
  function importClip(stamp, request, transfer) {
    if (busy || closed) return false;
    busy = true; activeTransfer = transfer || null; setTools(false);
    status("busy", "Building in After Effects…", "build");

    function finish(res) {
      busy = false; activeTransfer = null;
      if (closed) return;
      setTools(true);
      res = String(res || "");
      answer(stamp, res);
      if (res === "CANCELLED" || res === "IDLE") { status("warn", "Import cancelled", null, ["Connection lost before the import was committed."]); return; }
      if (res === "ERR:NOCLIP") { status("err", "The clip was not found"); return; }
      if (res === "ERR:EMPTY") { status("err", "The clip is empty"); return; }
      if (res.indexOf("ERR:BAD:") === 0) { status("err", "Clip file is damaged", null, ["", res.slice(8)]); return; }
      if (res.indexOf("ERR:EX:") === 0) { status("err", "Import failed", null, ["", res.slice(7)]); return; }
      if (res.indexOf("OK:") !== 0) { status("err", "No answer from After Effects", null, ["", res]); return; }
      var p = res.split(":"), layers = +p[1], masks = +p[5] || 0, texts = +p[6] || 0;
      var notes = decodeURIComponent(p[3] || ""), time = decodeURIComponent(p[4] || "").replace(/^time /, "");
      var issues = notes ? notes.split(" | ") : [];
      status(notes ? "warn" : "ok", notes ? issues[0] : "Import complete");
      if (notes) $("stat").title = issues.join("\n");
      $("stat").classList.add("result");
      $("info").hidden = true;
      $("statTime").textContent = time.split(" (")[0] || "—";
      $("statTime").parentNode.title = time;
      $("statLayers").textContent = layers;
      $("statLayerLabel").textContent = layers === 1 ? "layer" : "layers";
      $("statTexts").textContent = texts;
      $("statTextLabel").textContent = texts === 1 ? "text layer" : "text layers";
      $("statMasks").textContent = masks;
      $("statMaskLabel").textContent = masks === 1 ? "mask" : "masks";
      $("report").hidden = false;
      $("report").parentNode.classList.add("has-report");
    }

    function dispatch(command) {
      if (closed) return;
      if (request && pending[stamp] !== request) {
        if (command === "vb_begin") finish("CANCELLED");
        else CSI.evalScript("vb_cancel(" + q(stamp) + ")", finish);
        return;
      }
      var args = q(stamp) + (command === "vb_begin" ? "," + q(ext) : "");
      CSI.evalScript(command + "(" + args + ")", function (res) {
        // Yield to AE and CEP between slices, including before the final commit.
        if (transfer && res === "MORE") transfer.updated = Date.now();
        if (!closed && res === "MORE") setTimeout(function () { dispatch("vb_step"); }, 12);
        else finish(res);
      });
    }
    setTimeout(function () { dispatch("vb_begin"); }, 60);
    return true;
  }

  // ---------- layer tools: Explode / Merge ----------
  function tool(fn, title) {
    if (busy || !IS_CEP) return;
    busy = true; setTools(false);
    status("busy", title, "build");
    setTimeout(function () {
      if (closed) return;
      CSI.evalScript(fn + "()", function (res) {
        busy = false; setTools(true);
        res = String(res || "");
        if (res.indexOf("OK:") === 0) {
          var p = res.split(":"), notes = decodeURIComponent(p[2] || "");
          status(notes ? "warn" : "ok", decodeURIComponent(p[1] || "Done"), null, [""].concat(notes ? notes.split(" | ") : []));
        } else status("err", res.replace(/^ERR:/, "") || "No answer from After Effects");
      });
    }, 60);
  }
  function setTools(on) { $("btnExplode").disabled = !on; $("btnMerge").disabled = !on; }
  $("btnExplode").addEventListener("click", function () { tool("vb_explode", "Exploding\u2026"); });
  $("btnMerge").addEventListener("click", function () { tool("vb_merge", "Merging\u2026"); });

  // ---------- Figma: the plugin posts the clip to a small local server in this panel ----------
  var PORT = 7789, fs = null, http = null, crypto = null, os = null;
  try { var rq = typeof require === "function" ? require : (window.cep_node && window.cep_node.require); if (rq) { fs = rq("fs"); http = rq("http"); crypto = rq("crypto"); os = rq("os"); } } catch (e) {}
  function answer(stamp, res) {
    var r = pending[stamp]; if (!r) return;
    delete pending[stamp];
    var o = { ok: res.indexOf("OK:") === 0 };
    if (o.ok) { var p = res.split(":"); o.layers = +p[1]; o.masks = +p[5] || 0; o.texts = +p[6] || 0; o.notes = decodeURIComponent(p[3] || ""); o.time = decodeURIComponent(p[4] || "").replace(/^time /, ""); }
    else o.error = res.replace(/^ERR:(EX:)?/, "");
    reply(r, 200, JSON.stringify(o));
  }
  function reply(r, code, body) {
    try { r.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }); r.end(body); } catch (e) {}
  }
  function setImages(items, dir, received) {
    (items || []).forEach(function (it) {
      if (it.type === "image") {
        if (!received[it.file]) throw new Error("Invalid image reference");
        it.file = dir + "/" + it.file;
      }
      if (it.children) setImages(it.children, dir, received);
    });
  }
  function cleanup() {
    var cutoff = Date.now() - 24 * 3600 * 1000;
    fs.readdir(root, function (err, entries) {
      if (err || closed) return;
      entries.forEach(function (name) {
        if (!/^\d+(?:-figma)?$/.test(name) || parseInt(name, 10) >= cutoff) return;
        var folder = root + "/" + name;
        fs.readdir(folder, function (err, files) {
          if (err || closed) return;
          var left = files.length;
          if (!left) fs.rmdir(folder, function () {});
          files.forEach(function (file) {
            fs.unlink(folder + "/" + file, function () {
              if (--left === 0 && !closed) fs.rmdir(folder, function () {});
            });
          });
        });
      });
    });
  }
  function startServer() {
    if (!http || !fs || !crypto || !root) return;
    var key = "", pair = null, pairTimer = null;
    try { key = localStorage.getItem("vectorbridge.ae.key") || ""; } catch (e) {}
    var PAIR_TIMEOUT = 60000;
    function showPair(candidate) {
      clearTimeout(pairTimer);
      pair = { candidate: candidate, status: "pending", until: Date.now() + PAIR_TIMEOUT };
      $("pairPrompt").textContent = "Connect Figma (" + candidate.slice(-6).toUpperCase() + ")?";
      $("pairing").hidden = false;
      pairTimer = setTimeout(function () { $("pairing").hidden = true; pair = null; }, PAIR_TIMEOUT);
    }
    function decide(approved) {
      if (!pair || pair.status !== "pending" || Date.now() >= pair.until) return;
      if (approved) {
        try {
          localStorage.setItem("vectorbridge.ae.key", pair.candidate);
          key = pair.candidate;
        } catch (e) {
          pair.status = "error"; $("pairing").hidden = true; return;
        }
      }
      pair.status = approved ? "connected" : "declined";
      $("pairing").hidden = true;
    }
    $("pairAllow").onclick = function () { decide(true); };
    $("pairDeny").onclick = function () { decide(false); };

    function verify(candidate) {
      return /^[a-f0-9]{32}$/.test(key) && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(key));
    }
    function pairResponse(candidate, start) {
      if (verify(candidate)) return "connected";
      if (pair && Date.now() >= pair.until) { pair = null; $("pairing").hidden = true; }
      if (!start) return pair && candidate === pair.candidate ? pair.status : "unpaired";
      if (pair && pair.status === "pending") return candidate === pair.candidate ? "pending" : "busy";
      showPair(candidate);
      return "pending";
    }
    cleanup();
    var srv = server = http.createServer(function (req, res) {
      if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" }); res.end(); return; }
      if (req.method !== "POST") return reply(res, 405, "Use POST");
      var chunks = [], bytes = 0, rejected = false;
      req.on("error", function () {});
      req.on("data", function (c) {
        if (rejected) return;
        bytes += c.length;
        if (bytes > 128 * 1024 * 1024) {
          rejected = true; chunks = [];
          return reply(res, 413, JSON.stringify({ ok: false, error: "Transfer too large. Send fewer layers or reduce Scale." }));
        }
        chunks.push(c);
      });
      req.on("end", function () {
        if (rejected || closed) return;
        var url = req.url || "";
        try {
          var raw = Buffer.concat(chunks);
          var candidate = raw.toString("utf8", 0, 32);
          if (!/^[a-f0-9]{32}$/.test(candidate) || raw[32] !== 10) {
            return reply(res, 401, JSON.stringify({ ok: false, code: "unpaired", error: "Connect to After Effects first." }));
          }
          if (url === "/pair" || url === "/pair/status") {
            return reply(res, 200, JSON.stringify({ state: pairResponse(candidate, url === "/pair") }));
          }
          if (!verify(candidate)) {
            return reply(res, 401, JSON.stringify({ ok: false, code: "unpaired", error: "Connect to After Effects again." }));
          }
          if (url === "/progress") {
            var id = raw.toString("utf8", 33);
            var running = activeTransfer && activeTransfer.id === id && activeTransfer.key === candidate &&
                          Date.now() - activeTransfer.updated < 45000;
            return reply(res, 200, JSON.stringify({ running: !!running }));
          }
          if (url === "/busy") return reply(res, 200, "ok");
          if (url === "/idle") return reply(res, 200, "ok");
          if (url !== "/clip") return reply(res, 404, "?");
          if (busy) return reply(res, 200, JSON.stringify({ ok: false, error: "After Effects is still importing" }));
          var msg = JSON.parse(raw.toString("utf8", 33));
          var stamp = Date.now() + "-figma", dir = root + "/" + stamp;
          var received = Object.create(null);
          (msg.images || []).forEach(function (im) {
            if (!/^img[1-9][0-9]*\.png$/.test(im.name) || received[im.name]) throw new Error("Invalid image name");
            received[im.name] = true;
          });
          setImages(msg.clip.items, dir, received);
          fs.mkdirSync(dir, { recursive: true });
          (msg.images || []).forEach(function (im) { fs.writeFileSync(dir + "/" + im.name, Buffer.from(im.b64, "base64")); });
          fs.writeFileSync(dir + "/clip.json", JSON.stringify(msg.clip));
          pending[stamp] = res;
          res.on("close", function () { if (pending[stamp] === res) delete pending[stamp]; });
          var transfer = /^[a-f0-9]{32}$/.test(msg.transferId || "") ? { id: msg.transferId, key: candidate, updated: Date.now() } : null;
          importClip(stamp, res, transfer);
        } catch (e) { reply(res, 200, JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
      });
    });
    srv.on("error", function () { if (!closed) status("warn", "Figma connection unavailable", null, ["Close other Sendwich panels and reopen this one."]); });
    srv.listen(PORT, "127.0.0.1");
  }

  var polling = false;
  function readFile(name, callback) {
    fs.readFile(root + "/" + name, "utf8", function (err, data) {
      callback(err ? null : String(data).replace(/^\s+|\s+$/g, ""));
    });
  }
  function tick() {
    if (busy || closed || polling) return;
    polling = true;
    readFile("stamp.txt", function (stamp) {
      if (busy || closed) { polling = false; return; }
      if (stamp && stamp !== lastStamp) {
        polling = false; lastStamp = stamp; waitSince = 0; importClip(stamp); return;
      }
      readFile("busy.txt", function (message) {
        polling = false;
        if (busy || closed) return;
        if (message && message !== lastBusy) {
          lastBusy = message;
          if (message.indexOf("busy") === 0) {
            waitSince = Date.now(); status("busy", "Waiting for Illustrator…", "wait");
          } else if (waitSince) { waitSince = 0; status("", "Ready"); }
        }
        if (waitSince && Date.now() - waitSince > 120000) { waitSince = 0; status("", "Ready"); }
      });
    });
  }

  if (IS_CEP && fs && os) {
    window.addEventListener("unload", function () {
      // The host expires abandoned staging jobs itself. Never invoke CEP/JSX during teardown.
      closed = true;
      clearInterval(pollTimer);
      clearTimeout(idleTimer);
      for (var stamp in pending) {
        reply(pending[stamp], 503, JSON.stringify({ ok: false, error: "The After Effects panel closed" }));
      }
      pending = {};
      if (server) server.close();
    });
    ext = decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, "$1").replace(/\/[^/]*$/, "");
    root = os.tmpdir().replace(/\\/g, "/") + "/VectorBridge";
    VBAnim.init($("anim"), ext, fs);
    startServer();
    readFile("stamp.txt", function (stamp) {
      if (closed) return;
      lastStamp = stamp; // skip transfers already present when the panel opened
      readFile("busy.txt", function (message) {
        if (closed) return;
        lastBusy = message;
        pollTimer = setInterval(tick, 300);
      });
    });
  } else status("", "Preview mode");
})();
