/* /api/bot/simulate — THE SPEC IS STRICT AND CAPPED (simulate.ts, the frozen contract).
 *
 * The spec is filled by a language model, so every way it can be wrong must
 * come back as a refusal that names the field — never a silently ignored key,
 * never a half-built board, never a guess at a card.
 *
 * §1 a good spec validates, and the defaults are what the contract says
 * §2 ⭐ an unknown key is refused BY NAME, at every level
 * §3 ⭐ an unknown card is refused with "did you mean" — and a near spelling
 *    (case, punctuation) is simply the card
 * §4 every cap holds: hand/play/bin/deckTop, steps, targets, numbers, refs
 * §5 the shape rules: attack only with start=battle, only the initiative
 *    side's units, a ref past the end of `play`, a spell is not a unit
 * §6 ⭐ the answer stays under 6 KB on the biggest board the caps allow
 * §7 the self-stop: a run out of time says so instead of hanging
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, resolveCard, simulate, validateSpec, type SimFail } from '../simulate.ts';

const fail = (raw: unknown): SimFail => {
  const r = validateSpec(raw);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(raw).slice(0, 200)}`);
  return r as SimFail;
};
const atOf = (r: SimFail): string[] => (r.errors ?? []).map(e => e.at);

/* ══ §1 ═════════════════════════════════════════════════════════════ */

test('§1 a good spec validates, with the contract\'s defaults', () => {
  const r = validateSpec({ you: { hand: ['Luminous Arc'], play: ['The Foretold'] } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.spec.id, 's1');
  assert.equal(r.spec.initiative, 0, 'initiative defaults to you');
  assert.equal(r.spec.start, 'deployment', 'no attack → deployment');
  assert.equal(r.spec.until, 'stackEmpty');
  assert.equal(r.spec.showOffered, false);
  const b = validateSpec({ you: { play: ['The Foretold'] }, attack: [['you.0']] });
  assert.ok(b.ok && b.spec.start === 'battle', 'an attack implies start=battle');
  const u = validateSpec({ you: { play: [{ card: 'The Foretold', temp: { attrs: ['inverted', 'Balanced'], power: 1 } }] } });
  assert.ok(u.ok);
  assert.deepEqual(u.spec.you.play[0]!.temp,
    [{ attr: 'Inverted' }, { attr: 'Balanced' }, { power: 1, toughness: 0 }],
    '`temp` keeps the object\'s own key order (the timestamp order), attributes case-insensitive');
});

/* ══ §2 ═════════════════════════════════════════════════════════════ */

test('§2 ⭐ unknown keys are refused by name, at every level', () => {
  const r = fail({
    bogus: 1,
    you: { hand: [], extra: 2, play: [{ card: 'The Foretold', speed: 3, temp: { flying: true } }] },
    steps: [{ do: 'pass', card: 'Luminous Arc' }],
  });
  const at = atOf(r);
  for (const k of ['spec.bogus', 'you.extra', 'you.play[0].speed', 'you.play[0].temp.flying', 'steps[0].card']) {
    assert.ok(at.includes(k), `${k} is named (got ${at.join(', ')})`);
  }
  assert.match(r.error, /unknown key "bogus"/);
  assert.equal(fail({ steps: [{ do: 'dance' }] }).errors![0]!.at, 'steps[0].do');
  assert.equal(fail('not an object').error, 'the spec must be a JSON object');
});

/* ══ §3 ═════════════════════════════════════════════════════════════ */

test('§3 ⭐ an unknown card is refused with "did you mean"; a near spelling is the card', () => {
  const r = fail({ you: { hand: ['Luminos Arc'], play: ['Towering Colosus'] } });
  const hand = r.errors!.find(e => e.at === 'you.hand[0]')!;
  assert.match(hand.error, /unknown card "Luminos Arc"/);
  assert.deepEqual(hand.didYouMean?.[0], 'Luminous Arc');
  assert.equal(r.errors!.find(e => e.at === 'you.play[0].card')!.didYouMean?.[0], 'Towering Colossus');
  assert.match(r.error, /did you mean Luminous Arc/, 'the headline error carries the suggestion');
  for (const s of ['luminous arc', 'LUMINOUS  ARC', 'Luminous Arc.']) {
    assert.deepEqual(resolveCard(s), { name: 'Luminous Arc' }, `"${s}" is Luminous Arc`);
  }
  const none = resolveCard('qqqqqqqqqqqqqqqq');
  assert.ok('didYouMean' in none && none.didYouMean.length === 0, 'gibberish suggests nothing rather than something random');
});

/* ══ §4 ═════════════════════════════════════════════════════════════ */

test('§4 every cap holds', () => {
  const many = (n: number, c = 'Luminous Arc'): string[] => Array.from({ length: n }, () => c);
  assert.ok(atOf(fail({ you: { hand: many(LIMITS.hand + 1) } })).includes('you.hand'));
  assert.ok(atOf(fail({ you: { bin: many(LIMITS.bin + 1) } })).includes('you.bin'));
  assert.ok(atOf(fail({ you: { deckTop: many(LIMITS.deckTop + 1) } })).includes('you.deckTop'));
  assert.ok(atOf(fail({ opponent: { play: many(LIMITS.play + 1, 'The Foretold') } })).includes('opponent.play'));
  assert.ok(atOf(fail({ steps: Array.from({ length: LIMITS.steps + 1 }, () => ({ do: 'pass' })) })).includes('steps'));
  assert.ok(atOf(fail({ steps: [{ do: 'play', card: 'Luminous Arc', targets: many(LIMITS.targets + 1, 'opponent') }] })).includes('steps[0].targets'));
  assert.ok(atOf(fail({ you: { play: [{ card: 'The Foretold', counters: 21 }] } })).includes('you.play[0].counters'));
  assert.ok(atOf(fail({ you: { play: [{ card: 'The Foretold', damage: -1 }] } })).includes('you.play[0].damage'));
  assert.ok(atOf(fail({ you: { life: 0 } })).includes('you.life'));
  assert.ok(atOf(fail({ you: { resources: { fire: 21 } } })).includes('you.resources.fire'));
  assert.ok(atOf(fail({ you: { resources: { fire: 20, water: 20, earth: 1 } } })).includes('you.resources'));
  assert.ok(atOf(fail({ you: { resources: { mana: 3 } } })).includes('you.resources.mana'));
  assert.ok(atOf(fail({ you: { play: [{ card: 'The Foretold', temp: { attrs: ['Flyng'] } }] } })).includes('you.play[0].temp.attrs[0]'));
  assert.ok(atOf(fail({ you: { play: [{ card: 'The Foretold', mods: many(LIMITS.mods + 1, 'Lithoghul').map(c => ({ card: c, as: 'augment' })) }] } })).includes('you.play[0].mods'));
  assert.ok(atOf(fail({ id: 'Has Spaces' })).includes('id'));
  assert.ok(atOf(fail({ until: 'forever' })).includes('until'));
});

/* ══ §5 ═════════════════════════════════════════════════════════════ */

test('§5 shape rules: attack needs battle and the initiative side; refs must exist; spells are not units', () => {
  assert.ok(atOf(fail({ you: { play: ['The Foretold'] }, start: 'deployment', attack: [['you.0']] })).includes('attack'));
  const wrongSide = fail({ opponent: { play: ['The Foretold'] }, initiative: 'you', attack: [['opponent.0']] });
  assert.match(wrongSide.errors![0]!.error, /the attacker is you/);
  const past = fail({ you: { play: ['The Foretold'] }, steps: [{ do: 'activate', unit: 'you.3', ability: 0 }] });
  assert.match(past.error, /only 1 unit/);
  const notRef = fail({ steps: [{ do: 'play', card: 'Luminous Arc', targets: ['the big one'] }] });
  assert.match(notRef.error, /not a reference/);
  const spell = fail({ you: { play: ['Luminous Arc'] } });
  assert.match(spell.error, /Luminous Arc is a spell, not a unit/);
  const hostPlayer = fail({ steps: [{ do: 'augment', card: 'Lithoghul', host: 'opponent' }] });
  assert.match(hostPlayer.error, /names a player/);
  assert.ok(atOf(fail({ blocks: { 'opponent.0': 'you.0' } })).includes('blocks'), 'blocks need start=battle');
});

/* ══ §6 ═════════════════════════════════════════════════════════════ */

test('§6 ⭐ the answer stays under 6 KB on the biggest board the caps allow', () => {
  const units = ['Towering Colossus', 'Static Courier', 'Tidal Menace', 'The Foretold'];
  const side = (seat: string) => ({
    hand: Array.from({ length: LIMITS.hand }, () => 'Luminous Arc'),
    play: Array.from({ length: LIMITS.play }, (_, i) => ({
      card: units[i % units.length]!, counters: 2, temp: { attrs: ['Balanced', 'Flying', 'Tough', 'Swift'] },   // not Inverted: Tough+Inverted kills a Colossus
    })),
    resources: { fire: 20, earth: 20 },
    bin: Array.from({ length: LIMITS.bin }, () => 'Luminous Arc'),
    ...(seat === 'you' ? {} : {}),
  });
  const steps = Array.from({ length: 10 }, (_, i) => ({ do: 'play', card: 'Luminous Arc', targets: [`opponent.${i}`] }));
  const r = simulate({
    you: side('you'), opponent: side('opponent'),
    attack: Array.from({ length: LIMITS.play }, (_, i) => [`you.${i}`]),
    steps, until: 'endOfTurn', showOffered: true,
  });
  const bytes = Buffer.byteLength(JSON.stringify(r));
  assert.ok(r.ok, JSON.stringify(r).slice(0, 400));
  assert.ok(bytes <= LIMITS.outBytes, `answer is ${bytes} bytes, over ${LIMITS.outBytes}`);
  assert.ok(r.final.units.length > 0 && r.board.length > 0, 'trimming kept the substance');
});

/* ══ §7 ═════════════════════════════════════════════════════════════ */

test('§7 a run out of time stops itself and says so', () => {
  const r = simulate({ you: { play: ['The Foretold'] } }, { budgetMs: -1 });
  assert.equal(r.ok, false);
  assert.match((r as SimFail).error, /stopped after/);
  assert.match((r as SimFail).limit ?? '', /ms/);
});
