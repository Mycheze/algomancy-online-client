/*
 * Report #359 (CT-548) — "When a unit is modded, the mod sorta cuts off the
 * \"damage\" -X red badge so you can't read it unless you zoom in".
 *
 * A table card's red −N damage marker (`.dmg`, main.ts cardHtml) is drawn at
 * the bottom-left of the face. A modded card hangs its mod strips right under
 * that foot (`.card.modded`, a two-row grid), and the strips come AFTER the
 * marker in the markup, with a shadow layer at `z-index: 1`. Painted in markup
 * order, an unlifted marker loses every overlap with them — and with the next
 * card of an invader pile or a fanned row, which also come later.
 *
 * The guard: the marker is lifted above the strips' layer, stays under a pick
 * verb (which must stay clickable over it), and nothing later in the cascade
 * takes the lift back off a table card's marker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readStyles } from './read-styles.ts';

/** every `{…}` body of a rule whose selector list contains exactly `sel` */
function bodies(css: string, sel: string): string[] {
  const out: string[] = [];
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}\\n,])\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) out.push(m[1]!);
  return out;
}

function zOf(body: string): number | undefined {
  const m = /(?:^|;|\s)z-index:\s*(-?\d+)/.exec(body);
  return m ? Number(m[1]) : undefined;
}

test('the damage marker is drawn above the mod strips of a modded unit', () => {
  const css = readStyles();
  const dmg = bodies(css, '.card .dmg');
  assert.ok(dmg.length >= 1, '.card .dmg is in the stylesheet');
  const zs = dmg.map(zOf).filter((z): z is number => z !== undefined);
  assert.ok(zs.length >= 1, '.card .dmg sets a z-index');
  const z = zs[zs.length - 1]!;

  const strip = bodies(css, '.fieldmods .modstrip::before').map(zOf).filter((n): n is number => n !== undefined);
  assert.ok(strip.length >= 1, 'the mod strips\' shadow layer is where this test expects it');
  assert.ok(z > Math.max(...strip), `the marker (z ${z}) is above the strips' layer (z ${Math.max(...strip)})`);

  const pick = bodies(css, '.card .picktag').map(zOf).filter((n): n is number => n !== undefined);
  assert.ok(pick.length >= 1);
  assert.ok(z < Math.min(...pick), 'a pick verb still sits over the marker');
});

test('no later rule takes the lift off the damage marker of a table card', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]*\.dmg[^{}]*)\{([^}]*)\}/g)) {
    const sel = m[1]!.trim();
    if (/#cardzoom/.test(sel)) continue;            // the zoom's own dice row, not the table
    if (!/\.dmg\b/.test(sel)) continue;             // `.tbdmg` (the text box's line) is not the marker
    const z = zOf(m[2]!);
    if (z !== undefined) assert.ok(z >= 2, `${sel} drops the marker to z ${z}`);
    assert.doesNotMatch(m[2]!, /position:\s*(static|relative)/, `${sel} unplaces the marker`);
  }
});
