/* Direct-drive test of the simultaneous-deployment hiding machinery
 * (run: node test-deploy.ts). No sockets: drives rooms.ts + view.ts the way
 * main.ts does and checks the freeze/holdback/reveal bookkeeping. */
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Seat } from '../engine/src/types.ts';
import { forcedAction } from '../engine/src/apply.ts';
import { viewFor } from './view.ts';
import { applyToRoom, clearDeployHold, createRoom, undoActionAt } from './rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

const room = createRoom('DEPT', 424242);

/** apply + drain forced steps, exactly like main.ts */
function act(a: Parameters<typeof applyToRoom>[1]): void {
  applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    applyToRoom(room, f);
  }
}

console.log('\n[into deployment]');
act({ type: 'donePlanning', seat: 0 });
act({ type: 'donePlanning', seat: 1 });
// empty boards: the forced drain walks the whole battle by itself
ok(room.state.phase === 'deploy', 'forced actions drained the empty battle into deploy');
ok(room.deploySnapshot !== null, 'deploy snapshot captured');
ok(room.deployStartIndex === room.actions.length, 'deploy segment starts after the drained battle');

console.log('\n[hidden deployment]');
// give seat 1 something to deploy (test-only state injection)
room.state.players[1]!.resources.push({ kind: 'fire', state: 'open' });
room.state.players[1]!.hand.push('Ignis Sprite');
const handSize0Sees = viewFor(room.state, 0, room.deploySnapshot).players[1]!.hand.length;
act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });

// (Ignis Sprite's spawn trigger also makes a Fireball token — both are seat 1's)
const unitIds = Object.values(room.state.entities).filter(e => e.controller === 1 && e.kind === 'unit').map(e => e.id);
ok(unitIds.length === 1, 'the unit really exists in the authoritative state');
const v0 = viewFor(room.state, 0, room.deploySnapshot);
ok(!Object.values(v0.entities).some(e => e.controller === 1),
  "seat 0's view hides the opponent's freshly deployed unit");
ok(v0.players[1]!.hand.length === handSize0Sees,
  "seat 0 still sees the opponent's hand size as of deploy start");
const v1 = viewFor(room.state, 1, room.deploySnapshot);
ok(Object.values(v1.entities).some(e => e.controller === 1),
  'seat 1 sees their own deployed unit');
ok(room.heldDeploy[0].length > 0 && room.heldDeploy[1].length === 0,
  "the play's events are held back from seat 0 only");

console.log('\n[undo a hidden deploy action]');
act({ type: 'doneDeploying', seat: 0 });   // seat 0 finishes first
// seat 1's play is NOT the last action overall — the deploy splice handles it
const myLast = (() => {
  let i = room.actions.length - 1;
  while (i >= room.deployStartIndex && room.actions[i]!.seat !== 1) i--;
  return i;
})();
ok(room.actions[myLast]!.type === 'playCard', 'found seat 1 play inside the deploy segment');
undoActionAt(room, myLast);
ok(!Object.values(room.state.entities).some(e => e.controller === 1), 'undo removed the unit');
ok(room.state.deployDone?.[0] === true, "seat 0's earlier done-flag survived the splice rebuild");
ok(room.deploySnapshot !== null, 'rebuild restored the deploy snapshot');

console.log('\n[reveal]');
// replay the play, then finish deployment on both sides
room.state.players[1]!.resources.push({ kind: 'fire', state: 'open' });
room.state.players[1]!.hand.push('Ignis Sprite');
act({ type: 'playCard', seat: 1, handIndex: room.state.players[1]!.hand.length - 1 });
const heldFor0 = room.heldDeploy[0].length;
ok(heldFor0 > 0, 'events held for seat 0 before the reveal');
act({ type: 'doneDeploying', seat: 1 });
ok(room.state.phase === 'planning' && room.state.turn === 2, 'both done → next turn');
clearDeployHold(room);
const v0After = viewFor(room.state, 0, room.deploySnapshot);
ok(Object.values(v0After.entities).some(e => e.controller === 1),
  'after the reveal seat 0 sees the deployed unit');

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
rmSync(join(HERE, 'games', 'DEPT.json'), { force: true });
process.exit(failures ? 1 : 0);
