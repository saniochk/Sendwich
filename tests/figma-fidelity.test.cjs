const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("Figma keeps source groups and explicit masks, ignores frame clipping, and carries strokes and backdrop geometry", async () => {
  const identity = [[1, 0, 0], [0, 1, 0]];
  const color = { type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.9 } };
  const rect = (name, overrides = {}) => ({
    name, type: "RECTANGLE", visible: true, opacity: 1, width: 100, height: 100,
    absoluteTransform: identity, fills: [color], strokes: [], ...overrides
  });
  const parent = { type: "PAGE" };
  const imagePaint = { type: "IMAGE", imageHash: "qa-image" };
  const frame = rect("Frame", { parent, type: "FRAME", clipsContent: true, fills: [imagePaint] });
  const transparent = { ...color, opacity: 0 };
  const empty = rect("Oversized empty frame", {
    parent: frame, type: "FRAME", width: 9000, height: 6000, fills: [transparent],
    strokes: [transparent], strokeWeight: 20, strokeAlign: "OUTSIDE", children: []
  });
  const container = rect("Transparent frame", {
    parent: frame, type: "FRAME",
    fills: [{ type: "GRADIENT_LINEAR", gradientStops: [{ color: { a: 0 } }, { color: { a: 0 } }] }]
  });
  const group = rect("Nested Figma group", { parent: container, type: "GROUP", fills: [] });
  const outlinePath = [{ windingRule: "EVENODD", data: "M -8 -8 L 108 -8 L 108 108 L -8 108 Z M 0 0 L 0 100 L 100 100 L 100 0 Z" }];
  let removed = false, cloneRemoved = false, workspaceRemoved = false;
  const outlined = rect("Outside stroke", {
    parent: group, strokes: [color], strokeWeight: 8, strokeAlign: "OUTSIDE",
    absoluteTransform: [[0, -1, 350], [1, 0, 660]],
    outlineStroke() { assert.fail("The original node should not be outlined in its nested container"); },
    clone() {
      return {
        relativeTransform: [[0, -1, 27000], [1, 0, -12000]],
        outlineStroke() {
          assert.deepEqual(JSON.parse(JSON.stringify(this.relativeTransform)), identity);
          return rect("Temporary", {
            type: "VECTOR", fillGeometry: outlinePath, vectorPaths: outlinePath,
            absoluteTransform: [[1, 0, -3], [0, 1, 2]],
            remove() { removed = true; }
          });
        },
        remove() { cloneRemoved = true; }
      };
    }
  });
  const glass = rect("Glass", { parent: group, type: "FRAME", children: [], fills: [transparent],
    cornerRadius: 12, effects: [{ type: "BACKGROUND_BLUR", radius: 20 }] });
  const mask = rect("Explicit mask", { parent: frame, isMask: true });
  const masked = rect("Masked", { parent: frame });
  group.children = [outlined, glass];
  container.children = [group];
  frame.children = [empty, container, mask, masked];
  parent.children = [frame];

  let rasterRemoved = false;
  const figma = { createFrame: () => ({
    appendChild(node) { assert.ok(node); }, remove() { workspaceRemoved = true; }
  }), base64Encode: () => "iVBORw0KGgo=", createRectangle: () => ({
    type: "RECTANGLE", resize() {}, exportAsync: async () => new Uint8Array([1, 2]),
    absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 }, remove() { rasterRemoved = true; }
  }), mixed: Symbol("mixed"), root: { name: "Fixture" }, currentPage: { selection: [frame] }, ui: {}, showUI() {}, on() {} };
  const context = vm.createContext({ figma, __html__: "" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../SendwichFigma/code.js"), "utf8"), context);
  const transfer = await vm.runInContext('send("vector", "selection", 2)', context);
  const root = transfer.data.items[0];
  assert.equal(root.name, "Frame");
  assert.equal(root.figmaGroup, true);
  assert.equal(root.clipped, undefined);
  assert.equal(transfer.summary.clips, 1);
  assert.equal(root.children.at(-1).type, "image");
  assert.equal(root.children.at(-1).name, "Frame Background");
  assert.equal(transfer.images.length, 1);
  assert.equal(rasterRemoved, true);
  const clip = root.children.find(item => item.clipped);
  assert.equal(clip.name, "Explicit mask");
  assert.equal(clip.children[0].name, "Masked");
  assert.deepEqual(Array.from(root.children, item => item.name), ["Explicit mask", "Transparent frame", "Frame Background"]);
  const exportedContainer = root.children[1];
  assert.deepEqual(Array.from(exportedContainer.children, item => item.name), ["Nested Figma group"]);
  const nested = exportedContainer.children[0];
  assert.equal(nested.figmaGroup, true);
  const exportedGlass = nested.children.find(item => item.name === "Glass");
  assert.equal(exportedGlass.backdrop.radius, 20);
  assert.equal(exportedGlass.backdrop.paths[0].closed, true);
  assert.equal(exportedGlass.backdrop.evenodd, false);
  assert.equal(exportedGlass.backdrop.paths[0].pts[0][0][0], 12);
  assert.equal(exportedGlass.children.length, 0);
  const exportedStroke = nested.children.find(item => item.name === "Outside stroke");
  assert.equal(exportedStroke.children[0].name, "Stroke · OUTSIDE");
  assert.equal(exportedStroke.children[0].paths.length, 2);
  assert.equal(exportedStroke.children[0].style.evenodd, true);
  assert.equal(exportedStroke.children[1].style.stroke, undefined);
  assert.deepEqual(Array.from(exportedStroke.children[0].bounds), [240, 649, 356, 765]);
  assert.equal(removed, true);
  assert.equal(cloneRemoved, true);
  assert.equal(workspaceRemoved, true);
});
