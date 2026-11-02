/* `npm run build`, the CSS half: styles/ → bundle.css.
 *
 * bundle.css is GENERATED and gitignored, like bundle.js. The sources are the
 * pieces under styles/, in the order styles/index.css lists them; this writes
 * their byte-for-byte concatenation (ui/scripts/styles.mjs says why it is not
 * esbuild). It also refuses a styles/ directory holding a `.css` file the
 * order file does not list: a piece nobody imports is CSS that silently
 * never reaches the page. */
import { writeFileSync } from 'node:fs';

import { BUNDLE_CSS } from '../../engine/scripts/paths.mjs';
import { concatStyles, stylesOnDisk, stylesOrder } from './styles.mjs';

const listed = new Set(stylesOrder());
const stray = stylesOnDisk().filter(p => !listed.has(p));
if (stray.length) {
  console.error(`build-css: styles/ has pieces that styles/index.css does not list: ${stray.join(', ')}`);
  process.exit(1);
}
const css = concatStyles();
writeFileSync(BUNDLE_CSS, css);
console.log(`build-css: ${listed.size} pieces → bundle.css (${Buffer.byteLength(css)} bytes)`);
