/* EVERY DROP IS A CLICK ROUTE, ON THE TABLETOP TOO — and only the pile under
 * the card lights.
 *
 * The board's rule (docs/19, 329 §4) carried off the board: a drag can do
 * nothing a tap cannot, because both end in the same function. On the
 * tabletop (ui/tabletop.ts) that function is `place()`. And the two things
 * the owner could not use in v1 — "I couldn't grab anything" (Firefox's own
 * image drag cancelled the pointer) and "the green borders were super
 * confusing" (every legal spot was outlined) — are held here:
 *
 *   §1 tabletop.ts calls the host's `commit` exactly once, inside `place`
 *   §2 the drag plan's drop calls `place(` and nothing that writes; every tap
 *      that moves a card is a `place(` too; the binder's + and » are `place(`
 *   §3 the deck page's host commits through decks.ts's `edit(` and tells the
 *      table (`tabletopChanged`); the binder never writes a deck
 *   §4 every painter defers while a card is in the air, and flushes when it lands
 *   §5 drag.ts cancels the browser's own `dragstart` for anything a provider
 *      would pick up (a capture listener, installed once) — and the scans are
 *      `draggable="false"` besides
 *   §6 no lit targets: the plan passes `targets: []`, and no target-outline
 *      class exists in the tabletop's files
 *   §7 drag.ts keeps ONE set of document listeners: a provider is a row in a list
 *
 * Source-level on purpose, as 212 and 329 are: the driver dispatches no
 * pointer moves, and these are properties of where code is allowed to be.
 * That a drag WORKS is proved in two real browsers (docs/19 § Verified).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** code only — the comments here describe the rules, and would trip them */
const code = (f: string): string => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
/** the body of `head` … up to the next top-level declaration */
function body(src: string, head: string): string {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${head} moved — this test needs updating`);
  const rest = src.slice(at + head.length);
  const end = rest.search(/\n(?:export )?(?:async )?(?:function|const|let|interface|type) /);
  return rest.slice(0, end < 0 ? undefined : end);
}

const TT = code('tabletop.ts');

test('§1 the host’s commit is called once, and only from place()', () => {
  const calls = [...TT.matchAll(/\.commit\(/g)];
  assert.equal(calls.length, 1, `tabletop.ts calls commit ${calls.length} times — place() is the one door`);
  assert.match(body(TT, 'export function place('), /h\.commit\(next\)/, 'and that one call is place()’s');
});

test('§2 a drop is a place(); so is every tap that moves a card, and the binder’s buttons', () => {
  const drop = /drop\(zone, x, y\) \{([\s\S]*?)\n {6}\},/.exec(TT);
  assert.ok(drop, 'the plan’s drop moved — this test needs updating');
  assert.match(drop![1]!, /place\(h, carry, to\)/, 'the drop calls place()');
  assert.doesNotMatch(drop![1]!, /commit|paint\(|innerHTML|\.cards\s*=/, 'and does nothing of its own');
  const click = body(TT, 'export function handleButton(');
  const put = /const put = \(to: Place\): void => \{([^\n]*)\};/.exec(click);
  assert.ok(put && /place\(h, carry, to\)/.test(put[1]!), 'the tap route’s put() is place()');
  for (const op of ['tt-to', 'tt-cut', 'tt-tomaybe', 'tt-todeck', 'tt-newpile']) {
    assert.match(click, new RegExp(`case '${op}':[\\s\\S]*?put\\(`), `the ${op} tap goes through place()`);
  }
  for (const op of ['tt-pilemove', 'tt-delpile', 'tt-resort', 'tt-undo']) {
    assert.match(click, new RegExp(`case '${op}':[\\s\\S]*?place\\(`), `${op} goes through place()`);
  }
  const binder = body(TT, 'function binderHost(');
  assert.match(binder, /add: name => \{ place\(h, \{ from: 'binder', name \}, \{ at: 'auto' \}\); \}/, 'the binder’s + is one copy through place()');
  assert.match(binder, /toMaybe: \(name: string\) => \{ place\(h, \{ from: 'binder', name \}, \{ at: 'maybe' \}\); \}/);
  assert.match(TT, /function commitRename\([\s\S]*?place\(host, null, \{ at: 'arrange', edit: \{ op: 'rename'/, 'a rename too');
});

test('§3 the deck page commits through edit(), and the binder never writes a deck', () => {
  const decks = code('decks.ts');
  const host = body(decks, 'function tabletopHost(');
  assert.match(host, /commit: next => \{[\s\S]*?edit\(d => \{[\s\S]*?tt\.tabletopChanged\(\);/,
    'the table’s commit is the page’s edit() — its save funnel — then the table repaints');
  assert.doesNotMatch(code('binder.ts'), /\.cards\s*=|scheduleSave|edit\(|commit\(/);
});

test('§4 every painter waits for the card to land, and paints when it does', () => {
  for (const f of ['tabletop.ts', 'binder.ts']) {
    const paint = body(code(f), 'function paint(');
    const defer = paint.search(/if \(dragActive\(\)\) \{ \w+ = true; return; \}/);
    const write = paint.search(/\.innerHTML\s*=/);
    assert.ok(defer >= 0, `${f} paint() must defer while dragActive() — the queue poll repaints under a drag`);
    assert.ok(write < 0 || defer < write, `${f} defers AFTER it has already written`);
  }
  const ended = /ended\(\) \{([\s\S]*?)\n {2}\},/.exec(TT);
  assert.ok(ended, 'the provider’s ended() moved');
  assert.match(ended![1]!, /if \(paintPending\) paint\(\);/);
  assert.match(ended![1]!, /flushBinder\(\);/);
  // the deck page under the table never paints while it is up (it would
  // write the deck page over the table on every drop)
  assert.match(body(code('decks.ts'), 'function paint('), /if \(tt\.screen\(\)\) return;/);
});

test('§5 the browser’s own drag is cancelled for every drag source', () => {
  const drag = code('drag.ts');
  const install = body(drag, 'export function installDrag(');
  assert.match(install, /if \(installed\) return;\s*installed = true;[\s\S]*?document\.addEventListener\('dragstart', e => \{/,
    'installed once, with the rest');
  const guard = /addEventListener\('dragstart', e => \{([\s\S]*?)\}, true\);/.exec(install);
  assert.ok(guard, 'in CAPTURE — before anything on the page can see it');
  assert.match(guard![1]!, /providers\.some\(p => p\.sourceOf\(t\)\)/, 'for whatever any provider would pick up');
  assert.match(guard![1]!, /press \|\| live/, 'and for any drag that starts while a press or a carry is on');
  assert.match(guard![1]!, /e\.preventDefault\(\)/);
  // belt and braces: nothing the table or the binder draws is natively draggable
  assert.match(code('piletable.ts'), /export const noImgDrag = /);
  assert.match(body(code('tabletop.ts'), 'function paint('), /\$app\.innerHTML = noImgDrag\(pageHtml\(host\)\);/);
  for (const f of ['tabletop.ts', 'binder.ts', 'piletable.ts']) {
    const src = code(f);
    assert.doesNotMatch(src, /draggable="true"|\.draggable = true|addEventListener\('drop'/, `${f} uses no HTML5 drag and drop`);
    // a scan is drawn only through scanHtml, which strips the native drag
    const arts = [...src.matchAll(/\bartHtml\(/g)].length;
    assert.ok(f === 'piletable.ts' ? arts === 1 : arts === 0, `${f} draws a scan around scanHtml`);
  }
  for (const w of ['binder.ts']) {
    const writes = [...code(w).matchAll(/\.innerHTML = (?!'')([^;]*);/g)].map(m => m[1]!);
    assert.ok(writes.every(x => x.startsWith('noImgDrag(')), `${w} writes markup only through noImgDrag: ${writes}`);
  }
});

test('§6 no lit targets: only the zone under the card', () => {
  assert.match(TT, /targets: \[\],/, 'the plan names no targets');
  for (const f of ['tabletop.ts', 'piletable.ts', 'binder.ts']) {
    assert.doesNotMatch(code(f), /droptarget|dttarget|dtslot/, `${f} outlines nothing`);
  }
  const drag = code('drag.ts');
  assert.match(drag, /for \(const t of plan\.targets \?\? \[\]\) t\.classList\.add\('droptarget'\);/,
    'drag.ts lights only what a plan lists');
  assert.match(drag, /over\?\(zone: Element \| null, x: number, y: number\): void;/, 'and asks the plan for its preview');
});

test('§7 drag.ts keeps one set of document listeners', () => {
  const drag = code('drag.ts');
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchmove', 'dragstart']) {
    assert.equal((drag.match(new RegExp(`addEventListener\\('${ev}'`, 'g')) ?? []).length, 1, `one ${ev} listener`);
  }
  const add = body(drag, 'export function addDragProvider(');
  assert.doesNotMatch(add, /addEventListener/, 'a provider is a row in a list, never another listener');
  assert.match(code('main.ts'), /installDrag\(\{\s*sourceOf: dragSourceOf,/, 'main.ts’s call site is unchanged');
  assert.match(TT, /addDragProvider\(provider\);/);
  // edge scroll runs on animation frames, never a re-arming timeout (a
  // headless suite would hang on one: headless-suites-and-timers)
  assert.doesNotMatch(drag.slice(drag.indexOf('function edgeLoop(')), /setTimeout\(tick/);
});
