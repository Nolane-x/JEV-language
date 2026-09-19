import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packagesRoot = path.join(repoRoot, "packages");
const raw = await readFile(path.join(packagesRoot, "manifest.json"), "utf8");
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
      errors.push(
        `${name}: dependency ${dep} points upward (${meta.layer} -> ${target.layer})`,
      );
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

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) output.push(full);
  }
  return output;
}

const importPattern =
  /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

for (const packageName of names) {
  const packageDir = path.join(packagesRoot, packageName);
  let files = [];
  try {
    files = await walk(packageDir);
  } catch {
    continue;
  }
  const declared = new Set(packages[packageName].dependencies);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier?.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const relative = path.relative(packagesRoot, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const targetPackage = relative.split(path.sep)[0];
      if (
        targetPackage &&
        targetPackage !== packageName &&
        names.has(targetPackage) &&
        !declared.has(targetPackage)
      ) {
        errors.push(
          `${packageName}: undeclared package import ${targetPackage} in ${path.relative(repoRoot, file)}`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Package-boundary violations:");
  for (const error of [...new Set(errors)].sort()) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Package DAG/import boundaries valid: ${names.size} packages, no forbidden cycles or undeclared package imports.`,
);
