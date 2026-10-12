/**
 * Builds a single-file copy of the preview page.
 *
 * `index.html` links `../tokens.css` so the preview can't drift from the app,
 * but then only works next to that file. This script inlines the tokens and
 * writes `standalone.html`:
 *
 *     node design/preview/build-standalone.mjs
 *
 * `standalone.html` is generated; edit `index.html` or `tokens.css` and rerun.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, 'index.html'), 'utf-8');
const tokens = readFileSync(resolve(here, '../tokens.css'), 'utf-8');

const LINK = '<link rel="stylesheet" href="../tokens.css">';
if (!html.includes(LINK)) {
  throw new Error('index.html no longer links ../tokens.css; check it before building.');
}

const out = html.replace(
  LINK,
  `<style>\n/* ↓↓↓ Inlined from design/tokens.css — do not edit here ↓↓↓ */\n${tokens}\n</style>`
);

writeFileSync(resolve(here, 'standalone.html'), out);
console.log(`standalone.html: ${out.length} bytes (inlined tokens: ${tokens.length} bytes)`);
