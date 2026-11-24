const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("Figma receiver checks approval and confines image references to received assets", () => {
  const elements = {};
  const files = new Map();
  const server = new EventEmitter();
  const scheduled = [];
  const scripts = [];
  let unload;
  let imports = 0, steps = 0, cancels = 0;
  let handle, storedKey, duringStep;
  let stepResult = "OK:1:Figma::time%202.0%20s:1:1";
  let serverClosed = false;
  server.close = () => { serverClosed = true; };
  server.listen = (port, host) => {
    assert.equal(port, 7789);
    assert.equal(host, "127.0.0.1");
    server.emit("listening");
  };
  const classList = { toggle() {}, add() {}, remove() {} };
  let themeColor = 34, themeChanged, lightTheme, panelBackground;
  const document = {
    documentElement: {
      classList: { toggle(name, enabled) { assert.equal(name, "theme-light"); lightTheme = enabled; } },
      style: { setProperty(name, value) { assert.equal(name, "--bg"); panelBackground = value; } }
    },
    getElementById(id) {
      return elements[id] ??= { classList, parentNode: { classList }, addEventListener() {}, appendChild() {}, removeAttribute(name) { delete this[name]; } };
    },
    createElement() { return {}; }
  };
  const modules = {
    fs: {
      readdir: (folder, callback) => callback(null, []),
      readFile: (file, encoding, callback) => callback(new Error("missing")),
      mkdirSync() {},
      writeFileSync: (file, data) => files.set(file, data)
    },
    http: { createServer(handler) { handle = handler; return server; } },
    os: { tmpdir: () => "/temp" },
    crypto: require("node:crypto")
  };
  const source = path.join(__dirname, "../VectorBridgeAE/js/main.js");
  vm.runInNewContext(fs.readFileSync(source, "utf8"), {
    require: name => modules[name],
    window: { __adobe_cep__: {
      getHostEnvironment() { return JSON.stringify({ appSkinInfo: { panelBackgroundColor: { color: { red: themeColor, green: themeColor, blue: themeColor } } } }); },
      addEventListener(name, handler) { assert.equal(name, "com.adobe.csxs.events.ThemeColorChanged"); themeChanged = handler; }
    }, location: { pathname: "/extension/index.html" }, addEventListener(name, callback) { if (name === "unload") unload = callback; } },
    document, Buffer,
    CSI: {
      getSystemPath: () => "/extension",
      evalScript(code, callback) {
        scripts.push(code);
        if (code.startsWith("vb_begin(")) { imports++; callback("MORE"); }
        if (code.startsWith("vb_step(")) { steps++; duringStep?.(); callback(stepResult); }
        if (code.startsWith("vb_cancel(")) { cancels++; callback("CANCELLED"); }
      }
    },
    VBAnim: { init() {}, load() {}, play() {} },
    localStorage: { getItem() { return storedKey; }, setItem(name, value) { storedKey = value; } },
    clearTimeout() {}, clearInterval() {}, setTimeout(callback, delay) { if (delay === 60 || delay === 12) scheduled.push(callback); }, setInterval() {}
  }, { filename: source });

  function send(body, disconnect = false, route = "/clip", flush = true) {
    const request = Object.assign(new EventEmitter(), { url: route, method: "POST" });
    const result = {};
    const response = Object.assign(new EventEmitter(), {
      writeHead(code) { result.code = code; },
      end(data) { result.data = JSON.parse(data); }
    });
    handle(request, response);
    request.emit("data", Buffer.from(body));
    request.emit("end");
    if (disconnect === "during") scheduled.shift()();
    if (disconnect) response.emit("close");
    if (flush) while (scheduled.length) scheduled.shift()();
    return result;
  }

  assert.equal(lightTheme, false);
  themeColor = 210;
  themeChanged();
  assert.equal(lightTheme, true);
  assert.equal(panelBackground, "rgb(210,210,210)");
  assert.deepEqual(scripts, [], "panel startup must not call ExtendScript");
  const key = "a".repeat(32), other = "b".repeat(32);
  const pair = (candidate, route = "/pair") => send(candidate + "\n", false, route).data.state;
  assert.equal(pair(key, "/pair/status"), "unpaired");
  assert.equal(pair(key), "pending");
  assert.equal(elements.pairing.hidden, false);
  assert.equal(pair(other), "busy");
  assert.equal(send(key + "\n{}").code, 401);
  elements.pairDeny.onclick();
  assert.equal(pair(key, "/pair/status"), "declined");
  assert.equal(pair(key), "pending");
  elements.pairAllow.onclick();
  assert.equal(elements.pairing.hidden, true);
  assert.equal(storedKey, key);
  assert.equal(pair(key, "/pair/status"), "connected");
  assert.equal(pair(other, "/pair/status"), "unpaired");
  assert.equal(send("{}").code, 401);
  assert.equal(files.size, 0);
  const transferId = "c".repeat(32);
  const clip = file => key + "\n" + JSON.stringify({
    transferId,
    clip: { items: [{ type: "image", file }] },
    images: [{ name: "img1.png", b64: "aW1hZ2U=" }]
  });
  assert.equal(send(clip("img2.png")).data.error, "Invalid image reference");
  assert.equal(files.size, 0);
  const progress = id => send(key + "\n" + id, false, "/progress", false).data.running;
  duringStep = () => {
    assert.equal(progress(transferId), true);
    assert.equal(progress("d".repeat(32)), false);
  };
  const imported = send(clip("img1.png")).data;
  assert.equal(imported.ok, true);
  assert.equal(imported.texts, 1);
  assert.equal(elements.statTexts.textContent, 1);
  assert.equal(elements.statTextLabel.textContent, "text layer");
  assert.equal(progress(transferId), false);
  assert.equal(elements.statMasks.textContent, 1);
  assert.equal(elements.statLayers.textContent, 1);
  assert.equal(elements.statTime.textContent, "2.0 s");
  assert.equal(elements.sTitle.textContent, "Import complete");
  assert.equal(elements.info.hidden, true);

  const clipFile = [...files.keys()].find(file => file.endsWith("/clip.json"));
  const imageFile = JSON.parse(files.get(clipFile)).items[0].file;
  assert.equal(imageFile, clipFile.replace(/clip\.json$/, "img1.png"));
  assert.equal(files.get(imageFile).toString(), "image");
  assert.equal(imports, 1);
  send(clip("img1.png"), true);
  assert.equal(imports, 1, "a disconnected request must not start a queued import");
  send(clip("img1.png"), "during");
  assert.equal(imports, 2);
  assert.equal(steps, 1);
  assert.equal(cancels, 1);
  const notes = "2 images could not be found | Missing fonts: Example Sans";
  stepResult = "OK:1:Figma:" + encodeURIComponent(notes) + ":time%202.0%20s:1:1";
  assert.equal(send(clip("img1.png")).data.notes, notes);
  assert.equal(elements.sTitle.textContent, "2 images could not be found");
  assert.equal(elements.stat.title, notes.replace(" | ", "\n"));
  assert.equal(elements.info.hidden, true);
  assert.equal(steps, 2);
  assert.equal(files.has("/temp/VectorBridge/stamp.txt"), false, "a disconnected Figma clip cannot be picked up by polling");
  send(clip("img1.png"), false, "/clip", false);
  scheduled.shift()(); // start staging, leave a step queued
  const calls = scripts.length;
  unload();
  while (scheduled.length) scheduled.shift()();
  assert.equal(serverClosed, true);
  assert.equal(scripts.length, calls, "closing an active panel must not call ExtendScript");
});
