/* BL-24 — the formation questions must survive the client/server offer path
 * (run: node test-formation-decision.ts). No sockets: builds each of the two
 * formation asks with the real engine and reads viewFor() + legalActions()
 * directly — the exact pair main.ts pushes to a seat on every update.
 *
 * The owner reported the whole "into formation" / "in my formation" class as
 * not working. The engine guards for the class are green
 * (engine/test/108-formation-class.test.ts, per card), so what this file pins
 * is the seam the engine suite cannot see: that the ask actually REACHES the
 * seat that must answer it, intact and JSON-serializable, and that the decide
 * answers are offered — while the opponent's view of the same moment is
 * redacted to nothing actionable. Both mechanisms are pinned, because they
 * suspend differently and are redacted differently:
 *
 *   R75 (Hooba-* — "create … in my formation"): the ask is raised while an
 *   effect RESOLVES, so it rides a 'resolve' suspension whose rollback
 *   snapshot must be stripped even for the seat that owns the decision.
 *
 *   R29 (Tiderunner Initiate — "play me into an open spot"): the ask is part
 *   of the CAST, raised by playCard itself, and its option values are
 *   FormationSpot descriptors that must round-trip JSON unchanged.
 */
import { legalActions } from '../../engine/src/apply.ts';
import { Harness } from '../../engine/src/harness.ts';
import type { Seat } from '../../engine/src/types.ts';
import {
  give, giveResources, pass, spawn, toDeployment, toNextBattle,
} from '../../engine/test/util.ts';
import { viewFor } from '../view.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** the per-seat relay contract for the pending formation ask in `h.state` */
function checkRelay(h: Harness, name: string): void {
  const s = h.state;
  const seat = s.decision!.seat;
  const opp = other(seat);

  // the seat that must answer gets the ask, unchanged, and it survives JSON
  const mine = JSON.parse(JSON.stringify(viewFor(s, seat)));
  ok(mine.decision !== null, `${name}: the asked seat's view carries the decision`);
  ok(mine.decision.kind === 'formationSlot',
    `${name}: as kind 'formationSlot' — not the entity-id-valued 'electricPath'`);
  ok(JSON.stringify(mine.decision.options) === JSON.stringify(s.decision!.options),
    `${name}: every option (label and value) round-trips the wire intact`);
  ok(!mine.suspension?.snapshot,
    `${name}: the R85 rollback snapshot never reaches even the asked seat`);
  const answers = legalActions(s, seat);
  ok(answers.length === s.decision!.options.length
    && answers.every(a => a.type === 'decide' && a.seat === seat),
    `${name}: the offered actions are exactly the decide answers`);

  // the opponent sees that SOMETHING is pending, but nothing private and
  // nothing actionable — their legal list is empty, their decision null
  const theirs = JSON.parse(JSON.stringify(viewFor(s, opp)));
  ok(theirs.decision === null, `${name}: the opponent's view redacts the decision`);
  ok(theirs.suspension === null, `${name}: …and the suspension carrying its options`);
  ok(legalActions(s, opp).length === 0, `${name}: the opponent is offered nothing to do`);
}

// ── R75: Hooba-Bot's Robot, asked while the trigger resolves ─────────────
{
  const h = new Harness(9001, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const bot = spawn(h, A, 'Hooba-Bot');
  spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bot]] });
  pass(h); pass(h);                                   // the trigger resolves and asks
  ok(h.state.decision?.seat === A, 'R75: the slot ask is pending for the controller');
  checkRelay(h, 'R75 Hooba-Bot');
}

// ── R29: Tiderunner Initiate, asked by the cast itself ───────────────────
{
  const h = new Harness(7301, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  giveResources(h, A, 'water', 1);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  ok(h.state.decision?.seat === A, 'R29: the cast raises the spot ask for the caster');
  checkRelay(h, 'R29 Tiderunner');
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('formation-decision relay: all good');
