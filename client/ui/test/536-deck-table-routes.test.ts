/* EVERY DROP IS A CLICK ROUTE, ON THE DECK TABLE TOO (ui/decktable.ts).
 *
 * The board's rule (docs/19, 329 §4) carried off the board: a drag can do
 * nothing a tap cannot, because both end in the same function. Here that
 * function is `place()`, and these are the claims that keep it the only door:
 *
 *   §1 decktable.ts calls the host's `commit` exactly once, inside `place`
 *   §2 the drag provider's drop calls `place(` and nothing that writes
 *   §3 the drawer's + and » are `place(` calls; the constructed host's
 *      `commit` goes through decks.ts's `edit(` (its save funnel)
 *   §4 every painter that draws a table, and the drawer, defers while a card
 *      is in the air — derived from who imports decktable.ts and calls
 *      `tableHtml(`, so the challenge
 *      builder is held to it the moment it draws one
 *   §5 drag.ts keeps ONE set of document listeners: a provider is a row in a
 *      list, never another listener
 *
 * Source-level on purpose, as 212 and 329 are: the driver dispatches no
 * pointer events, and these are properties of where code is allowed to be.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** code only — the comments here describe the rules, and would trip them */
const code = (f: string): string => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
/** the body of `function name(` … up to the next top-level declaration */
function body(src: string, head: string): string {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${head} moved — this test needs updating`);
  const rest = src.slice(at + head.length);
  const end = rest.search(/\n(?:export )?(?:function|const|let|interface|type) /);
  return rest.slice(0, end < 0 ? undefined : end);
}

const TABLE = code('decktable.ts');

test('§1 the host’s commit is called once, and only from place()', () => {
  const calls = [...TABLE.matchAll(/\.commit\(/g)];
  assert.equal(calls.length, 1, `decktable.ts calls commit ${calls.length} times — place() is the one door`);
  const place = body(TABLE, 'export function place(');
  assert.match(place, /h\.commit\(next\)/, 'and that one call is place()’s');
  // nothing else in the file reaches the host's state another way
  assert.doesNotMatch(TABLE.replace(place, ''), /\bh\.commit\b/);
});

test('§2 a drop is a place(), and nothing else', () => {
  const drop = /drop\(zone, x, y\) \{([\s\S]*?)\n {6}\},/.exec(TABLE);
  assert.ok(drop, 'the provider’s drop moved — this test needs updating');
  assert.match(drop![1]!, /place\(h, carry, to\)/, 'the drop calls place()');
  assert.doesNotMatch(drop![1]!, /commit|setView|repaint|\.cards\s*=/, 'and does nothing of its own');
  // the taps reach the same function: tableClick's moves are place() calls
  const click = body(TABLE, 'export function tableClick(');
  for (const op of ['to', 'less', 'more', 'tomaybe', 'cut', 'putback', 'putallback', 'undo', 'delpile']) {
    assert.match(click, new RegExp(`case '${op}'[\\s\\S]*?place\\(`), `the ${op} tap goes through place()`);
  }
});

test('§3 the drawer adds through place(); the deck page commits through edit()', () => {
  const decks = code('decks.ts');
  const drawerHost = body(decks, 'function drawerHost(');
  assert.match(drawerHost, /add: name => \{ dt\.place\(tableHost\(\), \{ name, from: \{ at: 'drawer' \} \}, dt\.defaultPlace\(tableHost\(\)\)\)/,
    'a + in the drawer is a drop on the table, one copy (owner, Q2)');
  assert.match(drawerHost, /toMaybe: name => \{ dt\.place\(/, 'and » is a drop on the Maybe zone');
  const host = body(decks, 'function tableHost(');
  assert.match(host, /commit: next => \{\s*edit\(d => \{/, 'the table’s commit is the page’s edit() — its save funnel');
  assert.match(host, /setView: v => edit\(/, 'and so is the view it remembers');
  // the drawer never writes the deck itself
  assert.doesNotMatch(code('deckdrawer.ts'), /\.cards\s*=|scheduleSave|edit\(/);
});

test('§4 every painter that draws a table, and the drawer, waits for the card to land', () => {
  const painters = readdirSync(UI).filter(f => f.endsWith('.ts') && f !== 'decktable.ts')
    .filter(f => /from '\.\/decktable\.ts'/.test(code(f)) && /\btableHtml\(/.test(code(f)));
  assert.ok(painters.includes('decks.ts'), `expected the deck page to draw the table — found [${painters.join(', ')}]`);
  for (const f of [...painters, 'deckdrawer.ts']) {
    const src = code(f);
    const paint = body(src, 'function paint(');
    const defer = paint.search(/if \(dragActive\(\)\) \{ \w+ = true; return; \}/);
    const write = paint.search(/\.innerHTML\s*=/);
    assert.ok(defer >= 0, `${f} paint() must defer while dragActive() — the queue poll repaints under a drag`);
    assert.ok(write < 0 || defer < write, `${f} defers AFTER it has already written`);
  }
  // and the deferred paint is flushed when the card lands
  assert.match(TABLE, /ended\(\) \{ active\?\.dragEnded\?\.\(\); flushDrawer\(\); \}/);
  assert.match(code('decks.ts'), /dragEnded: \(\) => \{ if \(paintPending\) paint\(\); \}/);
});

test('§5 drag.ts keeps one set of document listeners', () => {
  const drag = code('drag.ts');
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchmove']) {
    assert.equal((drag.match(new RegExp(`addEventListener\\('${ev}'`, 'g')) ?? []).length, 1, `one ${ev} listener`);
  }
  const install = body(drag, 'export function installDrag(');
  assert.match(install, /if \(installed\) return;\s*installed = true;/, 'installed once, however often it is called');
  const add = body(drag, 'export function addDragProvider(');
  assert.doesNotMatch(add, /addEventListener/, 'a provider is a row in a list, never another listener');
  // main.ts's call site is unchanged (329 §5 reads it)
  assert.match(code('main.ts'), /installDrag\(\{\s*sourceOf: dragSourceOf,/);
  assert.match(TABLE, /addDragProvider\(provider\);/);
});
