/* R301 — the prophecy banner costs AFFINITY, not just mana.
 *
 * R42 said the opposite from 2026-08-19 to 2026-09-20: "costs the banner's
 * plain mana number, no affinity". It was never adjudicated. It was inferred
 * from a transcription in which all ten printed banners had lost their pips,
 * and the pipeline made the inference unfalsifiable — `PROPHECY_RE` had no pip
 * group and `prophecy` had no `cost` field, so a corrected row would have been
 * discarded on the way into printed.json anyway.
 *
 * So this file guards two different things, and it needs both:
 *
 *   §1 the DATA — the banners still carry pips at all. A test that only
 *      exercised the engine would keep passing the day the pips vanish from
 *      the transcription again, because `canPayProphecy('')` is trivially
 *      satisfiable and every behavioural assertion below would still hold.
 *      That is exactly how the original bug survived a year of green suites.
 *   §2 the RULE — the pips are required to prophesy, the offer and the refusal
 *      agree about it, and nothing else in R42 moved.
 *
 * Seeds 4600-4699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard } from '../src/cards/dsl.ts';
import { IllegalAction, legalActions } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { give, giveResources, toDeployment } from './util.ts';
import type { Seat } from '../src/types.ts';

/** every card in the pool that prints a banner */
const BANNERED = DECK_LIST
  .map(name => [name, getCard(name)] as const)
  .filter(([, c]) => c.prophecy);

// ── §1 the data ───────────────────────────────────────────────────────

test('R301 §1: every printed prophecy banner carries affinity pips', () => {
  // NINE UNTIL 2026-09-21, EIGHT NOW: Caleb removed the Prophecy banner from
  // Tithe Enforcer, and this census is what reported it — correctly, since a
  // card entering or leaving the bannered pool is the event it exists to
  // announce. The number is pinned rather than derived for exactly that reason;
  // do not soften it to `>= 1`.
  //
  // ⚠ AND THE DIRECTION MATTERS. A DROP can mean two very different things: a
  // banner lost in TRANSCRIPTION (the original R301 bug, where the scan still
  // showed it) or a banner Caleb actually removed (this). They are told apart
  // by the scan, never by this file — bot/pipeline/read_card_faces.py's
  // BANNER_CONTROL reads the printed banner off all 527 jpgs and is what
  // settled Tithe Enforcer. Run it before changing this number.
  assert.ok(BANNERED.length >= 8,
    `expected the eight scripted prophecy cards, found ${BANNERED.length} — `
    + 'if this dropped, either a banner fell out of the transcription again or '
    + 'Caleb removed one. read_card_faces.py tells you which.');
  const bare = BANNERED.filter(([, c]) => !c.prophecy!.cost);
  assert.deepEqual(bare.map(([n]) => n), [],
    'a banner with no affinity at all. Every printed banner carries pips (read '
    + 'off the scans 2026-09-20, R301); a bare one means the pips were lost in '
    + 'transcription again, which is the original bug. '
    + 'Re-run bot/pipeline/read_card_faces.py before touching this test.');
});

test('R301 §1: a banner only ever demands the card\'s own elements', () => {
  for (const [name, c] of BANNERED) {
    for (const pip of c.prophecy!.cost) {
      assert.ok(c.cost.includes(pip),
        `${name}: the banner wants "${pip}" but the card's own cost is `
        + `"${c.cost}" — an alternative cost is paid by the same deck that `
        + 'plays the card, so this would be unpayable by design');
    }
  }
});

// ── §2 the rule ───────────────────────────────────────────────────────

/** Angel of Anguish: cost `ld`, banner "[1ld] Prophecy — Two Turns Pass".
 * One mana, one light and one dark — so mana alone is never enough. */
const ANGEL = 'Angel of Anguish';

function deployWith(seed: number, res: Array<['light' | 'dark', number]>) {
  const h = new Harness(seed);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  for (const [kind, n] of res) giveResources(h, P, kind, n);
  const index = give(h, P, ANGEL);
  return { h, P: P as Seat, index };
}

const prophesies = (h: Harness, P: Seat): boolean =>
  legalActions(h.state, P).some(a => a.type === 'prophesy');

test('R301 §2: mana without the affinity does not buy a prophecy', () => {
  const banner = getCard(ANGEL).prophecy!;
  assert.equal(banner.cost, 'ld', 'the fixture assumes Angel of Anguish is [1ld]');

  // four light: mana to spare, the light pip satisfied, no dark at all
  const { h, P, index } = deployWith(4601, [['light', 4]]);
  assert.equal(prophesies(h, P), false,
    'not offered — the dark pip is missing, and R301 makes that a refusal');
  assert.throws(() => h.do({ type: 'prophesy', seat: P, from: 'hand', index }),
    (err: unknown) => err instanceof IllegalAction
      && /cannot pay the prophecy cost/.test((err as Error).message),
    'and refused if asked for directly — the offer and the refusal agree');
});

test('R301 §2: the affinity is REQUIRED, not spent', () => {
  // exactly one of each: one mana is spent, both pips are merely met
  const { h, P, index } = deployWith(4602, [['light', 1], ['dark', 1]]);
  assert.equal(prophesies(h, P), true, 'offered once both elements are present');
  h.do({ type: 'prophesy', seat: P, from: 'hand', index });

  const cache = h.state.players[P]!.cache ?? [];
  assert.equal(cache.length, 1, 'the card reached the cache');
  assert.equal(cache[0]!.card, ANGEL);

  const open = h.state.players[P]!.resources.filter(r => r.state === 'open').length;
  assert.equal(open, 1,
    'ONE resource was expended for [1] of mana, not two. The second pip was a '
    + 'requirement the seat had to meet, not a payment — which is the whole '
    + 'shape of a cost in this game and the reason doProphesy still calls '
    + 'payMana() rather than anything new');
});

test('R301 §2: the log names the pips it required', () => {
  const { h, P, index } = deployWith(4603, [['light', 1], ['dark', 1]]);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index });
  assert.ok(h.log.some(l => l.includes('[1ld]')),
    'the prophesy line prints the full banner cost, so a replay reads back '
    + `what was actually demanded. Log was:\n${h.log.join('\n')}`);
});

test('R301 §2: R42 is otherwise untouched — a fulfilled release still ignores affinity', () => {
  const { h, P, index } = deployWith(4604, [['light', 1], ['dark', 1]]);
  h.do({ type: 'prophesy', seat: P, from: 'hand', index });
  const cached = (h.state.players[P]!.cache ?? [])[0]!;
  assert.equal(cached.prophecy?.condition, 'Two Turns Pass',
    'the condition rode along with the card, exactly as before R301');
  assert.equal(cached.prophecy?.fulfilled ?? false, false,
    'and it is not fulfilled on the turn it was made (R43) — the free release '
    + 'that ignores affinity is 36-cache-prophecy.test.ts\'s business, not '
    + 'this file\'s. R301 changed the way IN to the cache, nothing after it');
});
