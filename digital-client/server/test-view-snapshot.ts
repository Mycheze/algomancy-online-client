/* R85 — the rollback snapshot must never leave the server
 * (run: node test-view-snapshot.ts). No sockets: builds a real mid-resolution
 * suspension with the engine and reads viewFor() directly.
 *
 * Since round 15 the engine stops rolling a suspended resolution back the
 * instant it suspends and does it on RESUME instead, so that the half-finished
 * resolution is what everyone gets to look at while somebody is being asked
 * something. The state to rewind TO rides on the suspension — a whole
 * GameState, and a completely unredacted one: both hands, the deck order, the
 * face-down resources.
 *
 * `viewFor` already hides a suspension from the seat it does not belong to.
 * That is not enough here: the seat the decision DOES belong to is served
 * their suspension, and would be served their opponent's hand along with it.
 * So the snapshot is stripped for everybody, which is safe because no client
 * has any use for it — only the server's own apply() ever reads it.
 */
import { apply, createGame } from '../engine/src/apply.ts';
import { registerSynthetic } from '../engine/src/cards/dsl.ts';
import type { GameState, Seat } from '../engine/src/types.ts';
import { HIDDEN_CARD, viewFor } from './view.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

// a deploy-phase spell that stops halfway through resolving and asks a question
registerSynthetic({
  name: 'Test Halt', cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, 'Test Halt');
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Test Halt: carry on?', options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});

/** drive a fresh game to deployment and suspend a resolution there */
function suspendedGame(): { state: GameState; seat: Seat } {
  let s = createGame(8501, ['Ben', 'Rashi']).state;
  const step = (a: Parameters<typeof apply>[1]): void => { s = apply(s, a).state; };
  step({ type: 'donePlanning', seat: 0 });
  step({ type: 'donePlanning', seat: 1 });
  if (s.hasteDone) { step({ type: 'doneHaste', seat: 0 }); step({ type: 'doneHaste', seat: 1 }); }
  step({ type: 'declareAttack', seat: s.battle!.attacker, columns: [] });
  if (s.phase === 'battle') step({ type: 'declareAttack', seat: s.battle!.attacker, columns: [] });
  const seat = s.deployPlayer!;
  s.players[seat]!.hand.push('Test Halt');
  step({ type: 'playCard', seat, handIndex: s.players[seat]!.hand.length - 1 });
  return { state: s, seat };
}

console.log('\n[R85 rollback snapshot redaction]');
const { state, seat } = suspendedGame();
const opp = (seat === 0 ? 1 : 0) as Seat;

ok(state.suspension?.type === 'resolve', 'the engine really is suspended mid-resolution');
ok(state.suspension?.type === 'resolve' && !!state.suspension.snapshot,
   'and the authoritative state carries the rollback snapshot');

const mine = viewFor(state, seat);
ok(mine.decision !== null, 'the deciding seat is still served their decision');
ok(mine.suspension !== null, 'and the suspension that carries its options');
ok(mine.suspension?.type === 'resolve' && mine.suspension.snapshot === undefined,
   'THE LEAK: but not the rollback snapshot');

const theirs = viewFor(state, opp);
ok(theirs.suspension === null, "the other seat gets no suspension at all (it isn't theirs)");

// belt and braces: no unredacted copy of the opponent's hand anywhere in the
// view, at any depth. The snapshot was exactly such a copy.
const oppHand = state.players[opp]!.hand;
ok(oppHand.length > 0, 'the opponent is holding cards to leak');
const wire = JSON.stringify(mine);
const leaked = oppHand.filter(c => c !== HIDDEN_CARD && wire.includes(`"${c}"`)
  && !state.players[seat]!.hand.includes(c));
ok(leaked.length === 0, `no opponent hand card appears in the deciding seat's view (${leaked.join(', ')})`);

// and the deck order, which the snapshot also carried in full
const deckRun = state.sharedDeck.slice(0, 5).map(c => `"${c}"`).join(',');
ok(state.sharedDeck.length >= 5 && !wire.includes(deckRun), 'nor the shared deck order');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
