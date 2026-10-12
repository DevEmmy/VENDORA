// Copies the tested server logic (CommonJS) into the web app as ES modules,
// so the parser and score maths have ONE source of truth: server/src.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
for (const f of ['parser.js', 'finance.js']) {
  let s = fs.readFileSync(path.join(root, '..', 'server', 'src', f), 'utf8');
  s = s.replace(/^'use strict';\n/m, '');
  s = s.replace(/module\.exports = \{([^}]*)\};?/, (_, names) => `export {${names}};`);
  s = `// GENERATED from server/src/${f} by scripts/sync-shared.mjs. Do not edit here.\n` + s;
  fs.writeFileSync(path.join(root, 'src', 'lib', f), s);
  console.log('synced', f);
}
