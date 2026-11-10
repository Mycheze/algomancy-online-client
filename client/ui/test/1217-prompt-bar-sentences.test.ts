/* 1217 — a prompt bar's sentence is one piece, and it says something.
 *
 * The owner, 2026-11-10 (#steward, with a screenshot of the block bar reading
 * "assign blockers (   click   unit, then slot)"): "The text here telling you
 * what to do is totally messed up and nonsensical".
 *
 * Two faults. The bar is a wrapping flex row with a 12px gap, so the loose
 * text and every inline element in it — the click/tap word is two spans, one
 * of them hidden — were separate flex items, each 12px from the next. And
 * "slot" is a word only the code uses: the spaces on the board say "front"
 * and "back". Every sentence now goes through one wrapper (main.ts barMsg).
 *
 * The check below reads the bar's TOP-LEVEL children: a run of text standing
 * next to an inline element (other than the name tag and the buttons) is a
 * sentence the flex row has split.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const VOID = new Set(['img', 'input', 'br', 'hr', 'wbr']);
const INLINE = new Set(['span', 'b', 'i', 'em', 'strong', 'img', 'kbd', 'code', 'a', 'small', 'abbr']);

type Child = { kind: 'text'; text: string } | { kind: 'el'; tag: string; open: string };

/** the prompt bar's direct children (text runs and elements, in order) */
function barChildren(html: string): Child[] {
  const at = html.indexOf('class="promptbar');
  assert.ok(at >= 0, 'no prompt bar');
  const from = html.indexOf('>', at) + 1;
  const out: Child[] = [];
  let depth = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>|[^<]+/g;
  re.lastIndex = from;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [tok, close, tagRaw, selfClose] = m;
    if (tagRaw === undefined) {
      if (depth === 0) out.push({ kind: 'text', text: tok });
      continue;
    }
    const tag = tagRaw.toLowerCase();
    if (close) {
      if (depth === 0) return out;   // the bar's own </div>
      depth--;
      continue;
    }
    if (depth === 0) out.push({ kind: 'el', tag, open: tok });
    if (!VOID.has(tag) && !selfClose) depth++;
  }
  return out;
}

/** each place a sentence is split: loose text beside a loose inline element */
function splitSentences(html: string): string[] {
  const kids = barChildren(html).filter(k => k.kind === 'el' || k.text.trim());
  const loose = (k: Child | undefined): boolean => !!k && k.kind === 'el'
    && INLINE.has(k.tag) && !/class="(who|barmsg|blockrefusal)/.test(k.open);
  const bad: string[] = [];
  kids.forEach((k, i) => {
    if (k.kind !== 'text') return;
    if (loose(kids[i - 1]) || loose(kids[i + 1])) bad.push(k.text.trim());
  });
  return bad;
}

/** the text a player reads, the touch half dropped (a mouse sees "click") */
const readable = (html: string): string => html
  .replace(/<span class="touchonly">[^<]*<\/span>/g, '')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function blockBar(seed: number): { html: string; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 10 && h.state.battle?.step !== 'blocks'; g++) h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.battle?.step, 'blocks', 'the premise: blocks are being declared');
  return { html: ui.join(h.state, D, legalActions(h.state, D)), D };
}

test('the block bar says what to do in plain words, as one sentence', () => {
  const { html } = blockBar(121701);
  const at = html.indexOf('class="promptbar');
  const bar = html.slice(at, html.indexOf('data-btn="confirmblocks"', at));
  assert.match(readable(bar.slice(bar.indexOf('>') + 1)),
    /: choose your blockers — click one of your units, then a front or back space; you may also send units to counterattack/);
  assert.doesNotMatch(bar, /slot\)|\(\s*<span class="mouseonly">/, 'no "(click unit, then slot)"');
  assert.deepEqual(splitSentences(html), [], 'no text run stands beside a loose inline element');
});

test('the attack bar wraps its sentence, all-must-attack note included', () => {
  // the attack bar's `what` carries a .remind span — the same split, once wrapped
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(src, /<span class="who">\$\{esc\(s\.players\[b\.attacker\]!\.name\)\}:<\/span> \$\{barMsg\(what\)\}/);
});

test('no prompt bar sentence built from a decision prompt sits loose in the bar', () => {
  // iconizeText turns [Battle], {Haste} … into inline icons: loose in the bar,
  // each icon would be a flex item 12px from the words around it
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const loose = src.split('\n').map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => /(class=\"who\">.*<\/span> |^\s*)\$\{iconizeText\(/.test(l));
  assert.deepEqual(loose.map(([n, l]) => `${n}: ${l.trim()}`), []);
});

test('the splitter sees the fault it guards (the bar as it was)', () => {
  const was = `<div class="promptbar"><span class="who">mycheze:</span>
    assign blockers (<span class="mouseonly">click</span><span class="touchonly">tap</span> unit, then slot)
    <button class="primary">Confirm Blocks</button></div>`;
  assert.deepEqual(splitSentences(was), ['assign blockers (', 'unit, then slot)']);
});
