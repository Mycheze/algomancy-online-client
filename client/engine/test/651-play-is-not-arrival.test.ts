/* "WHEN YOU PLAY A UNIT" HEARS THE PLAY, NOT THE ARRIVAL.
 *
 * The owner, 2026-10-25, of Proph ("When you play a unit or spell from
 * anywhere other than your hand, [Switch1] Draw a card."): "It says 'play'
 * not 'enters'".
 *
 * Proph and Stalwart Sentinel ("[Augment][once] When you play a unit or spell
 * from anywhere other than your hand, put two +1/+1 counters on me.") heard a
 * spell on 'spellPlayed' but a UNIT on its 'spawned' line — the unit arriving,
 * after it had resolved. So in room ZAKG (2026-10-24, deployment) invi's
 * Reality Siphoner spawned from the cache and only then did Proph's draw go on
 * the stack, where a spell played the same way would have had the draw
 * resolve first. And a unit that was played but never arrived (negated) was
 * not heard at all. Both now read 'cardPlayed', fired as the card is played.
 *
 *  §1  ORDER. The play's trigger sits above the unit and resolves before it.
 *  §2  A PLAYED UNIT THAT NEVER ARRIVES still counts: it was played.
 *  §3  THE POOL. No triggered ability whose card prints a play clause listens
 *      on 'spawned' (except a "When I spawn" self trigger), derived from the
 *      registry and printed.json, with a control proving the detector sees
 *      the old shape. 444 still sweeps every play listener for CR 701.1e.
 *
 * Seeds 65100-65199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard, type TriggeredAbility } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { giveResources, spawn, toDeployment, toNextBattle, withE } from './util.ts';

function answerAll(h: Harness): void {
  for (let guard = 0; h.state.decision && guard < 20; guard++) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, k) => k) : 0 });
  }
}

/** the "Resolving X" / "spawns X" lines from log index `from` on, in order */
const beats = (h: Harness, from: number, unit: string): string[] =>
  h.log.slice(from).flatMap(l => {
    if (/^\s*Resolving Proph:/.test(l)) return ['Proph draws'];
    if (/^\s*Resolving Stalwart Sentinel:/.test(l)) return ['Sentinel counters'];
    if (l.includes(`spawns ${unit}.`)) return [`${unit} spawns`];
    return [];
  });

/** deployment with `listener` in play and a playable cached Good Whale */
function cachedWhale(seed: number, listener: string): { h: Harness; A: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, listener);
  for (const el of ['water', 'earth', 'wood', 'light'] as const) giveResources(h, A, el, 4);
  withE(h, e => { e.cacheCard(A, 'Good Whale', 'effect', { playable: true }); });
  return { h, A };
}

// ── §1 order ─────────────────────────────────────────────────────────────

function orderCase(listener: string, heard: string): void {
  const { h, A } = cachedWhale(65100, listener);
  const n = h.log.length;
  h.do({ type: 'playCached', seat: A, index: 0 });
  answerAll(h);
  assert.deepEqual(beats(h, n, 'Good Whale'), [heard, 'Good Whale spawns'],
    `${listener}'s trigger goes on the stack above the played Whale and resolves first`);
}
// literal titles: the CR's examples and the ledgers bind to them by text
test('play not arrival: Proph resolves before the unit it heard being played from a cache',
  () => orderCase('Proph', 'Proph draws'));
test('play not arrival: Stalwart Sentinel resolves before the unit it heard being played from a cache',
  () => orderCase('Stalwart Sentinel', 'Sentinel counters'));

// ── §2 a played unit that never arrives ──────────────────────────────────

test('play not arrival: a unit played from a cache and negated before it resolves still makes Proph draw', () => {
  const h = new Harness(65101);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  const proph = spawn(h, A, 'Proph');
  for (const el of ['metal', 'light'] as const) giveResources(h, A, el, 4);
  toNextBattle(h, A);
  // Proph goes too: a trigger hears only plays in its own region
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, proph]] });
  withE(h, e => { e.cacheCard(A, 'Monke', 'effect', { playable: true }); });
  const hand = h.state.players[A]!.hand.length;
  const n = h.log.length;
  h.do({ type: 'playCached', seat: A, index: 0 });
  answerAll(h);
  const monke = h.state.stack.find(it => it.card === 'Monke');
  assert.ok(monke, 'Monke is on the stack, played');
  // pass until Proph's trigger (above Monke) has resolved and only Monke is left
  for (let guard = 0; h.state.stack.length > 1 && guard < 10; guard++) {
    answerAll(h);
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.deepEqual(h.state.stack.map(it => it.card), ['Monke'], 'only Monke is left');
  withE(h, e => { e.negate(monke.id); });
  assert.ok(!Object.values(h.state.entities).some(u => u.card === 'Monke'), 'Monke never arrived');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, `and Proph drew anyway: Monke was played\n${h.log.slice(n).join('\n')}`);
});

// ── §3 the pool ──────────────────────────────────────────────────────────

/** a trigger condition about PLAYING: "When you play …" (444's PLAY_CLAUSE) */
const PLAY_CLAUSE = /\bwhen(?:ever)?\b[^.]*?\bplays?\b/i;
const textOf = (name: string): string =>
  (printed as Record<string, { text?: string }>)[name]?.text ?? '';

/** every (card, label) whose card prints a play clause and that hears 'spawned'
 *  as anything but its own "When I spawn" */
function spawnAsPlay(cards: readonly string[]): string[] {
  const out: string[] = [];
  for (const card of cards) {
    if (!PLAY_CLAUSE.test(textOf(card))) continue;
    const def = getCard(card) as unknown as Record<string, unknown>;
    for (const list of Object.values(def)) {
      if (!Array.isArray(list)) continue;
      for (const a of list as TriggeredAbility[]) {
        if (a?.type !== 'triggered' || a.self || a.zone) continue;
        if (a.events.includes('spawned')) out.push(`${card} (${a.label})`);
      }
    }
  }
  return out;
}

test('play not arrival: no card that prints a play clause hears it on a unit spawning', () => {
  const cards = allCardNames();
  assert.ok(cards.filter(c => PLAY_CLAUSE.test(textOf(c))).length >= 20, 'the play-clause population collapsed');
  assert.deepEqual(spawnAsPlay(cards), [],
    'these read "play" off a unit ARRIVING; listen on cardPlayed (owner 2026-10-25: "It says \'play\' not \'enters\'")');
});

test('play not arrival CONTROL: the detector convicts the old shape', () => {
  const card = getCard('Proph') as unknown as { abilities: TriggeredAbility[] };
  const was = card.abilities[0]!.events;
  card.abilities[0]!.events = ['spellPlayed', 'spawned'];
  try {
    assert.deepEqual(spawnAsPlay(['Proph']), ['Proph (draw a card)']);
  } finally {
    card.abilities[0]!.events = was;
  }
});
