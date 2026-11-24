const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../VectorBridgeFigma/ui.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const ui = new vm.Script(scripts.at(-1)[1]);
const flush = () => new Promise(resolve => setImmediate(resolve));

function start(fetch, onPost, savedKey = "a".repeat(32)) {
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const window = {};
  const reportClass = { add() {}, remove() {} };
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "", disabled: false, parentNode: { classList: reportClass }, classList: { add() {}, toggle() {}, contains: () => false },
        appendChild() {}, removeAttribute(name) { delete this[name]; }
      });
    }
    return elements.get(id);
  };
  const deliver = pluginMessage => window.onmessage({ data: { pluginMessage } });
  ui.runInNewContext({
    window, fetch, AbortController, crypto: require("node:crypto").webcrypto, navigator: { userAgent: "Figma" },
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    parent: { postMessage: ({ pluginMessage }) => onPost?.(pluginMessage, deliver) },
    setTimeout(callback, ms) {
      const id = ++nextTimer;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  deliver({ type: "saved-key", key: savedKey });
  deliver({ type: "selection", count: 1 });

  return {
    element, deliver,
    send() {
      element("btnSend").onclick();
      deliver({ type: "clip", clip: { items: [] }, images: [], summary: {} });
    },
    expire(ms) {
      const entry = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, "expected active deadline");
      timers.delete(entry[0]);
      entry[1].callback();
    }
  };
}

const response = value => Promise.resolve({ text: () => Promise.resolve(value) });
const success = '{"ok":true,"layers":1,"masks":2,"texts":1,"time":"3.2 s"}';

test("a stalled direct response unlocks the UI and lets the user retry without resending automatically", async () => {
  let attempts = 0;
  let stalledSignal;
  const app = start((url, init) => {
    if (url.endsWith("/pair/status")) return response('{"state":"connected"}');
    if (url.endsWith("/busy")) return response("ok");
    if (url.endsWith("/progress")) return response('{"running":false}');
    if (++attempts > 1) return response(success);
    stalledSignal = init.signal;
    return Promise.resolve({ text: () => new Promise(() => {}) });
  }, msg => assert.notEqual(msg.type, "post"));
  await flush();
  app.send();
  await flush();
  assert.equal(app.element("btnSend").disabled, true);
  app.expire(60000);
  await flush();
  assert.equal(stalledSignal.aborted, true);
  assert.equal(app.element("sTitle").textContent, "No confirmation from After Effects");
  assert.equal(app.element("btnSend").disabled, false);
  assert.equal(app.element("btnImage").disabled, false);
  assert.equal(attempts, 1);
  app.send();
  await flush();
  assert.equal(app.element("sTitle").textContent, "Import complete");
  assert.equal(app.element("statLayers").textContent, 1);
  assert.equal(app.element("statMasks").textContent, 2);
  assert.equal(app.element("statTexts").textContent, 1);
  assert.equal(app.element("statTime").textContent, "3.2 s");
});

test("a stalled plugin transport unlocks the UI and an old response cannot complete a retry", async () => {
  const clips = [];
  const cancelled = [];
  const app = start(() => Promise.reject(new Error("offline")), (msg, deliver) => {
    if (msg.type === "abort-post") cancelled.push(msg.id);
    if (msg.type !== "post") return;
    if (msg.path === "/pair/status") deliver({ type: "posted", id: msg.id, ok: true, text: '{"state":"connected"}' });
    else if (msg.path === "/progress") deliver({ type: "posted", id: msg.id, ok: true, text: '{"running":false}' });
    else if (msg.path === "/busy") deliver({ type: "posted", id: msg.id, ok: true, text: "ok" });
    else clips.push(msg.id);
  });
  await flush();
  app.send();
  await flush();
  app.expire(60000);
  await flush();
  assert.deepEqual(cancelled, [clips[0]]);
  assert.equal(app.element("btnSend").disabled, false);
  app.send();
  await flush();
  app.deliver({ type: "posted", id: clips[0], ok: true, text: success });
  await flush();
  assert.equal(app.element("btnSend").disabled, true);
  app.deliver({ type: "posted", id: clips[1], ok: true, text: success });
  await flush();
  assert.equal(app.element("sTitle").textContent, "Import complete");
  assert.equal(app.element("statLayers").textContent, 1);
  assert.equal(app.element("statMasks").textContent, 2);
  assert.equal(app.element("statTime").textContent, "3.2 s");
});

test("first start offers Connect and enables sending only after approval", async () => {
  let saved;
  const calls = [];
  const app = start((url, init) => {
    calls.push({ url, body: init.body });
    return response(url.endsWith("/pair") ? '{"state":"pending"}' : '{"state":"connected"}');
  }, message => { if (message.type === "save-key") saved = message.key; }, "");
  assert.equal(app.element("btnConnect").disabled, false);
  assert.equal(app.element("btnSend").hidden, true);
  app.element("btnConnect").onclick();
  await flush();
  assert.equal(app.element("sTitle").textContent, "Approve in After Effects");
  assert.equal(app.element("btnSend").hidden, true);
  assert.match(saved, /^[a-f0-9]{32}$/);
  app.expire(1000);
  await flush();
  assert.equal(app.element("btnConnect").hidden, true);
  assert.equal(app.element("btnSend").hidden, false);
  assert.equal(app.element("btnSend").disabled, false);
  assert.equal(calls[0].body, calls[1].body);
});

test("a large import with recent AE progress survives the initial timeout without resending", async () => {
  let finish, signal, uploads = 0, checks = 0;
  const app = start((url, init) => {
    if (url.endsWith("/pair/status")) return response('{"state":"connected"}');
    if (url.endsWith("/busy")) return response("ok");
    if (url.endsWith("/progress")) { checks++; return response('{"running":true}'); }
    uploads++;
    signal = init.signal;
    return new Promise(resolve => { finish = () => resolve({ text: () => Promise.resolve(success) }); });
  });
  await flush();
  app.send();
  await flush();
  app.expire(60000);
  await flush();
  assert.equal(checks, 1);
  assert.equal(uploads, 1);
  assert.equal(signal.aborted, false);
  assert.equal(app.element("btnSend").disabled, true);
  finish();
  await flush();
  assert.equal(app.element("btnSend").disabled, false);
  assert.equal(app.element("sTitle").textContent, "Import complete");
  assert.equal(app.element("statLayers").textContent, 1);
  assert.equal(app.element("statMasks").textContent, 2);
  assert.equal(app.element("statTime").textContent, "3.2 s");
});
