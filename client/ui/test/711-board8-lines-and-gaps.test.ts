/* BOARD ROUND 8 — "MORE TABLE" (owner and invi, 2026-10-27; docs/18 § Board
 * round 8). The chrome took space from the battlefield and made the eye
 * travel: 6–10px between every box, a phase bar at the top edge far from the
 * hand, an info block in a corner of each region. This pins phases P1–P3:
 *
 * §1 the gaps are 1–2px tokens on :root, and the TS mirrors say the same
 * §2 each player's info is ONE line, in the owner's order, with no deck line
 *    and no cache column when the cache is empty — and no top bar
 * §3 the phase icons sit in my line: the step lit, the battle's steps as
 *    pips, the turn in a numeral and in the caption; the icons are files
 *    reached through ICON_BASE
 * §4 the ring is a layer beside the board, and my tint runs on behind the
 *    action bar and the hand; the dock lost its accent edge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { ICONS_DIR } from '../../engine/scripts/paths.mjs';
import { client } from './ui-driver.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('../style.css');
const LAYOUT = read('../layout.ts');
const MAIN = read('../main.ts');
const ui = await client();

const h = new Harness(71101);
const PLAN = structuredClone(h.state);
toDeployment(h);
const a1 = spawn(h, 0, 'Good Whale');
spawn(h, 1, 'Rune Channeler');
toNextBattle(h, 0);
h.do({ type: 'declareAttack', seat: 0, columns: [[a1]] });
pass(h); pass(h);
const BLOCKS = structuredClone(h.state);
const paint = (s: GameState, seat: Seat = 0): string => ui.join(s, seat, legalActions(s, seat));
/** the markup of one info line */
const line = (html: string, side: 'mine' | 'theirs'): string => {
  const at = html.indexOf(`<div class="linfo ${side}`);
  assert.ok(at >= 0, `no ${side} info line`);
  const end = side === 'theirs' ? html.indexOf('<div class="lplay ', at) : html.indexOf('class="actionbar"', at);
  return html.slice(at, end);
};
/** the order of the line's cells */
const cells = (l: string): string[] =>
  [...l.matchAll(/<div class="(lres|phicons|lend|lbin|lcache|lid|lspect)\b/g)].map(m => m[1]!);

test('§1 the gaps are 1–2px tokens, and the TS mirrors move with the CSS', () => {
  assert.match(CSS, /:root \{[^}]*--gap: 2px; --gap-tight: 1px;/);
  assert.match(CSS, /#app\.board\.v2 \{ gap: var\(--gap\); padding: var\(--gap\);/);
  assert.match(CSS, /\.lboard \{[^}]*gap: var\(--gap\);/);
  // the cards keep clear of the ring by the blocks' padding, not the gaps:
  // the 2.5px stroke and its glow stand inside the tint's edge
  const pad = Number(/--ringpad: (\d+)px;/.exec(CSS)?.[1]);
  assert.ok(pad >= 4, `--ringpad ${pad}px clears the ring's 2.5px stroke`);
  assert.match(CSS, /\.linfo, \.lplay, \.linv, \.lfight \{[^}]*padding: var\(--ringpad\);/);
  // the battle columns: the gap and each column's padding + 1px border, a side
  const colGap = /\.lboard \.lfight\.focus \.cols \{ gap: var\(--gap\); \}/.test(CSS) ? 2 : NaN;
  const colPad = Number(/\.lboard \.lfight\.focus \.col \{ padding: (\d+)px; \}/.exec(CSS)?.[1]);
  const [, gap, chrome] = /const COL_GAP = (\d+), COL_CHROME = (\d+);/.exec(LAYOUT) ?? [];
  assert.equal(Number(gap), colGap, 'COL_GAP is the .cols gap');
  assert.equal(Number(chrome), 2 * (colPad + 1), 'COL_CHROME is a column\'s padding and border, both sides');
  const fan = Number(/\.cols > \.col \+ \.col \{ margin-left: calc\(var\(--fanstep\) - var\(--cw\) - (\d+)px\); \}/.exec(CSS)?.[1]);
  assert.equal(fan, Number(gap) + Number(chrome), 'the battle fan steps by chrome + gap');
  assert.match(read('../fit.ts'), /const OUTER_GAPS = 3;/, 'between the lines: band · row · fight · row · band, the fight over two of the middle three');
});

test('§2 one line per player, in the owner\'s order; no deck line; no top bar', () => {
  const html = paint(PLAN);
  // mine, left to right: resources · phase icons · bin · cache · name and
  // life (the last three one cell, so the icons can stand in the middle)
  assert.deepEqual(cells(line(html, 'mine')), ['lres', 'phicons', 'lend', 'lbin', 'lcache', 'lid']);
  // theirs mirrored, no phase icons (this driver's state is not redacted,
  // so their whole hand shows, as a spectator's would: right after the name)
  assert.deepEqual(cells(line(html, 'theirs')), ['lid', 'lspect', 'lcache', 'lbin', 'lres']);
  // a player sees their card backs under the name instead
  const hidden = structuredClone(PLAN);
  hidden.players[1]!.hand = hidden.players[1]!.hand.map(() => '__HIDDEN__');
  const backs = line(paint(hidden), 'theirs');
  assert.deepEqual(cells(backs), ['lid', 'lcache', 'lbin', 'lres']);
  assert.match(backs, /<div class="lid"><div class="lidtop">[\s\S]*?<div class="lhand"><span class="minihand"/);
  assert.doesNotMatch(html, /class="binline"/, 'the always-on deck line is gone');
  assert.doesNotMatch(html, /class="topbar"/, 'the top bar is gone on this board');
  // the resources take what is left: a fit zone of their own
  assert.match(line(html, 'mine'), /<div class="lres" data-fit="res">/);
  // the cache keeps its slot when empty (owner, 2026-10-27: "a stable slot
  // even when empty, so things don't jump") — a placeholder with nothing to
  // open; with a card in it, the real one
  assert.match(line(html, 'mine'), /<div class="lcache"><div class="regioncache cempty">/);
  assert.doesNotMatch(line(html, 'mine'), /data-btn="cacheopen"/);
  const e = new E(structuredClone(PLAN));
  e.cacheFromHand(0, 0);
  assert.match(line(paint(e.s), 'mine'), /<div class="lcache"><div class="regioncache[^"]*" data-btn="cacheopen"/);
  // the slots are as wide as they need whatever they hold, thumbs sized off
  // the line's content height; the label is master's plain zone label, beside
  // the thumbs, not a pill on them (audit, board round 8)
  assert.match(CSS, /\.linfo \.regionbin \{ --binth: clamp\(18px, calc\(\(100cqh - 6px\) \/ 1\.4\), 48px\); \}/);
  assert.match(CSS, /\.linfo \.regioncache \{ --cacheth: clamp\(22px, calc\(100cqh \/ 1\.4\), 48px\);\s*grid-template-columns: auto calc\(3 \* var\(--cacheth\) \+ 12px \+ 22px\); \}/);
  assert.match(CSS, /grid-template-areas: "lbl fan" "hint fan";/);
  assert.doesNotMatch(CSS, /\.linfo \.regionbin > \.zonelabel, \.linfo \.regioncache > \.zonelabel \{[^}]*position: absolute/);
  // the phase icons in the window's middle: the line is three tracks, the
  // right one never narrower than the bin, cache and name
  assert.match(CSS, /\.linfo\.mine > \.lin \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto minmax\(max-content, 1fr\); \}/);
  // the turn and the initiative live on: the caption, the ⭐
  assert.match(html, new RegExp(`aria-label="[^"]*Turn ${PLAN.turn}\\b`));
  assert.match(MAIN, /\$\{toolGameHtml\(\)\}/, 'the draft elements and the chips are a badge on the toolbar (P4, test/712)');
});

test('§3 the phase icons: the step lit, the battle\'s steps as pips, the icons served from ICON_BASE', () => {
  const plan = line(paint(PLAN), 'mine');
  assert.match(plan, /<span class="phi plan cur">/, 'planning is lit');
  assert.equal((plan.match(/class="phi [a-z0-9]+ cur"/g) ?? []).length, 1, 'one icon lit');
  const battle = line(paint(BLOCKS), 'mine');
  assert.match(battle, /<span class="phi battle1 cur">/, 'battle round 1 is lit');
  assert.match(battle, /<span class="phpips"><i class="done"><\/i><i class="on"><\/i><i class=""><\/i><i class=""><\/i><\/span>/,
    'at blocks: attack done, blocks on, damage and after to come');
  assert.match(battle, /aria-label="Battle · round 1 · [^"]*· Turn \d+/);
  for (const m of plan.matchAll(/<img src="\/data\/icons\/([^"]+)"/g)) {
    assert.ok(existsSync(join(ICONS_DIR, m[1]!)), `${m[1]} is in data/icons`);
  }
  for (const f of ['planning.svg', 'draft.svg', 'regroup.svg', 'deploy.svg']) {
    const svg = readFileSync(join(ICONS_DIR, f), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 125 125">/, `${f}: the existing icons' 125px box`);
    assert.doesNotMatch(svg.replace(/#fff\b|#000\b/g, ''), /#[0-9a-f]{3,6}/i, `${f}: flat white, nothing else`);
  }
  assert.doesNotMatch(MAIN.slice(MAIN.indexOf('function phaseIconsHtml')), /^[^\n]*'\/data\/icons/m, 'never a spelled path');
});

test('§4 the ring is a layer beside the board; my tint runs on behind the bar and the hand', () => {
  const html = paint(PLAN);
  const board = html.slice(html.indexOf('class="lboard'), html.indexOf('class="actionbar"'));
  assert.doesNotMatch(board, /class="lring/);
  assert.match(html, /<svg class="lring rc\d" data-ring="bottom"/);
  assert.match(html, /<div class="ltail rc\d" aria-hidden="true">/);
  assert.match(CSS, /#app\.board\.v2 > \.lring \{ position: fixed;/);
  assert.match(CSS, /#app\.board\.v2 > \.ltail \{ grid-column: 1; grid-row: 2 \/ -1; z-index: -1;/);
  assert.match(CSS, /#app\.board\.v2 \.handdock \{ background: transparent; border-top: 0;/, 'the dock\'s accent edge is gone');
  assert.match(LAYOUT, /roundedPath\(pts, 8, !top\)/, 'my region\'s ring is the open one');
});
