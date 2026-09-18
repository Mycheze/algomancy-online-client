/* R297 — the Learn to Play window and menu, as the HTML they paint.
 *
 * The ui-driver cannot hover or query the DOM, so the builders are pure and
 * this reads their output:
 *
 *   §1 no scrim carries the board's overlay class (269 would count it as a
 *      board overlay, and main.ts reads a click on one as "close the dialog")
 *   §2 card names become hover links that name a real card; unknown names stay text
 *   §3 every page of every lesson renders, with the judge box and the right footer
 *   §4 the end lesson's choices appear on its last page only
 *   §5 the main.ts hooks exist: the socket seam, the ?learn=play branch, the tick,
 *      the context-carrying judge request
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../engine/src/index.ts';
import { lessonInline, pillHtml, windowHtml } from '../lessonlayer.ts';
import { menuHtml } from '../learnmenu.ts';
import { ALL_LESSONS, END, GAME_LESSONS } from '../lessons.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const model = (lesson = GAME_LESSONS[0]!, page = 0) => ({ lesson, page, ctx: null, judge: [], judgeBusy: false, judgeDraft: '' });

test('§1 no Learn to Play scrim uses the board overlay class', () => {
  const html = [windowHtml(model()), menuHtml(null, 'fire'), pillHtml('x')].join('');
  assert.doesNotMatch(html, /class="[^"]*\boverlay\b/);
  assert.match(html, /class="lessonscrim"/);
  assert.match(html, /class="learnscrim"/);
});

test('§2 [[card]] becomes a hover link to a real card; an unknown name stays plain text', () => {
  const html = lessonInline('Look at [[Prismite]] and [[the dormant side|Dormant Resource]] and [[Not A Card]].');
  assert.match(html, /<a class="lcard" data-lcard="Prismite">Prismite<\/a>/);
  assert.match(html, /data-lcard="Dormant Resource">the dormant side<\/a>/);
  assert.doesNotMatch(html, /data-lcard="Not A Card"/);
  assert.match(html, /Not A Card/);
  assert.doesNotMatch(lessonInline('<img src=x onerror=alert(1)>'), /<img src=x/, 'text is escaped');
});

test('§3 every page of every lesson renders with the judge box and a way on', () => {
  for (const l of [...GAME_LESSONS, ...ALL_LESSONS]) {
    l.pages.forEach((_, i) => {
      const html = windowHtml(model(l, i));
      assert.equal(/id="ljudge-q"/.test(html), !l.compact, `${l.id} p${i}: a judge box, except on a compact nudge`);
      assert.match(html, /data-lbtn="min"/, `${l.id} p${i}: can be hidden`);
      const last = i === l.pages.length - 1;
      assert.equal(/data-lbtn="next"/.test(html), !last, `${l.id} p${i}: next unless last`);
      assert.equal(/data-lbtn="done"/.test(html), last, `${l.id} p${i}: done on the last page`);
    });
  }
});

test('§4 the end-of-game choices replace "Got it" on the end lesson\'s last page', () => {
  const actions = [{ btn: 'learn-new', label: 'New game', primary: true }];
  const last = windowHtml({ ...model(END, END.pages.length - 1), actions });
  assert.match(last, /data-lbtn="learn-new"/);
  assert.doesNotMatch(last, /data-lbtn="done"/);
});

test('§5 main.ts carries the hooks', () => {
  assert.match(MAIN, /this\.ws = openSocket\(/, 'NetBackend opens its socket through the seam');
  assert.match(MAIN, /params\.get\('learn'\) === 'play'/, 'the ?learn=play branch');
  assert.match(MAIN, /lessonTick\(\);/, 'the tick after each paint');
  assert.match(MAIN, /installLessonLayer\(/);
  assert.match(MAIN, /installLearnMenu\(\);/);
  assert.match(MAIN, /data-learn="menu"/, 'the home screen opens the menu');
  assert.match(MAIN, /JSON\.stringify\(context \? \{ question, context \} : \{ question \}\)/, 'the judge request carries the lesson');
});

test('§6 the round-2 figures render: anatomy anchors, step frames, formations, mods, greyed and crossed cards', async () => {
  const { figureHtml, pageHtml } = await import('../lessonlayer.ts');
  const anat = figureHtml({ kind: 'anatomy', card: 'Static Courier', parts: { cost: [7, 7.5], type: [25, 83.5] } });
  assert.match(anat, /id="lanc-cost" style="left:7%;top:7.5%"/, 'an anchor per part, placed on the card');
  assert.match(lessonInline('{{part:cost|Mana cost}}'), /<span class="lpart" data-lpart="cost">Mana cost<\/span>/, 'the words that point at it');
  const steps = figureHtml({ kind: 'frames', play: 'step', frames: [
    { figure: { kind: 'cards', cards: ['Prismite'] }, caption: 'one **bold**' },
    { figure: { kind: 'cards', cards: ['Shard Resource'] }, caption: 'two' },
  ] });
  assert.match(steps, /data-play="step" data-playing="0" data-i="0" data-n="2"/, "a step figure starts paused");
  for (const b of ['frame-prev', 'frame-play', 'frame-next']) assert.match(steps, new RegExp(`data-lbtn="${b}"`), `step figures have ${b}`);
  const loop = figureHtml({ kind: 'frames', play: 'loop', frames: [{ figure: { kind: 'cards', cards: ['Prismite'] }, caption: 'a' }] });
  assert.match(loop, /data-playing="1"/, 'a loop starts playing');
  assert.match(loop, /data-lbtn="frame-play"/, 'and can be paused');
  assert.match(steps, /<strong>bold<\/strong>/, 'captions are markdown');
  assert.equal((steps.match(/class="lframe on"/g) ?? []).length, 1, 'one frame shown at a time');
  const form = figureHtml({ kind: 'formation', attacker: 'theirs', theirs: [['Unit Token'], ['Unit Token', 'Unit Token']], yours: [[{ name: 'Prismite', cross: true }], []] });
  assert.match(form, /lfigcard cross/);
  assert.match(form, /no blocker/, 'an empty blocking slot says so');
  const at = (re: RegExp) => form.search(re);
  assert.ok(at(/your opponent — attacking/) < at(/class="lfline"/) && at(/class="lfline"/) < at(/you — blocking/), 'their side above the middle line, yours below');
  // every row is one cell per column, so columns line up across the line
  const grids = [...form.matchAll(/<div class="lfgrid" style="--cols:2">([\s\S]*?)<\/div>\s*(?=<div class="lf(line|side))/g)];
  assert.ok(grids.length >= 2, 'a grid on each side');
  for (const g of grids) assert.equal((g[1]!.match(/class="lfcell"/g) ?? []).length % 2, 0, 'whole rows of cells');
  const mod = figureHtml({ kind: 'modded', host: 'Static Courier', mods: ['Hooba-Nan', 'Sparkwraith'], reads: 'it now reads this' });
  assert.equal((mod.match(/class="lmod"/g) ?? []).length, 2, 'every mod tucked under the host');
  assert.match(mod, /It now reads/);
  assert.match(figureHtml({ kind: 'cards', cards: [{ name: 'Prismite', dim: true, label: 'not yet' }] }), /lfigcard dim/);
  // citations are tucked away, collapsed
  const page = pageHtml({ title: 't', body: 'b', quotes: [{ text: 'q', source: 'Manual, p. 1' }] }, null);
  assert.match(page, /<details class="lcites">/);
  assert.doesNotMatch(page, /<details class="lcites" open/);
});

test('§7 the lessons never talk about the bot', () => {
  for (const l of [...GAME_LESSONS, ...ALL_LESSONS]) {
    for (const [i] of l.pages.entries()) {
      assert.doesNotMatch(windowHtml(model(l, i)), /Tutorial Bot|the bot\b/i, `${l.id} p${i}`);
    }
  }
  assert.doesNotMatch(menuHtml(null, 'fire'), /Tutorial Bot/i, 'nor the menu');
});
