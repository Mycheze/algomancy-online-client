/* HOW MANY BURST SPELLS ARE LEFT, AND OF WHAT SIZE.
 *
 * Playtest report #132, room PUCG, actionIndex 132:
 *
 *   "When casting a bunch of burst spells, it's very hard to tell how many
 *    you have left and of which sizes they are."
 *
 * ── WHAT "BURST" AND "SIZE" ACTUALLY ARE, MEASURED
 *
 * Both halves of that sentence mean something narrower than they sound, and
 * §0 below re-derives each of them from the printed pool rather than trusting
 * this comment:
 *
 *  (a) "burst spells" is very nearly the whole spell-token surface, but NOT
 *      quite: `burst === true` is three printed cards and `kind ===
 *      'spellToken'` is four. §0a names the fourth and says why the difference
 *      changes the fix. The rule that makes the question urgent is
 *      `apply.ts:1005` — casting one token casts EVERY token of the same NAME
 *      in that region, in one `castChain` (`apply.ts:1032`) that nobody can
 *      respond to in the middle. Before R254 the word "burst" appeared in
 *      ui/main.ts zero times, so that rule was never once stated on the board.
 *
 *  (b) "sizes" is NOT mana and NOT power/toughness. Every burst token in the
 *      pool prints the same mana and the same body; what varies is `X`, and
 *      `X` is carried per ENTITY, not per card (Manual p.15: "X is determined
 *      by the card that created them"). §0c derives how many printed cards
 *      mint them and shows that one name is minted by many different cards —
 *      which is what makes a mixed-size group reachable at all.
 *
 * And the two facts meet at `apply.ts:1006`, which groups the chain on
 * `t.card` and IGNORES `t.x`: a player holding Fireball 1, Fireball 1,
 * Fireball 3 fires all three as one chain of three differently-sized spells,
 * with no way to hold one back. That is the report, exactly — so the board
 * owes an answer to "how many, of which size" in both places the question is
 * asked: the strip you hold them in, and the stack they go on.
 *
 * ── THE TWO INDEPENDENT DEFECTS THIS FILE PINS
 *
 * 1. THE STRIP said `✨ spell tokens (N)` — one aggregate over Fireballs,
 *    Poisons and Crystals mixed — over tiles listed in raw entity-id order.
 *    Each tile did wear `X=n`, so the information was on screen and nowhere
 *    was it summed, sorted or grouped. §1.
 *
 * 2. THE STACK carried X in `.stacktag`, at the RIGHT-HAND end of a strip
 *    whose cards overlap left-to-right, i.e. the end the next card covers.
 *    §2 measures the surviving sliver out of the client's OWN rendered
 *    `--stackstep` and the stylesheet's `--cw`, and shows the kind word alone
 *    spends it from about six deep. Six deep is one Flame Juggle plus one
 *    Molten Riftbreaker.
 *
 * ── HOUSE RULES OBSERVED
 *
 * Nothing here reads ui/main.ts as source text (the discipline 223 §2 states
 * and 225's header repeats): the client is driven through test/ui-driver.ts
 * and the assertions read the markup it really produced. The stylesheet IS
 * read as text — that is what 70-playtest-round15 already does, and a
 * geometry claim has nowhere else to live.
 *
 * No card in the report is named by this file. Every subject set is swept out
 * of the printed pool, and §0d is the positive control: a derived sweep whose
 * subject set came back empty would pass forever and look identical to one
 * that works.
 *
 * Seeds 23300-23399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { GameState, Seat } from '../src/types.ts';

/* ══ derived subject sets ═════════════════════════════════════════════════ */

type Def = Record<string, unknown>;
const def = (n: string): Def => getCard(n) as unknown as Def;

/** every printed card that IS a burst spell */
const BURST = allCardNames().filter(n => def(n)['burst'] === true);
/** every printed card whose kind is a spell token */
const TOKEN_KIND = allCardNames().filter(n => def(n)['kind'] === 'spellToken');

/** which burst names does anything reachable on this card declare it CREATES?
 * `creates` is printed data on the card definition, so this is the minting
 * surface derived rather than typed. */
function mints(card: Def): string[] {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    const c = (o as Def)['creates'];
    if (Array.isArray(c)) for (const n of c) if (BURST.includes(String(n))) out.add(String(n));
    for (const v of Object.values(o as Def)) walk(v);
  };
  walk(card);
  return [...out];
}

/** name → the printed cards that mint it */
const MINTERS = new Map<string, string[]>(BURST.map(b => [b, [] as string[]]));
for (const n of allCardNames()) for (const b of mints(def(n))) MINTERS.get(b)!.push(n);

/* ══ fixtures ═════════════════════════════════════════════════════════════ */

/** a deployment board where `seat` holds exactly the tokens described */
function holding(seed: number, tokens: { name: string; x: number }[]): { s: GameState; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.initiative;
  const e = new E(h.state);
  for (const t of tokens) e.createSpellToken(seat, t.name, t.x, e.homeRegion(seat));
  e.settle();
  return { s: h.state, seat };
}

/** the board as `seat` is really served it, painted by the real client */
async function paint(s: GameState, seat: Seat): Promise<string> {
  const ui = await client();
  return ui.join(viewFor(s, seat), seat, legalActions(s, seat));
}

/* ══ markup readers ═══════════════════════════════════════════════════════ */

const strip = (html: string): string => (html.match(/<span[\s\S]*?class="tallyrow[\s\S]*?<\/span>\s*<\/span>/g) ?? []).join('');

interface Row { name: string; n: number; sizes: string; mixed: boolean; burst: boolean; title: string }

/** every tally row the strip painted, in the order it painted them */
function tallyRows(html: string): Row[] {
  const out: Row[] = [];
  const re = /<span\s+class="tallyrow([^"]*)"\s+title="([^"]*)"><span class="tallyname">([^<]*)<\/span\s*><b class="tallyn">×(\d+)<\/b><span class="tallyx">([^<]*)<\/span>/g;
  for (const m of html.matchAll(re)) {
    out.push({
      burst: m[1]!.includes('burst'), mixed: m[1]!.includes('mixed'),
      title: m[2]!, name: m[3]!, n: Number(m[4]), sizes: m[5]!,
    });
  }
  return out;
}

/** the token tiles of one seat's strip, in the order they were painted */
function tileIds(html: string, seat: Seat): number[] {
  const zone = html.split(`data-animzone="tokens:${seat}"`)[1] ?? '';
  return [...zone.slice(0, zone.indexOf('data-animzone')  + 1 || undefined)
    .matchAll(/data-act="token" data-id="(\d+)"/g)].map(m => Number(m[1]));
}

/** each stack card, as (whole markup, its .stacktag text, its .stackx text) */
function stackCards(html: string): { all: string; tag: string; x: string | null }[] {
  const board = html.split('class="stackboard')[1] ?? '';
  return board.split('<div class="stackcard').slice(1).map(chunk => {
    const tag = chunk.match(/<div class="stacktag">([^<]*)</);
    const x = chunk.match(/<div class="stackx">([^<]*)</);
    return { all: chunk, tag: tag ? tag[1]! : '', x: x ? x[1]! : null };
  });
}

/* ══ the stylesheet, for the one geometry claim ═══════════════════════════ */

const CSS = readFileSync(new URL('../ui/style.css', import.meta.url), 'utf8');
/** the body of a CSS rule, by exact selector. Same shape as
 * 70-playtest-round15's `rule()`: the selector must start a line, so a
 * `.foo` rule is not found by matching inside `.bar .foo`. */
function cssRule(sel: string): string {
  const m = CSS.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{([^}]*)}`, 'm'));
  assert.ok(m, `ui/style.css has no rule for \`${sel}\``);
  return m![1]!;
}
const cssPx = (v: string): number => Number(v.match(/(-?[\d.]+)px/)?.[1]);

/* ══ §0 — the premises, re-derived ════════════════════════════════════════ */

/* ⚠ CT-125's brief said `burst === true` and `kind === 'spellToken'` return
 * THE SAME three cards, and therefore that burst is not a thing to scope to.
 * The first half is false and this is where it was caught. `src/apply.ts`
 * registers a fourth spell-token-kinded card — a synthetic standing in for a
 * rules-owned attribute effect, `burst: false`, so that the spells which
 * retarget an arbitrary stack item have a registered card to reach. It is
 * only visible once apply.ts has been imported (the pool is 494 cards without
 * it, 495 with), which is why a probe that loads only the registry sees three.
 *
 * It changes the fix: the strip filters on the KIND, so the row it draws must
 * ask the CARD whether casting one really casts the rest, instead of assuming
 * that everything in the container does. §1f is the guard for that, and the
 * `notBurst` set below is its subject. */
const NOT_BURST = TOKEN_KIND.filter(n => !BURST.includes(n));

test('§0a the spell-token KIND is a superset of burst — the container is not the rule', () => {
  for (const b of BURST) {
    assert.ok(TOKEN_KIND.includes(b), `${b} is burst but not a spell token — the strip would never show it`);
  }
  assert.ok(NOT_BURST.length >= 1,
    'every spell-token card is burst now, so §1f has no subject and passes vacuously — delete §1f, '
    + 'or find the card the strip can hold that does not chain');
  for (const n of NOT_BURST) {
    assert.equal(def(n)['burst'], false,
      `${n} is a spell token whose burst flag is neither true nor false — the row cannot word itself`);
  }
});

test('§0b every burst token prints the same body, so the only size a player can read is X', () => {
  const bodies = new Set(BURST.map(n => `${def(n)['mana']}/${def(n)['power']}/${def(n)['toughness']}`));
  assert.equal(bodies.size, 1,
    `the burst tokens differ by printed body (${[...bodies].join(', ')}) — then mana or power IS the `
    + 'size the report means, and X is not the whole answer');
  for (const n of BURST) {
    assert.match(String(def(n)['text'] ?? ''), /\bX\b/,
      `${n} does not spend an X — then its entity X is not what "size" means for it`);
  }
});

test('§0c one burst name is minted by many different printed cards, at sizes they each choose', () => {
  const total = new Set([...MINTERS.values()].flat()).size;
  assert.ok(total >= 10,
    `only ${total} printed cards mint a burst token — the mixed-size case may not be reachable`);
  const many = [...MINTERS.entries()].filter(([, m]) => m.length >= 2);
  assert.ok(many.length >= 1,
    'no burst name is minted by two different cards, so every group you hold came from one source '
    + 'and would share one X — the report would not be about sizes at all');
});

test('§0d POSITIVE CONTROL — the swept sets are not empty, so a green sweep means something', () => {
  assert.ok(BURST.length >= 3, `the pool has ${BURST.length} burst cards — a sweep over that proves nothing`);
  for (const b of BURST) {
    assert.ok(MINTERS.get(b)!.length >= 1, `nothing in the pool mints ${b}, so no player can ever hold one`);
  }
  // and the fixture really does put them on the board: without this, every
  // assertion in §1 could be reading an empty strip and agreeing with it
  const { s, seat } = holding(23300, BURST.map((name, i) => ({ name, x: i + 1 })));
  const tokens = Object.values(s.entities).filter(e => e.kind === 'spellToken' && e.controller === seat);
  assert.equal(tokens.length, BURST.length, 'the fixture can seat one of every burst token');
});

/* ══ §1 — the strip: how many, of which name, at which size ═══════════════ */

test('§1a every burst name you hold gets its own row, named, counted', async () => {
  // one of each, so the aggregate count cannot stand in for the breakdown
  const { s, seat } = holding(23301, BURST.map((name, i) => ({ name, x: i + 2 })));
  const rows = tallyRows(await paint(s, seat));
  assert.deepEqual(rows.map(r => r.name).sort(), [...BURST].sort(),
    'the strip collapses every burst name into one count — which of them you hold is not on the board');
  for (const r of rows) assert.equal(r.n, 1, `${r.name} is counted once`);
});

test('§1b a group of one name at different sizes prints every size — the report verbatim', async () => {
  for (const name of BURST) {
    // the shape from the report: several of ONE name, two of them alike,
    // the rest different. apply.ts groups on the name and ignores the X, so
    // all four of these fire as one chain.
    const xs = [1, 1, 3, 7];
    const { s, seat } = holding(23302, xs.map(x => ({ name, x })));
    const rows = tallyRows(await paint(s, seat));
    assert.equal(rows.length, 1, `${name}: one name held, one row`);
    const r = rows[0]!;
    assert.equal(r.name, name);
    assert.equal(r.n, xs.length, `${name}: the count is the number you hold, not the number of sizes`);
    assert.equal(r.sizes, 'X=1 ×2 · X=3 · X=7',
      `${name}: the sizes and how many of each — "of which sizes they are", answered`);
    assert.ok(r.mixed, `${name}: a group whose Xs differ is marked as such — that is the reported case`);
    assert.ok(r.burst, `${name}: a group of more than one is marked as one chain`);
    assert.match(r.title, /[Bb]urst/,
      `${name}: the row must say what clicking one of these does — casting one casts all of them`);
    assert.match(r.title, new RegExp(`ALL ${xs.length}\\b`),
      `${name}: and how many that is`);
  }
});

test('§1c the tiles are ordered so a burst group is contiguous and reads smallest first', async () => {
  const name = BURST[0]!, other = BURST[BURST.length - 1]!;
  assert.notEqual(name, other, 'two distinct burst names to interleave');
  // seated in the order that makes id order WRONG: alternating names, sizes
  // descending. Nothing but a sort can put this right.
  const seeded = [
    { name, x: 7 }, { name: other, x: 5 }, { name, x: 1 },
    { name: other, x: 2 }, { name, x: 3 },
  ];
  const { s, seat } = holding(23303, seeded);
  const byId = new Map(Object.values(s.entities)
    .filter(e => e.kind === 'spellToken').map(e => [e.id, e]));
  const shown = tileIds(await paint(s, seat), seat).map(id => byId.get(id)!);
  assert.equal(shown.length, seeded.length, 'every seeded token is on the strip');
  // contiguous by name…
  const names = shown.map(t => t.card);
  assert.equal(new Set(names).size, names.filter((n, i) => names[i - 1] !== n).length,
    `the tiles interleave the two names (${names.join(', ')}) — a 3-of is three tiles apart`);
  // …and ascending by X within a name, which is the order the tally prints
  for (let i = 1; i < shown.length; i++) {
    if (shown[i]!.card !== shown[i - 1]!.card) continue;
    assert.ok(shown[i]!.x! >= shown[i - 1]!.x!,
      `${shown[i]!.card}: X=${shown[i - 1]!.x} then X=${shown[i]!.x} — the tiles do not agree with the tally`);
  }
});

test('§1d no tokens means no tally — the rows are earned, not reserved', async () => {
  const { s, seat } = holding(23304, []);
  const html = await paint(s, seat);
  assert.ok(html.includes(`data-animzone="field:${seat}"`), 'the board really rendered');
  assert.equal(tallyRows(html).length, 0, 'an empty tally is a label over nothing');
  assert.equal(strip(html), '', 'and nothing that looks like a row');
});

test('§1e the tally may not widen the strip — two cards abreast is load-bearing', () => {
  // 70-playtest-round15 [61] pins that .tokenstrip fits two 52px cards even at
  // its floor. A summary that set its own width would take that back, and the
  // failure would surface as a region panel growing a column again.
  for (const sel of ['.tokentally', '.tallyrow']) {
    const body = cssRule(sel);
    assert.equal(/(^|;)\s*(min-)?width\s*:/.test(body), false,
      `${sel} sets a width — the strip's clamp is what keeps the tiles two abreast`);
  }
  assert.match(cssRule('.tallyrow'), /flex-wrap:\s*wrap/,
    'a long row must wrap inside the strip rather than push it wider');
});

test('§1f a spell token that is NOT burst gets a row that does not claim the chain', async () => {
  for (const name of NOT_BURST) {
    const { s, seat } = holding(23305, [{ name, x: 2 }, { name, x: 4 }]);
    const rows = tallyRows(await paint(s, seat));
    assert.equal(rows.length, 1, `${name}: it is a spell token, so the strip does hold it`);
    const r = rows[0]!;
    assert.equal(r.burst, false,
      `${name} is not a burst spell, but its row is marked as one chain — the tally is reading the `
      + 'container it is drawn in instead of the card it is about');
    assert.equal(r.mixed, false, `${name}: two sizes that do not fire together are not a mixed chain`);
    assert.equal(/ALL \d/.test(r.title), false,
      `${name}: the row promises that clicking one casts all of them, and apply.ts would cast one`);
    assert.equal(r.n, 2, `${name}: it is still counted — the count is true of every token`);
    assert.equal(r.sizes, 'X=2 · X=4', `${name}: and so are the sizes`);
  }
});

/* ══ §2 — the stack: X where the next card cannot cover it ════════════════ */

/** answer every pending target question with the first option offered */
function answerAll(h: Harness): void {
  for (let guard = 0; h.state.decision && guard < 40; guard++) {
    const dec = h.state.decision;
    assert.ok(dec.options.length, 'a target question with no options');
    h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
}

/** a real burst chain of `xs.length` differently-sized tokens, on the stack */
function chainOnStack(seed: number, name: string, xs: number[]): { s: GameState; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Rune Channeler');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  const ids = xs.map(x => e.createSpellToken(D, name, x, h.state.battle!.region).id);
  pass(h);                                   // A passes, D holds priority
  h.do({ type: 'castSpellToken', seat: D, entityId: ids[0]! });
  // one target question per member of the chain: Burst cast all of them.
  // WHICH target does not matter here and must not be typed — the burst names
  // are swept out of the pool and they do not all offer the same menu (a
  // Poison takes a unit, a Fireball takes a unit OR a face). Take the first
  // thing offered, whatever it is.
  answerAll(h);
  assert.equal(h.state.stack.length, xs.length, 'the whole chain really is on the stack');
  return { s: h.state, seat: D };
}

test('§2a from six deep the kind word alone spends the visible sliver', async () => {
  const xs = [1, 1, 3, 7, 2, 5];
  const { s, seat } = chainOnStack(23310, BURST.find(b => MINTERS.get(b)!.length >= 2) ?? BURST[0]!, xs);
  const html = await paint(s, seat);
  // the client's own arithmetic, read back out of the markup it emitted
  const step = Number(html.match(/--stackstep:([\d.]+)/)?.[1]);
  assert.ok(step > 0, 'the stack row published the step it laid the cards out at');
  const cw = cssPx(cssRule(':root').match(/--cw:[^;]*/)![0]);
  const sliver = step * cw;
  const cards = stackCards(html);
  assert.equal(cards.length, xs.length, 'six cards on the strip');
  // `.stacktag` is `left:0; right:0; text-align:left; overflow:hidden` at 8px
  // with .03em of tracking. 4.0px per character is a deliberate UNDER-estimate
  // of the advance (a lowercase glyph in a UI sans runs ~0.55em ≈ 4.4px, plus
  // 0.24px of tracking) — the claim below is "even at the narrowest plausible
  // type this does not fit", so erring small is erring against the claim.
  const CHAR_PX = 4.0;
  const kind = cards[0]!.tag;
  assert.ok(kind.length, 'the buried cards still say what kind of item they are');
  // where the X USED to live: `kind · X=n`, read from the left
  const beforeX = `${kind} · `.length * CHAR_PX;
  assert.ok(beforeX > sliver,
    `the tag spends ${beforeX.toFixed(1)}px before it would reach the X and the sliver is `
    + `${sliver.toFixed(1)}px wide — the number would still be visible there, so this occlusion is `
    + 'no longer real: either the layout changed or the estimate needs redoing');
  for (const [i, c] of cards.entries()) {
    assert.equal(c.tag.includes('X='), false,
      `card ${i} carries its X in .stacktag, at the end the next card covers — that is the defect`);
  }
});

test('§2b every buried card wears its X where the overlap cannot reach it', async () => {
  const xs = [1, 1, 3, 7, 2, 5];
  const { s, seat } = chainOnStack(23311, BURST.find(b => MINTERS.get(b)!.length >= 2) ?? BURST[0]!, xs);
  const cards = stackCards(await paint(s, seat));
  assert.equal(cards.length, xs.length, 'POSITIVE CONTROL: there are cards to read at all');
  for (const [i, c] of cards.entries()) {
    assert.ok(c.x, `stack card ${i} shows no X anywhere — six near-identical tokens differing only by it`);
  }
  assert.deepEqual(cards.map(c => c.x), s.stack.map(it => `X=${it.x}`),
    'and the number on each card is the X of that item, in stack order');
  assert.match(cssRule('.stackcard .stackx'), /left:\s*0/,
    'the badge must be anchored to the LEFT edge — the part of a buried card that survives');
});

test('§2c the depth chip counts the run, so you can see how many are left', async () => {
  const xs = [1, 1, 3, 7, 2, 5];
  const name = BURST.find(b => MINTERS.get(b)!.length >= 2) ?? BURST[0]!;
  const { s, seat } = chainOnStack(23312, name, xs);
  const html = await paint(s, seat);
  const depth = html.match(/<span class="stackdepth"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(depth, 'the stack is deeper than one, so the depth chip is there');
  assert.match(depth![1]!, new RegExp(`${name} ×${xs.length}`),
    'the only aggregate was "N deep", which counts the stack and not the run');
  const title = html.match(/<span class="stackdepth" title="([^"]*)"/)![1]!;
  for (const x of new Set(xs)) {
    assert.match(title, new RegExp(`X=${x}`), `the run breakdown names X=${x}`);
  }
});

test('§2d a stack with no repeats claims no run — the chip does not invent one', async () => {
  const h = new Harness(23313);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Rune Channeler');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  // two DIFFERENT burst names: R16/R81 says these are two chains, not one
  const names = BURST.slice(0, 2);
  assert.equal(names.length, 2, 'POSITIVE CONTROL: two distinct burst names exist to tell apart');
  const ids = names.map(n => e.createSpellToken(D, n, 4, h.state.battle!.region).id);
  pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: ids[0]! });
  answerAll(h);
  const html = await paint(h.state, D);
  const depth = html.match(/<span class="stackdepth"[^>]*>([\s\S]*?)<\/span>/);
  if (depth) {
    assert.equal(/×\d/.test(depth[1]!), false,
      `a stack of one of each is not a run, but the chip claims one: ${depth[1]}`);
  }
});
