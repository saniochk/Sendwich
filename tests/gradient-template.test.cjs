const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const dir = path.join(__dirname, "../VectorBridgeAE/jsx");
const host = fs.readFileSync(path.join(dir, "host.jsx"), "utf8");
const raw = fs.readFileSync(path.join(dir, "gradients.aep"), "latin1");
const seam = "    return { run: run, begin: begin, step: step, cancel: cancel,";
assert.ok(host.includes(seam));
const context = { internals: {} };
vm.runInNewContext(host.replace(seam, "    internals.parse = rifxParse; internals.layout = gradientTree;\n" + seam), context);
const { parse, layout } = context.internals;
const unpack = () => parse(raw, 0, raw.length)[0];

function contents(group, match) {
  const kids = group.kids || [];
  for (let i = 0; i + 1 < kids.length; i++) {
    if (kids[i].id === "tdmn" && kids[i].data.split("\0")[0] === match) return kids[i + 1];
  }
  for (const child of kids) {
    const found = contents(child, match);
    if (found) return found;
  }
  return null;
}
function properties(group, match) {
  const entries = [];
  const kids = group.kids;
  for (let i = 0; i + 1 < kids.length; i++) {
    if (kids[i].id === "tdmn" && kids[i].data.split("\0")[0] === match) entries.push(kids[i + 1]);
  }
  return entries;
}
const groupMatch = "ADBE Vector Group";
const nested = group => contents(group, "ADBE Vectors Group");
const root = project => contents(project, "ADBE Root Vectors Group");

test("64 fill and 64 stroke presets serialize a nested 22-gradient group without splitting", () => {
  const project = unpack();
  const names = Array.from(properties(root(project), groupMatch),
    group => group.kids.find(k => k.id === "tdsn").data.slice(8).split("\0")[0]);
  assert.deepEqual(names, ["GF", "GS"].flatMap(prefix => Array.from({ length: 64 }, (_, i) => prefix + i)));

  const grad = { stops: [[0, .5, .1, .2, .3, 1], [1, .5, .8, .7, .6, .5]] };
  const shapes = Array.from({ length: 22 }, (_, i) => ({
    type: "shape", style: { fillGrad: grad, ...(i === 0 ? { stroke: { grad } } : {}) }
  }));
  layout(project, { type: "group", children: [{ type: "group", children: shapes.slice(0, 11) }, ...shapes.slice(11)] });
  const top = properties(root(project), groupMatch);
  assert.equal(top.length, 12);
  const underFirst = properties(nested(top[0]), groupMatch);
  assert.equal(underFirst.length, 11);
  const leaves = [...underFirst, ...top.slice(1)];
  assert.equal(leaves.reduce((total, group) => total + properties(nested(group), "ADBE Vector Graphic - G-Fill").length, 0), 22);
  assert.equal(properties(nested(leaves[0]), "ADBE Vector Graphic - G-Stroke").length, 1);
});
