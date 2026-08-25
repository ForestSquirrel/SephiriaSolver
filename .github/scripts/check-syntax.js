const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const skipDirs = new Set(['.git', 'node_modules']);

function findJavaScriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

let failed = false;
const files = findJavaScriptFiles(ROOT);

for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    new vm.Script(source, { filename: path.relative(ROOT, file) });
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else process.stdout.write(`Syntax OK (${files.length} files).\n`);
