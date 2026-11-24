const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("192 layers are staged across calls, cancelled without changing the target, then committed once", () => {
  const shape = index => ({ type: "shape", name: "Shape " + index, style: {}, paths: [] });
  const data = {
    app: "figma", doc: "Large layout", artboard: { w: 1000, h: 800 },
    items: Array.from({ length: 192 }, (_, index) => shape(index))
  };
  const source = fs.readFileSync(path.join(__dirname, "../VectorBridgeAE/jsx/host.jsx"), "utf8");
  const seam = "    return { run: run, begin: begin, step: step, cancel: cancel,";
  assert.ok(source.includes(seam));
  const withStubs = source.replace(seam, `
    hasTemplate = function () { return !!app.qaOperations; };
    importTemplate = function (item) { app.qaOperations.push("template:" + item.name); return {}; };
    buildItem = function (item) {
        if (app.qaOperations && item.type === "image") app.qaOperations.push("image:" + item.name);
        if (item.type === "text") stats.texts++; stats.layers++; return [CTX.comp.stage(item.name)];
    };
    newShapeLayer = function (comp, name) { return { layer: comp.stage(name), cx: 0, cy: 0 }; };
    addItem = function (layer, path, item) { layer.item = item; };
    addBlur = function (layer, radius) { layer.radius = radius; };
    buildFrag = function (fragment) {
        if (hasGrad(fragment) && !fragment._vbTemplate) throw new Error("Gradient was not prepared");
        var layer = CTX.comp.stage(fragment.name);
        layer.item = fragment;
        stats.layers++;
        return [layer];
    };
` + seam);

  const comps = [];
  let openedGroups = 0, closedGroups = 0, time = 1000;
  let lease, id = 0;
  function CompItem(name, width, height) {
    this.name = name;
    this.id = ++id;
    this.width = width;
    this.height = height;
    this.frameRate = 30;
    this.duration = 10;
    this.pixelAspect = 1;
    this.layers = [];
    this.layers.addSolid = (color, name) => {
      const layer = this.stage(name);
      layer.source = { usedIn: [] };
      return layer;
    };
    comps.push(this);
  }
  Object.defineProperties(CompItem.prototype, {
    numLayers: { get() { return this.layers.length; } },
    selectedLayers: { get() { return this.layers.filter(layer => layer.selected); } }
  });
  CompItem.prototype.stage = function (name) {
    const layer = { id: ++id, name, enabled: true, parent: null, copyToComp: target => {
      if (openedGroups > closedGroups && layer.parent) throw new Error("AE cannot copy a parented layer in an Undo Group");
      const copy = target.stage(layer.name);
      Object.assign(copy, { source: layer.source, enabled: layer.enabled, item: layer.item,
        adjustmentLayer: layer.adjustmentLayer, radius: layer.radius });
      return copy;
    } };
    layer.moveBefore = other => {
      this.layers.splice(this.layers.indexOf(layer), 1);
      this.layers.splice(this.layers.indexOf(other), 0, layer);
    };
    layer.remove = () => this.layers.splice(this.layers.indexOf(layer), 1);
    layer.setTrackMatte = (matte, type) => {
      layer.hasTrackMatte = true;
      layer.trackMatteLayer = matte;
      layer.trackMatteType = type;
    };
    Object.defineProperty(layer, "index", { get: () => this.layers.indexOf(layer) + 1 });
    this.layers.unshift(layer);
    return layer;
  };
  CompItem.prototype.layer = function (position) { return this.layers[position - 1]; };
  CompItem.prototype.remove = function () { comps.splice(comps.indexOf(this), 1); };
  const target = new CompItem("Existing target", 1000, 800);
  target.stage("Existing layer");
  const app = {
    project: { activeItem: target, layerByID: wanted => comps.flatMap(comp => comp.layers).find(layer => layer.id === wanted), items: { addComp: (name, w, h) => new CompItem(name, w, h) } },
    beginUndoGroup() { openedGroups++; },
    endUndoGroup() { closedGroups++; },
    scheduleTask(command, delay) { lease = { command, delay }; return 1; },
    cancelTask() { lease = null; }
  };
  function File() { this.exists = true; }
  File.prototype.open = () => true;
  File.prototype.read = () => JSON.stringify(data);
  File.prototype.close = () => {};
  const context = vm.createContext({ app, CompItem, File, TrackMatteType: { ALPHA: 1 }, Date: function () { return { getTime: () => time }; }, Folder: { temp: { fsName: "/tmp" } } });
  vm.runInContext(withStubs, context);

  assert.equal(context.vb_begin("first"), "MORE");
  assert.match(context.vb_begin("another"), /already running/);
  let calls = 0;
  while (comps[1].numLayers < 24 && calls < 192) {
    assert.equal(context.vb_step("first"), "MORE");
    calls++;
  }
  assert.ok(calls > 1 && comps[1].numLayers < 192);
  assert.equal(target.numLayers, 1);
  assert.equal(lease.command, "vb_expire()");
  time += 31000;
  context.vb_expire();
  assert.equal(comps.length, 1);
  assert.equal(target.numLayers, 1);
  assert.equal(openedGroups, 0);
  assert.match(context.vb_step("first"), /no longer active/);

  assert.equal(context.vb_begin("retry"), "MORE");
  let answer = "MORE";
  for (let i = 0; i < 300 && answer === "MORE"; i++) answer = context.vb_step("retry");
  assert.match(answer, /^OK:192:/);
  assert.equal(comps.length, 1);
  assert.deepEqual(target.layers.map(layer => layer.name), [...data.items.map(item => item.name), "Existing layer"]);
  assert.equal(openedGroups, 1);
  assert.equal(closedGroups, 1);

  data.items = [{ type: "group", name: "Outer", figmaGroup: true, children: [
    { type: "group", name: "Inner", figmaGroup: true, children: [{ type: "text", name: "Title" }] }, shape(0)
  ] }];
  assert.equal(context.vb_begin("group"), "MORE");
  answer = "MORE";
  for (let i = 0; i < 30 && answer === "MORE"; i++) answer = context.vb_step("group");
  assert.match(answer, /^OK:2:/);
  assert.equal(answer.split(":").at(-1), "1");
  assert.deepEqual(target.layers.slice(0, 2).map(layer => layer.name), ["Title", "Outer"]);
  assert.equal(comps.length, 1);
  assert.equal(target.layers.some(layer => layer.guideLayer), false);

  app.qaOperations = [];
  const gradient = shape(1);
  gradient.style.fillGrad = { stops: [] };
  // The image is below the vector and must be staged first without triggering another AEP import.
  data.items = [gradient, { type: "image", name: "Photo" }];
  assert.equal(context.vb_begin("mixed"), "MORE");
  answer = "MORE";
  for (let i = 0; i < 30 && answer === "MORE"; i++) answer = context.vb_step("mixed");
  assert.match(answer, /^OK:2:/);
  assert.deepEqual(app.qaOperations, ["template:Shape 1", "image:Photo"]);
  assert.deepEqual(target.layers.slice(0, 2).map(layer => layer.name), ["Shape 1", "Photo"]);

  const paths = [{ closed: true, pts: [[12, 0], [100, 12], [88, 100], [0, 88]].map(point => [point, point, point]) }];
  const fill = { fill: [0, 0, 1], fillOp: 20 };
  const glass = { type: "shape", name: "Glass", style: fill, paths,
    backdrop: { radius: 24, paths, evenodd: false, opacity: 100 } };
  const frame = { type: "group", name: "Frame", figmaGroup: true, children: [
    { type: "group", name: "Empty frame", children: [] },
    { type: "group", name: "Nested", children: [shape(2)] },
    glass,
    { type: "group", name: "Nested bottom", children: [shape(3)] }
  ] };
  const clipped = { type: "group", name: "Explicit mask", clipped: true, clip: { paths, evenodd: true }, children: [shape(4)] };
  data.items = [frame, clipped];
  assert.equal(context.vb_begin("backdrop"), "MORE");
  answer = "MORE";
  for (let i = 0; i < 30 && answer === "MORE"; i++) answer = context.vb_step("backdrop");
  assert.match(answer, /^OK:7:/);
  const [top, foreground, matte, adjustment, bottom, explicitMatte, masked] = target.layers.slice(0, 7);
  assert.deepEqual(target.layers.slice(0, 7).map(layer => layer.name),
    ["Frame", "Glass", "Glass · Blur matte", "Glass · Background blur", "Frame", "Explicit mask Mask", "Explicit mask"]);
  assert.equal(top.item.children[0].name, "Nested");
  assert.equal(top.item.children.length, 1);
  assert.equal(bottom.item.children[0].name, "Nested bottom");
  assert.equal(foreground.item.style.fillOp, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(matte.item)), { type: "shape", name: "Glass · Blur matte",
    opacity: 100, paths, style: { fill: [1, 1, 1], fillOp: 100, evenodd: false } });
  assert.equal(adjustment.adjustmentLayer, true);
  assert.equal(adjustment.radius, 24);
  assert.equal(adjustment.trackMatteLayer, matte);
  assert.equal(matte.enabled, false);
  assert.equal(masked.trackMatteLayer, explicitMatte);
});
