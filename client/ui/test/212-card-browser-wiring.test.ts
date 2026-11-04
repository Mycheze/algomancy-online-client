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
 *   2. THE BROWSER BUILDS NOTHING. Its deckbuilding mode (a bridge a deck lent
 *      it, add/cut on every tile) was retired in BL-65: decks are built on the
 *      builder's pool, through the table's one door. The browser must not
 *      grow a way back into a deck's state.
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
import { readStyles } from './read-styles.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** Comments SAY what the code must not do — "goes through edit() ->
 * scheduleSave()" is in ui/cards.ts's header on purpose — so a forbidden-token
 * check has to read the code only, or the documentation fails the test that
 * documents it. */
const code = (f: string): string => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// BL-65: the deck page's add drawer is gone; the builder's pool (ui/tabletop.ts) is what searches beside a deck now
test('the builder\'s pool and the browser share one predicate', () => {
  const decks = read('tabletop.ts');
  const cards = read('cards.ts');
  assert.match(decks, /from '\.\/cardsearch\.ts'/, 'the pool must use the shared parser');
  assert.match(cards, /from '\.\/cardsearch\.ts'/, 'so must the browser');
  // the private filter this replaced, in the shape it had
  assert.doesNotMatch(decks, /let searchEl\b/, 'the drawer grew its own element filter again');
  assert.doesNotMatch(decks, /let searchKind\b/, 'the drawer grew its own kind filter again');
  assert.doesNotMatch(decks, /name\.toLowerCase\(\)\.includes\(q\)/, 'the drawer grew its own substring matcher again');
});

test('the pool offers only what is deck-legal', () => {
  // BL-65: the drawer's "browse all cards" went with the drawer; the pool's More filters sheet replaces it
  const decks = read('tabletop.ts');
  assert.match(decks, /allRows\(\)\.filter\(r => r\.playable\)/, 'the pool must be the legal subset');
  // and the claim that makes that honest: the browser really does have more
  assert.ok(allRows().length > allRows().filter(r => r.playable).length);
});

test('the browser builds no deck: no bridge, no add/cut, no deck state', () => {
  const cards = code('cards.ts');
  // it must not know the deck page exists
  assert.doesNotMatch(cards, /from '\.\/decks\.ts'/, 'the browser must not import the deck page');
  for (const forbidden of ['scheduleSave', 'flushSave', '\\bdecks\\b\\s*=', 'd\\.cards\\s*=']) {
    assert.doesNotMatch(cards, new RegExp(forbidden), `the browser touched deck state directly (${forbidden})`);
  }
  // BL-65: deckbuilding mode is retired, and with it the bridge and its buttons and keys
  for (const f of ['cards.ts', 'pages/cards.ts']) {
    assert.doesNotMatch(code(f), /\bbridge\b|DeckBridge|useDeck|cards-(?:add|less|maybe|toDeck)\b/, `${f} has a deckbuilding mode again`);
  }
  assert.doesNotMatch(code('cards.ts'), /case '\+'|case '-'|case '='/, 'the + / - keys built a deck');
  // the deck page no longer lends the browser a bridge (bridgeToOpenDeck is gone; the builder's pool
  // adds through the table's one door), so no deck can be edited from the browser any more
  for (const f of ['decks.ts', 'tabletop.ts', 'challenge.ts']) {
    assert.doesNotMatch(code(f), /useDeck\(/, `${f} handed the browser a deck again`);
  }
});

test('the deck page does not paint underneath the browser', () => {
  // The browser opens ON TOP of the deck page and leaves it `open`, so every
  // edit made through the bridge reaches decks.ts's paint(). Without the guard
  // that is two writes to #app per click, the first of them the wrong page.
  // Measured over CDP at 6 writes for 3 clicks before this, 3 after.
  const decks = read('decks.ts');
  const body = decks.slice(decks.indexOf('function paint(): void {'));
  const head = body.slice(0, body.indexOf('paintDecks('));
  assert.match(head, /if \(cb\.screen\(\)\) return;/,
    'decks.ts paint() must yield to the card browser before it writes anything');
});

test('the help sheet is printed from the parser tables, so it cannot claim a filter that does not exist', () => {
  // the sheet is drawn by the page module (pages/cards.ts) since the design-system round; its body is
  // pages/cardfilters.ts syntaxHelpHtml since BL-65 (the builder's pool prints the same one)
  const cards = read('pages/cardfilters.ts');
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
  // which is private to the page, so this pins the source it derives from
  // (pages/cards.ts since the design-system round, pages/cardfilters.ts since BL-65).
  const cards = read('pages/cardfilters.ts');
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
  const css = readStyles();
  const chips = css.match(/\.cbchips \{[^}]*\}/)?.[0] ?? '';
  assert.match(chips, /max-height/, '.cbchips needs a max-height');
  assert.match(chips, /overflow-y: auto/, '.cbchips must scroll');
});
