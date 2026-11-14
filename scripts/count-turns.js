#!/usr/bin/env node
// Writes `turns: N` into each demos.js entry that links a prompt page: the number of user turns in its prompt.md.
// Turns = "## You" headings (scripts/prompt-md.sh output); hand-written files without them count blank-line-separated paragraphs.
// Usage: node scripts/count-turns.js   (idempotent; run after adding/updating a prompt.md)
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const file = path.join(root, "demos.js");

const count = (md) => {
  const headed = (md.match(/^## You\b/gm) || []).length;
  return headed || md.split(/\n\s*\n/).filter((p) => p.trim()).length;
};

const out = fs.readFileSync(file, "utf8").split("\n").map((line) => {
  if (!/^\s*\{ s:/.test(line)) return line;
  line = line.replace(/ turns: \d+,/, "");
  const m = line.match(/\["prompt", "([^"]+)\.html"\]/);
  if (!m) return line;
  const md = path.join(root, m[1] + ".md");
  if (!fs.existsSync(md)) { console.warn("missing", md); return line; }
  return line.replace(/ links:/, ` turns: ${count(fs.readFileSync(md, "utf8"))}, links:`);
}).join("\n");
fs.writeFileSync(file, out);
