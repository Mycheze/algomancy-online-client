/* 1160 — ACCESSIBLE COLOURS REACH THE ICONS (owner, 2026-11-07).
 *
 * The first cut re-pointed only the drawn colours (tokens.css's theme block),
 * and the owner switched it on and saw nothing: the element icons are the
 * game's own pictures and most of the element colour on screen. So the theme
 * swaps the three that collide (shared/10-element-chips.css) for recoloured
 * copies in data/icons/accessible/.
 *
 * §1 every swapped icon has its copy on disk, and the rule matches the URL
 *    the client really draws (ICON_BASE + "<el>.webp")
 * §2 the swap and the token block hang off the same attribute prefs.ts sets
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS_DIR } from '../../engine/scripts/paths.mjs';
import { ICON_BASE } from '../assets.ts';
import { readStyles } from './read-styles.ts';

const css = readStyles();
const SWAP = /:root\[data-colors="accessible"\] img\[src\$="\/icons\/(\w+)\.webp"\] \{ content: url\("([^"]+)"\); \}/g;

test('1160 §1 each swapped icon has its recoloured copy, at the URL the client draws', () => {
  const swaps = [...css.matchAll(SWAP)];
  assert.deepEqual(swaps.map(m => m[1]).sort(), ['earth', 'fire', 'wood'], 'the three that collide for red-green colour blindness');
  for (const [, el, url] of swaps) {
    assert.equal(url, `${ICON_BASE}accessible/${el}.webp`, `${el}: under ICON_BASE`);
    assert.ok(existsSync(join(ICONS_DIR, 'accessible', `${el}.webp`)), `${el}: the copy is on disk`);
    assert.ok(existsSync(join(ICONS_DIR, `${el}.webp`)), `${el}: positive control, the original`);
  }
  // the rule matches the src the client writes
  const src = `${ICON_BASE}fire.webp`;
  assert.ok(src.endsWith('/icons/fire.webp'), 'elIcon\'s src ends the way the selector expects');
});

test('1160 §2 the icon swap and the colour tokens key on the attribute prefs.ts sets', () => {
  const prefs = readFileSync(new URL('../prefs.ts', import.meta.url), 'utf8');
  assert.match(prefs, /ds\['colors'\] = 'accessible'/);
  assert.match(css, /:root\[data-colors="accessible"\] \{/, 'the token block');
});
