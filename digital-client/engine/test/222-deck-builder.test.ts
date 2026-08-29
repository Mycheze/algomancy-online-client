/* THE DECK BUILDER, AS A THING YOU CAN ACTUALLY USE.
 *
 * The owner, 2026-08-29:
 *
 *   "the recent tweaks to showing multiple cards stacked in the deck viewers
 *    TOTALLY broke the deckbuilder page. The implementation didn't do a good
 *    job at all so it's basically unusable now. And the cards are weirdly
 *    greyed out, for some reason. […] Adding, removing, tweaking, searching
 *    should all be nice and smooth for the user."
 *
 * ── ⚠ WHAT "BASICALLY UNUSABLE" ACTUALLY WAS, MEASURED IN A BROWSER ──
 *
 * Three faults, and the WORST of them is not a layout fault at all:
 *
 *  1. THE CONTROLS WERE UNDER THE ART. A stacked tile positions its front card
 *     at `z-index: 2`; `.dkbtns` is positioned with `z-index: auto`, so on
 *     every two-of the art painted over the buttons. `elementFromPoint` at the
 *     centre of `−` returned the <img>, whose `data-btn` is `deck-focus` — so
 *     −, » and ★ on a two-of pinned the card panel instead of doing their job.
 *     In a constructed deck nearly every card is a two-of, so that is nearly
 *     every control on the page. §3 guards it.
 *  2. THE GRID COULD NOT PACK. `grid-column: span 2` on a stacked tile in a
 *     `repeat(auto-fill, minmax(112px, 1fr))` grid: rows went ragged, auto-fill
 *     left holes, and `.dkbtns`/`.dkn` — positioned against the TILE — hung
 *     121.1px past the card they belong to. Measured: a 9-column add drawer
 *     running 8/9/9/9/9/8/8. §1 and §2 guard it.
 *  3. THE GREY WAS EVERYWHERE. `atCap` gated both the withheld `+` and the
 *     greying, so a 30-card deck of two-ofs rendered 15 tiles out of 15 in
 *     greyscale. §5 guards the split.
 *
 * And the felt half of the report, which is not any of those: every `+`
 * repaints the whole page, and the repaint threw the viewport 537px up the
 * document because `wire()` re-focused the search box every time. §6.
 *
 * ── HOW THESE ARE GUARDED ──
 *
 * The geometry lives in CSS, which is why nothing in the suite saw any of it
 * ship. So the CSS is PARSED — selector by selector, derived from the file
 * rather than from a list typed here — and the rules that matter are read out
 * of it. The browser measurements that justify each number are in the commit
 * message; these are the guards that keep them true.
 *
 * Seeds: none — this file reads source, it does not play.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..', 'ui');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
const CSS = read('style.css');

/** comments stripped, so a rule quoted inside prose is never mistaken for one */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { sel: string; body: string }

/** every `selector { … }` in the stylesheet, comments already gone */
const RULES: Rule[] = [...CSS_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1]!.replace(/\s+/g, ' ').trim(), body: m[2]!.replace(/\s+/g, ' ').trim() }))
  .filter(r => r.sel.length > 0 && !r.sel.startsWith('@'));

/** the declared value of `prop` in a rule, or null */
const decl = (r: Rule, prop: string): string | null => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(r.body);
  return m ? m[1]!.trim() : null;
};

/** every rule whose selector mentions any of these classes */
const rulesFor = (...classes: string[]): Rule[] =>
  RULES.filter(r => classes.some(c => new RegExp(`\\.${c}\\b`).test(r.sel)));

/* ══ §1 a tile is one grid cell, always ══════════════════════════════════ */

test('§1a no deck tile is ever given more than one grid track', () => {
  // ⚠ THIS IS THE REGRESSION. `.dktile.dkstack { grid-column: span 2 }` made a
  // stacked tile twice as wide as an unstacked one, and `.dkgrid` is
  // `repeat(auto-fill, minmax(112px, 1fr))` — a track list that cannot pack a
  // mixture of one- and two-track items. Rows went ragged and auto-fill left
  // holes, worst in the add drawer where the two widths are interleaved.
  //
  // The list of rules is DERIVED from the stylesheet, so a span smuggled onto
  // `.dkstack`, `.dktile`, `.iscover` or anything else that lands on a tile is
  // caught by the same assertion.
  const offenders = rulesFor('dktile', 'dkstack')
    .filter(r => decl(r, 'grid-column') !== null || decl(r, 'grid-column-end') !== null);
  assert.deepEqual(offenders.map(r => r.sel), [],
    'a tile that spans two tracks cannot be packed by auto-fill, and the grid goes ragged');
});

test('§1b a stacked tile keeps the same box as an unstacked one', () => {
  // `aspect-ratio: auto` was the other half of the widening: it let the tile
  // take whatever height its contents wanted, so rows stopped sharing a
  // baseline. Every tile has to be the same shape or the grid is not a grid.
  const base = rulesFor('dktile').find(r => decl(r, 'aspect-ratio') !== null);
  assert.ok(base, '.dktile must declare an aspect ratio');
  assert.notEqual(decl(base!, 'aspect-ratio'), 'auto');
  const undone = rulesFor('dkstack').filter(r => decl(r, 'aspect-ratio') === 'auto');
  assert.deepEqual(undone.map(r => r.sel), [],
    'a stacked tile that drops the aspect ratio stops sharing a row with its neighbours');
});

/* ══ §2 the pile is reserved INSIDE the cell, and it is legible ══════════ */

/** the two custom properties the whole geometry is derived from */
const stepDecl = rulesFor('dktile').map(r => decl(r, '--dkstep')).find(v => v !== null) ?? null;
const depthDecl = rulesFor('dktile').map(r => decl(r, '--d')).find(v => v !== null) ?? null;

test('§2a one copy shows an edge you can count, and it is a fraction of the cell', () => {
  // ⚠ THE HISTORY THIS NUMBER CARRIES. The first version offset the copies
  // 4.5px, and the owner could not tell a two-of from a one-of: *"the stacked
  // cards are so closely stacked together that it's impossible to tell which
  // ones are two ofs and which are just single cards."* The fix for that gave
  // the CELL away instead, which is §1. The offset is now a fraction of the
  // TILE, so it scales with the grid instead of being a pixel guess — at the
  // 112-128px this grid runs at, 13% is 15-17px of visible edge per copy.
  assert.ok(stepDecl, 'the layer offset must be a named custom property, not scattered literals');
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(stepDecl!);
  assert.ok(pct, `--dkstep must be a PERCENTAGE of the cell, not a pixel nudge — got ${stepDecl}`);
  assert.ok(Number(pct![1]) >= 10,
    `each copy must show at least a tenth of the cell — got ${stepDecl}. A pixel nudge is not a `
    + 'smaller version of this feature, it is the absence of it');
  assert.equal(depthDecl, '0', '.dktile must default the depth, so an unstacked tile is unaffected');
});

test('§2b the whole pile fits the cell, because the layers shrink by the depth', () => {
  // The arithmetic that keeps a stack from ever touching its neighbour: a
  // layer is (100% − d·step) and ghost i sits at i·step, so the backmost
  // ghost's far corner lands exactly on the cell's corner. Both halves have to
  // reference BOTH variables or the pile stops closing.
  const sized = rulesFor('dkstack').filter(r => /--d\b/.test(decl(r, 'width') ?? ''));
  assert.ok(sized.length > 0, 'the layers must be sized from the stack depth');
  for (const r of sized) {
    for (const prop of ['width', 'height']) {
      const v = decl(r, prop) ?? '';
      assert.match(v, /calc\(\s*100%\s*-\s*var\(--d\)\s*\*\s*var\(--dkstep\)\s*\)/,
        `${r.sel} { ${prop} } must shrink by the whole reserved depth, or the pile overflows the cell`);
    }
  }
  const stepped = rulesFor('dkghostwrap').filter(r => /--i\b/.test(r.body));
  assert.ok(stepped.length > 0, 'the ghosts must step by their own index');
  for (const r of stepped) {
    assert.match(r.body, /var\(--i\)\s*\*\s*var\(--dkstep\)/,
      `${r.sel} must step by --i * --dkstep, so the offset and the reserved room are one number`);
  }
});

/* ══ §3 the controls are ON the front card, and ON TOP of it ════════════ */

/** the layer a rule puts its subject on, `auto` read as 0 */
const zOf = (r: Rule): number => {
  const v = decl(r, 'z-index');
  return v === null || v === 'auto' ? 0 : Number(v);
};

test('§3a the buttons sit above the art, or the click lands on the card', () => {
  // ⚠ THE WORST OF THE REPORT, AND NOTHING THAT READS MARKUP COULD SEE IT. The
  // buttons were emitted, were the right size and were in the right place —
  // they were simply underneath. Measured over CDP on the shipped build:
  // elementFromPoint at the centre of − on a two-of returned the <img>, and
  // the nearest [data-btn] was `deck-focus`. So − pinned a card panel.
  const front = rulesFor('dkstack').filter(r => />\s*\.dkart\b/.test(r.sel) && decl(r, 'z-index'));
  assert.ok(front.length > 0, 'the front card must declare its own layer');
  const artZ = Math.max(...front.map(zOf));
  for (const cls of ['dkbtns', 'dkn', 'dkname']) {
    const onStack = rulesFor('dkstack').filter(r => new RegExp(`\\.${cls}\\b`).test(r.sel));
    assert.ok(onStack.length > 0, `a stacked tile must place its .${cls}`);
    assert.ok(onStack.some(r => zOf(r) > artZ),
      `.${cls} must sit above the front card (z-index > ${artZ}) or the art swallows the click`);
  }
});

test('§3b the buttons and the badge are pulled in to the front card', () => {
  // `.dkbtns` and `.dkn` are positioned against the TILE, and on a stack the
  // front card is inset from the tile by the depth. Left at the tile edge they
  // hang over the mat beside the pile — the 121px overhang of the two-track
  // version, in miniature.
  for (const cls of ['dkbtns', 'dkn']) {
    const rules = rulesFor('dkstack').filter(r => new RegExp(`\\.${cls}\\b`).test(r.sel));
    assert.ok(rules.some(r => /var\(--d\)\s*\*\s*var\(--dkstep\)/.test(decl(r, 'right') ?? '')),
      `.${cls} on a stack must pull its right edge in by the depth, so it ends where the card does`);
  }
});

/* ══ §4 every surface that draws a stack hands over the depth ═══════════ */

/**
 * The ui modules that draw a PILE — derived from the file that owns the rule
 * (they ask ui/decklayout.ts for the layers), so a third surface growing a
 * stacked tile is caught without this list being edited. `ui/cards.ts` draws
 * the same `.dktile` in the browser but never stacks it: one row is one card
 * there, and it correctly does not appear here.
 */
const STACK_PAGES = readdirSync(UI)
  .filter(f => f.endsWith('.ts'))
  .filter(f => /class="dktile/.test(read(f)) && /stackLayers\(/.test(read(f)));

test('§4a every page that draws a stack hands the CSS the stack depth', () => {
  // The geometry is derived from --d rather than cased on a copy count, so a
  // page that forgets to write it renders every pile at depth 0 — the layers
  // land exactly on top of each other and the stack silently vanishes. That is
  // the same shape of fault as patching a style into "<img ": invisible until
  // somebody looks at the one card it breaks.
  assert.ok(STACK_PAGES.length >= 2,
    `expected the builder and the shared page to draw stacks — found [${STACK_PAGES.join(', ')}]`);
  for (const f of STACK_PAGES) {
    assert.match(read(f), /--d:\$\{layers\.length\}/,
      `${f} must write the stack depth onto the tile, or its piles collapse to one card`);
  }
});

test('§4b a card with no scan still stacks, because the ghost and the front are one helper', () => {
  // ⚠ artHtml returns an <img> for a card with art and a <div class="cbnoart">
  // for one without. A version of this feature patched a style attribute into
  // "<img " and did nothing at all on an artless card. The wrapper is what
  // carries the offset now, and BOTH the ghost and the front card have to come
  // out of the same call or the two paths can drift apart again.
  const meta = read('meta.ts');
  const whole = meta.slice(meta.indexOf('function deckTile('), meta.indexOf('function deckGrid('));
  assert.ok(whole.length > 100, 'deckTile moved — this test needs updating');
  // the comments here QUOTE the trap, so the code is read without them
  const fn = whole.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(fn, /const art = \(cls: string\)[^\n]*cbnoart/,
    'one helper answers "what does this card look like", art or no art');
  assert.equal((fn.match(/\bart\('dkart'\)/g) ?? []).length, 2,
    'the ghost and the front card must both come from it — one call each');
  assert.doesNotMatch(fn, /<img /, 'deckTile must not hand-roll an <img>: that is the artless hole');
});

/* ══ §5 the grey belongs to the drawer ══════════════════════════════════ */

const decksSrc = read('decks.ts');
const tileFn = decksSrc.slice(decksSrc.indexOf('function tile('), decksSrc.indexOf('function groupedTiles('));

test('§5a the cap withholds the plus everywhere, and greys only where you are shopping', () => {
  // ⚠ BL-34 ASKED FOR BOTH SIGNALS AND THE OWNER HAS SINCE SPLIT THEM. The
  // requirement — "you already have two of this, and the page said so before
  // you added a third" — is unchanged and is still carried by the withheld +
  // and, over the cap, by the red number. What changed is that the GREY is a
  // sentence about shopping: in the drawer it answers the question you are
  // asking, and in the deck it colours a whole deck of two-ofs grey for no
  // reason. Measured: 15 of 15 tiles.
  assert.ok(tileFn.length > 100, 'tile() moved — this test needs updating');
  assert.match(tileFn, /const atCap = where !== 'maybe' && n >= 2;/,
    'the cap itself is unchanged: two copies, anywhere you can add one');
  const grey = /const (\w+) = atCap && where === 'add';/.exec(tileFn);
  assert.ok(grey, 'the greying must be a SEPARATE flag, true only in the add drawer');
  assert.match(tileFn, new RegExp(`\\$\\{${grey![1]!} \\? ' atcap' : ''\\}`),
    'and it must be what writes the atcap class');
  assert.doesNotMatch(tileFn, /\$\{atCap \? ' atcap' : ''\}/,
    'the cap flag must not write the grey class again');
});

test('§5b the grey is a dimming, not a disabling', () => {
  // it has to read as "nothing more to take here" and not as "broken", so:
  // dimmed art, ordinary border, and the over-cap tile keeps its colour
  // because its red border and red number are the message there.
  const greyed = rulesFor('atcap').filter(r => decl(r, 'filter') !== null);
  assert.ok(greyed.length > 0, 'the atcap tile must dim its art');
  for (const r of greyed) {
    assert.doesNotMatch(r.body, /pointer-events|opacity: 0|display: none/,
      `${r.sel} disables the tile — the cap is an affordance, not a gate`);
  }
  assert.ok(greyed.some(r => /overcap/.test(r.sel) && decl(r, 'filter') === 'none'),
    'an over-cap tile keeps its colour: the red border and the red number are the signal there');
});

/* ══ §6 an edit does not move the page under the cursor ═════════════════ */

test('§6a a repaint puts the scroll and the caret back where they were', () => {
  // Every edit rewrites the whole of #app — one write, ~19ms, which is not the
  // problem. The problem is PLACE: the new tree has no scroll and no focus.
  // Measured before this: adding one card from the drawer threw the page 537px
  // up the document, so the card you clicked was no longer under the cursor.
  assert.match(decksSrc, /const was = perch\(\);/, 'paint must record where you were, first');
  const paintFn = decksSrc.slice(decksSrc.indexOf('function paint('), decksSrc.indexOf('function wire('));
  const write = paintFn.lastIndexOf('$app.innerHTML');
  assert.ok(write > 0, 'paint() moved — this test needs updating');
  assert.ok(paintFn.indexOf('const was = perch();') < write,
    'the perch must be taken BEFORE the write that destroys it');
  assert.match(paintFn, /wire\(was\)/, 'and handed to the wiring that puts it back');
  const wireFn = decksSrc.slice(decksSrc.indexOf('function wire('), decksSrc.indexOf('export function renderScreen'));
  assert.match(wireFn, /alight\(was\)/, 'wire() must land the page back where it was');
});

test('§6b the search box is not re-focused on every repaint', () => {
  // ⚠ RESTORING THE SCROLL ALONE DOES NOT FIX IT. `wire()` ended with a bare
  // `box.focus()`, and focusing an input scrolls it into view — so the
  // viewport was dragged to the search box after every single edit, and the
  // caret was stamped to the end of whatever had been typed. Opening the
  // drawer SHOULD claim the caret; nothing else may.
  const wireFn = decksSrc.slice(decksSrc.indexOf('function wire('), decksSrc.indexOf('export function renderScreen'));
  assert.doesNotMatch(wireFn, /^\s*box\?\.focus\(\);/m, 'the unconditional focus came back');
  assert.match(wireFn, /if \(focusSearch && box\)/, 'the focus is claimed once, by an explicit flag');
  assert.match(wireFn, /focusSearch = false;/, 'and the flag is consumed, not left standing');
  assert.match(decksSrc, /case 'deck-adding':\n\s*adding = true; focusSearch = true;/,
    'and it is the click that OPENS the drawer that sets it');
  assert.match(decksSrc, /focus\(\{ preventScroll: true \}\)/,
    'restoring a focus must not undo the scroll that was just restored');
});

test('§6c what the drawer is reading is held still, not the document', () => {
  // Adding a card grows the DECK GRID, which is ABOVE the drawer, so holding
  // scrollTop still slides the results down under the cursor — measured at
  // 136px, a full row, which is exactly far enough to make the next click land
  // on a different card.
  assert.match(decksSrc, /function anchorTop\(\)/, 'there must be an anchor to hold still');
  const anchor = decksSrc.slice(decksSrc.indexOf('function anchorTop('), decksSrc.indexOf('function perch('));
  assert.match(anchor, /getElementById\('dk-results'\)/, 'and it is the drawer, the thing being read');
  const alight = decksSrc.slice(decksSrc.indexOf('function alight('), decksSrc.indexOf('let focusSearch'));
  assert.match(alight, /p\.scroll \+ \(/, 'the scroll is CORRECTED by how far the anchor moved');
  assert.match(alight, /now - p\.anchor/, 'by exactly that far');
});
