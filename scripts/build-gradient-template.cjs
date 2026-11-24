const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[2] || path.join(__dirname, "../SendwichAE/jsx/gradients.aep");
const capacity = 64;
const base = fs.readFileSync(file);

function parse(start, end) {
  const chunks = [];
  for (let offset = start; offset + 8 <= end;) {
    const id = base.toString("latin1", offset, offset + 4);
    const size = base.readUInt32BE(offset + 4);
    const body = offset + 8;
    if (body + size > end) throw new Error("Malformed chunk " + id);
    if (id === "RIFX" || id === "LIST") {
      chunks.push({ id, type: base.toString("latin1", body, body + 4), kids: parse(body + 4, body + size) });
    } else {
      chunks.push({ id, data: base.subarray(body, body + size) });
    }
    offset = body + size + (size & 1);
  }
  return chunks;
}

function serialize(chunk) {
  const body = chunk.kids ? Buffer.concat([Buffer.from(chunk.type, "latin1"), ...chunk.kids.map(serialize)]) : chunk.data;
  const header = Buffer.alloc(8);
  header.write(chunk.id, 0, 4, "latin1");
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body, Buffer.alloc(body.length & 1)]);
}

function isMatch(chunk, name) {
  return chunk.id === "tdmn" && chunk.data.toString("latin1").split("\0")[0] === name;
}

function findContents(node) {
  const kids = node.kids || [];
  for (let i = 0; i + 1 < kids.length; i++) if (isMatch(kids[i], "ADBE Root Vectors Group")) return kids[i + 1];
  for (const child of kids) {
    const found = findContents(child);
    if (found) return found;
  }
  return null;
}

function namedGroup(group, name) {
  const label = Buffer.from(name, "utf8");
  const header = Buffer.alloc(8);
  header.write("Utf8");
  header.writeUInt32BE(label.length, 4);
  const data = Buffer.concat([header, label, Buffer.alloc(label.length & 1)]);
  return { ...group, kids: group.kids.map(part => part.id === "tdsn" ? { ...part, data } : part) };
}

const end = 8 + base.readUInt32BE(4);
const project = parse(0, end)[0];
const contents = findContents(project);
if (!contents) throw new Error("Vector template contents not found");
const slots = new Map();
for (let i = 0; i + 1 < contents.kids.length; i++) {
  const match = contents.kids[i], group = contents.kids[i + 1];
  if (isMatch(match, "ADBE Vector Group")) {
    const name = group.kids.find(chunk => chunk.id === "tdsn").data.toString("utf8", 8).split("\0")[0];
    slots.set(name, { match, group });
  }
}
const entries = [];
for (const prefix of ["GF", "GS"]) {
  const prototype = slots.get(prefix + "0");
  if (!prototype) throw new Error("Missing prototype " + prefix);
  for (let i = 0; i < capacity; i++) entries.push(prototype.match, namedGroup(prototype.group, prefix + i));
}
contents.kids = [...contents.kids.slice(0, 2), ...entries, contents.kids.at(-1)];
fs.writeFileSync(file, Buffer.concat([serialize(project), base.subarray(end)]));
console.log("Wrote " + capacity + " fill and " + capacity + " stroke slots.");
