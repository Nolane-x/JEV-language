import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../packages/manifest.json", import.meta.url), "utf8");
const manifest = JSON.parse(raw);
const packages = manifest.packages;
const names = new Set(Object.keys(packages));
const errors = [];

for (const [name, meta] of Object.entries(packages)) {
  for (const dep of meta.dependencies) {
    if (!names.has(dep)) {
      errors.push(`${name}: unknown dependency ${dep}`);
      continue;
    }
    const target = packages[dep];
    if (target.layer > meta.layer) {
      errors.push(`${name}: dependency ${dep} points upward (${meta.layer} -> ${target.layer})`);
    }
    if (meta.maturity === "stable" && target.maturity === "prototype") {
      errors.push(`${name}: stable package may not depend on prototype ${dep}`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function visit(name) {
  if (visiting.has(name)) {
    const at = stack.indexOf(name);
    errors.push(`dependency cycle: ${[...stack.slice(at), name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  stack.push(name);
  for (const dep of packages[name].dependencies) visit(dep);
  stack.pop();
  visiting.delete(name);
  visited.add(name);
}

for (const name of names) visit(name);

if (errors.length > 0) {
  console.error("Package-boundary violations:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Package DAG valid: ${names.size} packages, no forbidden cycles.`);
