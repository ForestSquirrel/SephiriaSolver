// Fails the build if any local file reference in the site doesn't resolve on disk.
// Pages is case- and encoding-sensitive, so a link that works from your editor can
// still 404 once deployed.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const exts = ['.html', '.css', '.js'];
// .github holds CI scripts that are never served, and whose own source contains
// example markup that would otherwise match the patterns below.
const skipDirs = new Set(['.git', '.github', 'node_modules']);
let errors = 0;

// Local references: src="…", href="…", url(…), import "…".
// Each pattern captures the opening quote so the closing one can be matched with a
// backreference — otherwise a filename containing an apostrophe ("Beast's Heart.png")
// gets truncated at the apostrophe and reported as broken.
const patterns = [
  { re: /(?:src|href)\s*=\s*("|')(.*?)\1/g,                        group: 2 },
  { re: /url\(\s*("|')(.*?)\1\s*\)/g,                              group: 2 },
  { re: /url\(\s*([^"')]+?)\s*\)/g,                                group: 1 },
  { re: /(?:import\s+.*?from\s+|import\s*\(\s*)("|')(.*?)\1/g,     group: 2 },
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (exts.includes(path.extname(entry.name))) checkFile(full);
  }
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  for (const { re, group } of patterns) {
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(content))) {
      const ref = match[group];
      if (!ref) continue;
      // skip external, protocol-relative, anchors, and data URIs
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('#') ||
          ref.startsWith('data:') || ref.startsWith('mailto:')) continue;

      const cleanRef = ref.split('?')[0].split('#')[0];
      if (!cleanRef) continue;

      // Hrefs are URL-encoded ("Fire%20Bolt.png") but the file on disk is not.
      let decoded;
      try { decoded = decodeURIComponent(cleanRef); }
      catch { decoded = cleanRef; }   // malformed escape — check it verbatim

      if (!fs.existsSync(path.resolve(path.dirname(file), decoded))) {
        console.error(`✖ ${path.relative(ROOT, file)}: broken reference "${ref}"`);
        errors++;
      }
    }
  }
}

walk(ROOT);

if (errors > 0) {
  console.error(`\n${errors} broken local reference(s) found.`);
  process.exit(1);
} else {
  console.log('All local references resolved.');
}
