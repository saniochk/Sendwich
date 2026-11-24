const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("PNG import uses the exported bounds and stays visible for the entire composition", () => {
  const source = fs.readFileSync(path.join(__dirname, "../SendwichAE/jsx/host.jsx"), "utf8");
  const seam = "    return { run: run, begin: begin, step: step, cancel: cancel,";
  assert.ok(source.includes(seam));
  const values = {};
  const layer = {
    id: 7, startTime: 12, inPoint: 12, outPoint: 12 + 1 / 30,
    property: () => ({ property: key => ({ setValue(value) { values[key] = Array.isArray(value) ? [...value] : value; } }) })
  };
  let addedDuration, sequence, imported;
  const comp = { duration: 30, layers: { add(source, duration) { addedDuration = duration; return layer; } } };
  const footage = { width: 3840, height: 2160 };
  const app = { project: { importFile(options) {
    sequence = options.sequence;
    imported = options.file.fsName;
    return footage;
  } } };
  function File(file) { this.fsName = file; this.exists = !file.startsWith("/assets/"); }
  File.prototype.copy = () => true;
  function ImportOptions(file) { this.file = file; this.sequence = true; }
  const context = { app, File, ImportOptions, fixture: { comp, offX: 5, offY: -3, assets: [], imageLayers: [] } };
  vm.runInNewContext(source.replace(seam, `
    CTX = fixture;
    stats = { layers: 0, images: 0 };
    assetFolder = function () { return { fsName: "/assets" }; };
    projectFolder = function () { return null; };
    fixture.importImage = buildImage;
` + seam), context);

  const output = context.fixture.importImage({ name: "Photo", file: "/input/001.png",
    bounds: [20, 40, 1940, 1120], scale: 1, opacity: 70 });
  assert.equal(output, layer);
  assert.deepEqual(context.fixture.imageLayers, [7]);
  assert.equal(sequence, false);
  assert.match(imported, /^\/assets\/Photo_.*\.png$/);
  assert.equal(addedDuration, 30);
  assert.equal(layer.startTime, 0);
  assert.equal(layer.inPoint, 0);
  assert.equal(layer.outPoint, 30);
  assert.deepEqual(values["ADBE Anchor Point"], [1920, 1080]);
  assert.deepEqual(values["ADBE Position"], [985, 577]);
  assert.deepEqual(values["ADBE Scale"], [50, 50]);
  assert.equal(values["ADBE Opacity"], 70);
});
