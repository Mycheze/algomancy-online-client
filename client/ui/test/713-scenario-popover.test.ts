/* 713 — A SCENARIO ROOM'S PANEL IS A POPOVER OFF THE TOOLBAR (board round 8,
 * plan §P4).
 *
 * The scenario runner's panel (ui/scenario.ts panelHtml: the brief, the four
 * verdict buttons, the optional detail) took the old rail's middle. The rail
 * is a 50px toolbar now, so the panel is behind its 🧪 button, drawn to the
 * strip's left. The tester must read the brief before anything else, so it is
 * OPEN on a scenario's first paint; ✕ (or 🧪) puts it away, and it stays as
 * the tester left it through every push of the same scenario — every push
 * carries the brief, and a push must not reopen what was just closed. A NEW
 * scenario opens it again.
 *
 * It is not a dialog: no scrim, nothing modal, the board stays playable beside
 * it — so it is not one of the board's overlays (test/269's census counts the
 * modal scrim class across ui/*.ts; this adds none).
 *
 * Driven through the real client (test/ui-driver.ts). The panel's box beside
 * the strip, open by default at 1920x1080, 1344x768 and 1024x768 (touch), was
 * checked in headless Chrome on the board8-* review boards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

const brief = (id: string): Record<string, unknown> => ({
  id, card: 'Good Whale', why: 'a review board', expect: 'LOOK: the whale.\nTRY: pass.',
  clauses: ['Piercing'], verdicts: ['works', 'broken', 'slightly-off', 'bad-scenario'],
  needsLiveOpponent: false, opponentSeated: false, actionIndex: 0, engine: 'abcdef0123456789',
});

const h = new Harness(71300, ['Ann', 'Bo']);
toDeployment(h);
const S = h.state as GameState;
const LEGAL = legalActions(S, 0) as Action[];
const push = (id: string): string => ui.update(S, LEGAL, { scenario: brief(id) });
const pop = (html: string): string | null => {
  const at = html.indexOf('<div class="scnpop tbpop">');
  return at < 0 ? null : html.slice(at);
};

test('an ordinary room has no 🧪 and no panel', () => {
  const html = ui.join(S, 0, LEGAL);
  assert.doesNotMatch(html, /data-btn="scn-pop"|class="scnpanel"/);
});

test('a scenario\'s first paint opens the panel beside the toolbar, brief and verdicts in it', () => {
  const html = push('q-one');
  assert.match(html, /<button data-btn="scn-pop" class="on" aria-expanded="true"\s+title="[^"]+">🧪<\/button>/, '🧪 is on the toolbar, lit');
  const p = pop(html);
  assert.ok(p, 'the popover is open on first load');
  assert.ok(html.indexOf('<div class="scnpop tbpop">') > html.indexOf('<div class="side toolbar">'), 'it is the toolbar\'s own popover');
  assert.match(p, /<div class="scnexpect"><div>LOOK: the whale\.<\/div><div>TRY: pass\.<\/div><\/div>/, 'the brief');
  for (const v of ['works', 'broken', 'slightly-off', 'bad-scenario']) {
    assert.match(p, new RegExp(`data-btn="scn-verdict" data-verdict="${v}"`), `the ${v} verdict`);
  }
  assert.match(p, /<button class="scnx" data-btn="scn-popx" title="[^"]+">✕<\/button>/, 'and its own ✕');
  assert.doesNotMatch(p.slice(0, p.indexOf('</div>')), /class="overlay/, 'not a modal dialog');
});

test('✕ puts it away; a push of the same scenario leaves it shut; 🧪 (click or tap) brings it back', () => {
  push('q-one');
  assert.equal(pop(ui.click({ btn: 'scn-popx' })), null, '✕ closes it');
  assert.equal(pop(push('q-one')), null, 'every push carries the brief — and does not reopen it');
  assert.match(ui.html(), /data-btn="scn-pop" class="" aria-expanded="false"/, '🧪 stays on the toolbar, unlit');
  assert.ok(pop(ui.tap({ btn: 'scn-pop' })), 'a tap on 🧪 opens it');
  assert.equal(pop(ui.click({ btn: 'scn-pop' })), null, 'and a click on 🧪 closes it again');
});

test('a NEW scenario opens it again', () => {
  push('q-one');
  if (pop(ui.html())) ui.click({ btn: 'scn-popx' });
  assert.equal(pop(ui.html()), null);
  assert.ok(pop(push('q-two')), 'the next scenario\'s brief is the first thing shown');
});

test('typing in it then a push: it stays open, and it is the rail\'s own panel (whose boxes are rewired after every paint)', () => {
  push('q-two');
  if (!pop(ui.html())) ui.click({ btn: 'scn-pop' });
  ui.click({ btn: 'scn-detail' });
  ui.type('scn-note', 'the whale did not pierce');
  push('q-two');
  assert.ok(pop(ui.html()), 'still open');
  assert.match(read('../main.ts'), /\$\{NET && scnPop \? `<div class="scnpop tbpop">\$\{scn\.panelHtml\(NET\.room, true\)\}<\/div>` : ''\}/,
    'the popover is the same panel (scn.panelHtml), whose boxes rewireInputs puts back after every paint');
});

test('the stylesheet: beside the strip, above the board, under every dialog — and under ⋯', () => {
  const CSS = read('../style.css');
  assert.match(CSS, /#app\.board\.v2 > \.toolbar > \.scnpop \{ top: 0; width: min\(340px, calc\(100vw - 70px\)\);/);
  assert.match(CSS, /#app\.board\.v2 > \.toolbar > \.scnpop \{ z-index: 58; \}/);
  assert.match(CSS, /\.toolbar \.tbpop \{ position: absolute; right: calc\(100% \+ 4px\); z-index: 59;/);
});
