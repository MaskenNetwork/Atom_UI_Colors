'use strict';
// Reproducible catalog from Microsoft's unmodified codiconsLibrary.ts/codicons.ts.
// Usage: node scripts/update-codicons.cjs library.ts derived.ts <VS Code commit>
const fs = require('node:fs');
const path = require('node:path');
function fromSources(sources) {
  const icons = {}, properties = {}, firstGlyph = new Map();
  for (const source of sources) for (const match of source.matchAll(/([\w$]+):\s*register\('([^']+)',\s*(0x[\da-f]+|'[^']+')\)/gi)) {
    const [, property, id, value] = match;
    properties[property] = id;
    if (value.startsWith("'")) icons[id] = value.slice(1, -1);
    else {
      const glyph = parseInt(value, 16);
      icons[id] = firstGlyph.get(glyph) || null;
      if (!firstGlyph.has(glyph)) firstGlyph.set(glyph, id);
    }
  }
  return {icons, properties};
}
if (require.main === module) {
  const [library, derived, commit] = process.argv.slice(2);
  if (!library || !derived || !/^[a-f0-9]{10,40}$/.test(commit || '')) throw new Error('Supply both official source files and their commit.');
  const catalog = {source: 'https://github.com/microsoft/vscode', commit, ...fromSources([fs.readFileSync(library, 'utf8'), fs.readFileSync(derived, 'utf8')])};
  fs.writeFileSync(path.join(__dirname, '../assets/codicons.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Cataloged ${Object.keys(catalog.icons).length} built-in Codicons.`);
}
module.exports = {fromSources};
