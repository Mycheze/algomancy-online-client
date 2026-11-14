/* 1379 · THE HOST'S RESULT SHEET SAYS WHO IT IS PICKING (pages/cube.ts, 56-cube.css) — the Chrome
 * walk of 2026-11-14: the sheet "QA Tester vs Sim Cleo" drew its four choices as one row of a
 * 320px sheet, cut to "QA …", "Sim…", "Draw", "No …" — the host could not tell who they picked.
 *
 *   §1 the choices are one under another (the segmented control stacked, each option its own
 *      line), in a wider sheet; each label is the whole name, 40 characters and all, and the two
 *      winners differ even where the names share a long beginning
 *   §2 the stylesheet: stacked, and an option's text wraps instead of being cut with an ellipsis —
 *      and these rules come after the component's own, so they are the ones that hold
 *
 * Seeds: none. DOM-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml } from '../pages/cube.ts';
import { readStyles } from './read-styles.ts';
import { eventView, match, pageView, PLAYERS, tagOf } from './cube-fixture.ts';

const A = 'Alexandria Montgomery-Featherstonehaugh I';   // 40+ characters
const B = 'Alexandria Montgomery-Featherstonehaugh II';
const players = PLAYERS.map((p, i) => (i === 0 ? { ...p, name: A } : i === 3 ? { ...p, name: B } : p));
const long = match('r2p1', 2, 0, 3, 'waiting', { a: { user: 'u1', name: A }, b: { user: 'u4', name: B } });
const sheetOf = (): string => {
  const e = eventView('playing', { players });
  const html = cubeHtml(pageView({ event: { ...e, matches: e.matches.map(m => (m.pairing === 'r2p1' ? long : m)) },
    sheet: { kind: 'result', pairing: 'r2p1' } }));
  const at = html.indexOf('id="cube-result"');
  assert.ok(at >= 0, 'positive control: the sheet is drawn');
  return html.slice(html.lastIndexOf('<div', at));
};
const labelOf = (html: string, outcome: string): string => {
  const tag = tagOf(html, 'cube-result', `data-outcome="${outcome}"`);
  assert.ok(tag, `the ${outcome} choice`);
  const at = html.indexOf(tag) + tag.length;
  return html.slice(at, html.indexOf('</button>', at));
};

test('§1 stacked, in a wider sheet, every name whole', () => {
  assert.ok(A.length >= 40 && B.length >= 40);
  const html = sheetOf();
  assert.match(html, /^<div class="ui-sheet [^"]*ui-sheet--md/, 'the md sheet, not the 320px one');
  assert.match(html, /class="ui-segmented ui-segmented--full cuberesult"/, 'the choices are the stacked group');
  assert.equal(labelOf(html, 'u1'), `${A} wins`);
  assert.equal(labelOf(html, 'u4'), `${B} wins`);
  assert.notEqual(labelOf(html, 'u1'), labelOf(html, 'u4'));
  assert.equal(labelOf(html, 'draw'), 'Draw');
  assert.equal(labelOf(html, 'clear'), 'No result');
});

/** the declarations of the rule whose selector is exactly `sel` (the last one, as the cascade has it) */
function rule(css: string, sel: string): { body: string; at: number } {
  let at = -1, body = '';
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim()).includes(sel)) { at = m.index; body = m[2]!; }
  }
  return { body, at };
}

test('§2 the stylesheet stacks them and wraps a long name', () => {
  const css = readStyles();
  const group = rule(css, '.cuberesult.ui-segmented--full');
  assert.match(group.body, /flex-direction:\s*column/, 'one under another');
  const opt = rule(css, '.cuberesult .ui-segmented__option');
  assert.match(opt.body, /white-space:\s*normal/, 'a long name wraps');
  assert.match(opt.body, /flex:\s*none/, 'each its own height, not a share of a row');
  assert.match(opt.body, /text-overflow:\s*clip/, 'never cut with an ellipsis');
  const own = rule(css, '.ui-segmented--full .ui-segmented__option');
  assert.ok(own.at >= 0 && opt.at > own.at, 'after the component’s rules: these hold');
  assert.ok(group.at > rule(css, '.ui-segmented--full').at);
});
