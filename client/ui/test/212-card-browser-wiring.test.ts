/**
 * The card browser's wiring, asserted over the SOURCE.
 *
 * ui/cards.ts is a painting layer: it builds strings and hands them to
 * `$app.innerHTML`. There is no fake DOM in this repo that reaches it
 * (`test/ui-driver.ts` drives main.ts only), so the things worth guarding here
 * are not pixels — they are the three claims the design rests on, each of
 * which is a grep away from being false and none of which any other test
 * would notice breaking:
 *
 *   1. ONE PREDICATE. The deck drawer and the browser both go through
 *      ui/cardsearch.ts. The drawer used to own a private filter; that is the
 *      drift this replaced, and a future edit could quietly reintroduce it.
 *   2. ONE SAVE FUNNEL. The browser reaches the open deck only through the
 *      bridge, so BL-14's debounce rules still hold. Direct access would look
 *      like it worked and would lose a cut inside the 500ms window.
 *   3. THE HELP SHEET IS GENERATED. It prints KEYS/FLAGS, so it cannot claim a
 *      filter that does not exist — which is exactly what a hand-written cheat
 *      sheet does six months later.
 *
 * Same idea as 147-comment-conformance: assert the property the comments claim,
 * over the file, rather than trusting that it stays true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { FLAGS, KEYS, search } from '../cardsearch.ts';
import { allRows } from '../cardindex.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** Comments SAY what the code must not do — "goes through edit() ->
 * scheduleSave()" is in ui/cards.ts's header on purpose — so a forbidden-token
 * check has to read the code only, or the documentation fails the test that
 * documents it. */
const code = (f: string): string => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the deck drawer and the browser share one predicate', () => {
  const decks = read('decks.ts');
  const cards = read('cards.ts');
  assert.match(decks, /from '\.\/cardsearch\.ts'/, 'the drawer must use the shared parser');
  assert.match(cards, /from '\.\/cardsearch\.ts'/, 'so must the browser');
  // the private filter this replaced, in the shape it had
  assert.doesNotMatch(decks, /let searchEl\b/, 'the drawer grew its own element filter again');
  assert.doesNotMatch(decks, /let searchKind\b/, 'the drawer grew its own kind filter again');
  assert.doesNotMatch(decks, /name\.toLowerCase\(\)\.includes\(q\)/, 'the drawer grew its own substring matcher again');
});

test('the drawer offers only what is deck-legal, and says the whole pool is elsewhere', () => {
  const decks = read('decks.ts');
  assert.match(decks, /allRows\(\)\.filter\(r => r\.playable\)/, 'the drawer pool must be the legal subset');
  assert.match(decks, /data-btn="deck-browse"/, 'the drawer must offer the full browser');
  // and the claim that makes that honest: the browser really does have more
  assert.ok(allRows().length > allRows().filter(r => r.playable).length);
});

test('the browser reaches the open deck only through the bridge', () => {
  const cards = code('cards.ts');
  // it must not know the deck page exists
  assert.doesNotMatch(cards, /from '\.\/decks\.ts'/, 'the browser must not import the deck page');
  for (const forbidden of ['scheduleSave', 'flushSave', '\\bdecks\\b\\s*=', 'd\\.cards\\s*=']) {
    assert.doesNotMatch(cards, new RegExp(forbidden), `the browser touched deck state directly (${forbidden})`);
  }
  for (const via of ['bridge?.add(', 'bridge?.remove(', 'bridge?.toMaybe(']) {
    assert.ok(cards.includes(via), `every edit goes through the bridge — missing ${via}`);
  }
  // and the bridge on the other side goes through the one funnel
  const decks = read('decks.ts');
  const bridgeBody = decks.slice(decks.indexOf('function bridgeToOpenDeck'), decks.indexOf('// ── clicks'));
  assert.ok(bridgeBody.length > 100, 'bridgeToOpenDeck moved — this test needs updating');
  for (const m of bridgeBody.matchAll(/^\s{4}(add|remove|toMaybe):/gm)) {
    const line = bridgeBody.slice(bridgeBody.indexOf(m[0]));
    assert.match(line.split('\n')[0]!, /edit\(/, `${m[1]} must go through edit()`);
  }
});

test('the deck page does not paint underneath the browser', () => {
  // The browser opens ON TOP of the deck page and leaves it `open`, so every
  // edit made through the bridge reaches decks.ts's paint(). Without the guard
  // that is two writes to #app per click, the first of them the wrong page.
  // Measured over CDP at 6 writes for 3 clicks before this, 3 after.
  const decks = read('decks.ts');
  const body = decks.slice(decks.indexOf('function paint(): void {'));
  const head = body.slice(0, body.indexOf('$app.classList.remove'));
  assert.match(head, /if \(cb\.screen\(\)\) return;/,
    'decks.ts paint() must yield to the card browser before it writes anything');
});

test('the help sheet is printed from the parser tables, so it cannot claim a filter that does not exist', () => {
  const cards = read('cards.ts');
  assert.match(cards, /KEYS\.map\(/, 'the filter table must be generated');
  assert.match(cards, /FLAGS\.map\(/, 'the is: list must be generated');
  // …and every example in it answers, which is what makes generating it worth
  // anything. (210 asserts this too; repeated here because THIS is the file
  // that claims the sheet is trustworthy.)
  // `class:all` because the sheet documents the LANGUAGE; the browser's
  // implicit card filter is a separate thing, and the count line says when it
  // has narrowed a result (see 210 on is:colorless)
  for (const d of KEYS) {
    if (d.key === 'copies' || d.key === 'in') continue;
    assert.ok(search(`${d.example} class:all`).total > 0,
      `the help sheet shows "${d.example}", which finds nothing`);
  }
  for (const f of FLAGS) {
    if (f.flag === 'deck' || f.flag === 'maybe') continue;
    assert.ok(search(`is:${f.flag} class:all`).total > 0,
      `the help sheet lists is:${f.flag}, which finds nothing`);
  }
});

test('main.ts checks the browser before the deck page, because it opens on top of it', () => {
  const main = read('main.ts');
  const cardsAt = main.indexOf('if (cb.screen())');
  const decksAt = main.indexOf('if (dk.screen())');
  assert.ok(cardsAt > 0 && decksAt > 0, 'both pages must be dispatched from renderHome');
  assert.ok(cardsAt < decksAt, 'the deck page would swallow the browser opened from it');
  assert.match(main, /if \(cb\.handleButton\(btn\)\) return;/, 'cards- buttons must be dispatched');
  assert.match(main, /cb\.initCards\(/, 'the browser must be initialised');
});

test('nothing in the engine imports the browse catalogue', () => {
  // catalogue.json is browse data. The engine's trusted printed data is
  // printed.json, and widening that boundary for a UI feature is exactly what
  // the second file exists to avoid.
  const src = join(dirname(fileURLToPath(import.meta.url)), '../../engine/src');
  const walk = (dir: string): string[] => {
    return readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  };
  for (const f of walk(src)) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /catalogue\.json/, `${f} imports the browse catalogue`);
  }
});

test('the rail offers the seven kinds, the three boxes, and scrolls a long section', () => {
  // Owner, 2026-09-05. "Kind and timing ... should have: Unit, Spell, Token,
  // Deployment Only, Haste, Battle, Virus" and "Printed deck: only Base Game,
  // Kickstarter Exclusive, Light vs Dark". The chips are derived in facets(),
  // which is private to the page, so this pins the source it derives from.
  const cards = read('cards.ts');
  for (const label of ['Unit', 'Spell', 'Token', 'Deployment only', 'Haste', 'Battle', 'Virus']) {
    assert.match(cards, new RegExp(`'${label}'`), `the kind section must offer ${label}`);
  }
  assert.doesNotMatch(cards, /section: 'kind', label: 'spellunit'/, 'spell units are not their own chip');
  assert.match(cards, /facetValues\(r => \[r\.release\], rows\)/, 'the printed-deck chips are the three releases');
  assert.doesNotMatch(cards, /facetValues\(r => \[r\.set\], rows\)/, 'not the thirty-five printed decks');
  // every card is in exactly one box
  const boxes = new Map<string, number>();
  for (const r of allRows()) boxes.set(r.release, (boxes.get(r.release) ?? 0) + 1);
  assert.deepEqual([...boxes.keys()].sort(), ['base', 'kickstarter', 'lightdark']);
  // and the long sections (Attributes, Mechanics, Subtypes) scroll inside
  // themselves rather than running off the bottom of a viewport-high rail
  const css = read('style.css');
  const chips = css.match(/\.cbchips \{[^}]*\}/)?.[0] ?? '';
  assert.match(chips, /max-height/, '.cbchips needs a max-height');
  assert.match(chips, /overflow-y: auto/, '.cbchips must scroll');
});
