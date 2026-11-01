/* /api/bot/simulate — THE QUESTIONS THAT MOTIVATED IT, ANSWERED BY THE ENGINE.
 *
 * Each fixture is a live judge-bot question (scratchpad judge-D §3, gold
 * g116+) that the bot got wrong or hedged on by reasoning, and that the
 * client can simply be asked:
 *
 * §1 ⭐ Gravitational Correction redirecting a Null Drone (g116): the "choose
 *    a new target for Null Drone" menu offers the other spells on the stack
 *    and NEVER Null Drone itself or the resolving Gravitational Correction —
 *    and with nothing else to point at, the client says there is nothing to
 *    change rather than offering the effect itself
 * §2 ⭐ Balanced + Inverted on a 3/2: the client gives 3/1
 * §3 ⭐ damage across a blocking column: the split menu, and all 10 into the
 *    front unit leaves the one behind untouched
 * §4 ⭐ Lithoghul augmented onto an ENEMY host: its "you" is the host's
 *    controller (opponent 30 → 24)
 * §5 refusals carry the engine's own reason and what WAS legal; a target
 *    that is not offered names the options; the run stops at the refusal
 * §6 the silent defaults are listed under `auto`, never hidden
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, type SimOk, type OfferedOut } from '../simulate.ts';

const run = (spec: unknown): SimOk => {
  const r = simulate(spec, { engine: 'test' });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const menu = (r: SimOk, prompt: RegExp): OfferedOut => {
  const m = r.offered.find(o => prompt.test(o.prompt));
  assert.ok(m, `a menu matching ${prompt} was offered (got: ${r.offered.map(o => o.prompt).join(' | ')})`);
  return m;
};

/* ══ §1 ═════════════════════════════════════════════════════════════ */

const gc = (arcs: number) => ({
  initiative: 'you',
  you: { hand: [...Array.from({ length: arcs }, () => 'Luminous Arc'), 'Gravitational Correction'], play: ['The Foretold'], resources: { fire: 12 } },
  opponent: { hand: ['Null Drone'], play: ['Towering Colossus'], resources: { water: 4 } },
  attack: [['you.0']],
  steps: [
    ...Array.from({ length: arcs }, () => ({ do: 'play', card: 'Luminous Arc', targets: ['opponent.0'] })),
    { seat: 'opponent', do: 'play', card: 'Null Drone', targets: ['stack:Luminous Arc'] },
    { do: 'play', card: 'Gravitational Correction', x: 2, targets: ['stack:Null Drone'] },
    ...(arcs > 1 ? [{ seat: 'opponent', do: 'choose', option: 'decline' }] : []),
  ],
  showOffered: true,
});

test('§1 ⭐ Gravitational Correction on Null Drone: the new-target menu never offers Null Drone or Gravitational Correction', () => {
  const r = run(gc(2));
  assert.ok(r.steps.every(s => s.ok), JSON.stringify(r.steps));
  // GC itself may aim at Null Drone: a spell unit on the stack is a spell effect
  const aim = menu(r, /^Gravitational Correction: change the targets of target effect/);
  assert.ok(aim.options.some(o => o.startsWith('Null Drone')), `Null Drone is a legal target for GC: ${aim.options}`);
  assert.equal(r.offered.find(o => /^Pay \[2\] to keep Null Drone's targets/.test(o.prompt))?.seat, 'opponent',
    'the ransom is asked of Null Drone\'s controller');
  const nu = menu(r, /choose a new target for Null Drone/);
  assert.equal(nu.seat, 'you');
  assert.ok(nu.options.length >= 1 && nu.options.every(o => o.startsWith('Luminous Arc')),
    `only the Arcs are offered: ${nu.options}`);
  assert.ok(!nu.options.some(o => /Null Drone|Gravitational Correction/.test(o)),
    '⭐ the effect being changed is not offered as its own new target, and neither is the resolving GC');
  assert.ok(nu.options.every(o => /\[stack\.\d\]$/.test(o)), 'every option is tagged with its stack ref');
  assert.ok(r.auto.some(a => a.includes('choose a new target for Null Drone')), 'the unscripted pick is listed under auto');
});

test('§1b with only its own target to point at, Null Drone has nothing to change — the effect itself is not a candidate', () => {
  const r = run(gc(1));
  assert.ok(!r.offered.some(o => /choose a new target for Null Drone/.test(o.prompt)), 'no new-target menu at all');
  assert.ok(r.log.some(l => /Null Drone has no target to change/.test(l)), r.log.join('\n'));
});

/* ══ §2 ═════════════════════════════════════════════════════════════ */

test('§2 ⭐ Balanced + Inverted on a 3/2 gives 3/1', () => {
  const r = run({ you: { play: [{ card: 'Static Courier', temp: { attrs: ['Balanced', 'Inverted'] } }] } });
  const u = r.final.units.find(x => x.ref === 'you.0')!;
  assert.equal(u.printed, '3/2');
  assert.equal(u.stats, '3/1');
  assert.deepEqual(u.attrs, ['Balanced', 'Inverted']);
  assert.match(r.patched.join('\n'), /you\.0 Static Courier: Balanced, Inverted until regroup — directly, not by a card/);
  assert.match(r.board, /Static Courier 3\/1 \[Balanced,Inverted\]/, 'the board line shows the built stats');
  // and the same at a battle start (temp applied at the attack declaration)
  const b = run({ you: { play: [{ card: 'Static Courier', temp: { attrs: ['Inverted', 'Balanced'] } }] }, attack: [['you.0']] });
  assert.equal(b.final.units.find(x => x.ref === 'you.0')!.stats, '3/1', 'listed order does not change it: Balanced always applies first');
});

/* ══ §3 ═════════════════════════════════════════════════════════════ */

test('§3 ⭐ damage across a blocking column: the split menu, and all of it into the front unit', () => {
  const spec = (to: Record<string, number>) => ({
    initiative: 'you',
    you: { play: ['Towering Colossus'] },
    opponent: { play: ['Static Courier', 'Tidal Menace'] },
    attack: [['you.0']],
    blocks: { 'opponent.0': 'you.0', 'opponent.1': 'you.0' },
    steps: [{ do: 'assign', to }],
    until: 'endOfCombat', showOffered: true,
  });
  const all = run(spec({ 'opponent.0': 10 }));
  const m = menu(all, /assign combat damage — how much of 10 to Static Courier/);
  assert.equal(m.seat, 'you');
  assert.match(m.options[0]!, /^default — share front-to-back \(4 to Static Courier, 6 to Tidal Menace\)/);
  assert.ok(m.options.includes('4 to Static Courier (lethal)') && m.options.includes('10 to Static Courier (everything)'));
  assert.ok(!m.options.some(o => /^[0-3] to Static Courier/.test(o)), 'less than lethal to the front is never offered');
  assert.equal(all.steps[0]!.did, 'damage assigned: 10 to Static Courier');
  const front = all.final.units.find(u => u.ref === 'opponent.0')!;
  const back = all.final.units.find(u => u.ref === 'opponent.1')!;
  assert.equal(front.zone, 'bin');
  assert.equal(back.zone, 'play');
  assert.ok(all.auto.includes('opponent blocked as scripted'));
  // the default split kills both
  const def = run(spec({ 'opponent.1': 6 }));
  assert.ok(def.auto.some(a => /assign combat damage/.test(a)), 'the unscripted front victim took the default, listed under auto');
});

/* ══ §4 ═════════════════════════════════════════════════════════════ */

test('§4 ⭐ Lithoghul augmented onto an enemy host: "you" is the host\'s controller', () => {
  const r = run({
    initiative: 'you',
    you: { hand: ['Lithoghul', 'Luminous Arc'], play: ['The Foretold'], resources: { earth: 3, fire: 3 } },
    opponent: { play: ['Towering Colossus'], resources: { earth: 2 } },
    attack: [['you.0']],
    steps: [
      { do: 'augment', card: 'Lithoghul', host: 'opponent.0' },
      { do: 'pass' },
      { do: 'play', card: 'Luminous Arc', targets: ['opponent.0'] },
    ],
  });
  assert.deepEqual(r.final.life, { you: 30, opponent: 24 });
  assert.deepEqual(r.final.units.find(u => u.ref === 'opponent.0')!.mods, ['Lithoghul']);
  assert.ok(r.log.some(l => /Lithoghul deals 6 to Opponent/.test(l)), r.log.join('\n'));
  assert.equal(r.final.mana.you, '6 open → 3 open');
});

/* ══ §5 ═════════════════════════════════════════════════════════════ */

test('§5 refusals carry the engine\'s reason and what was legal; the run stops there', () => {
  const deployInBattle = run({
    you: { hand: ['Static Courier', 'Luminous Arc'], play: ['The Foretold'], resources: { fire: 5 } },
    attack: [['you.0']],
    steps: [{ do: 'play', card: 'Static Courier' }, { do: 'play', card: 'Luminous Arc', targets: ['you.0'] }],
  });
  assert.equal(deployInBattle.steps.length, 1, 'the second step never ran');
  assert.equal(deployInBattle.steps[0]!.ok, false);
  assert.equal(deployInBattle.steps[0]!.refused, 'only battle cards can be played now');
  assert.ok(deployInBattle.steps[0]!.legal!.includes('play Luminous Arc'), 'what WAS legal is listed');
  assert.match(deployInBattle.limit!, /stopped at step 0 \(refused\); 1 later step/);

  const notOffered = run({
    you: { hand: ['Luminous Arc'], play: ['The Foretold'], resources: { fire: 5 } },
    attack: [['you.0']],
    steps: [{ do: 'play', card: 'Luminous Arc', targets: ['opponent'] }],
  });
  assert.match(notOffered.steps[0]!.refused!, /opponent \(the player\) is not offered as a target/);
  assert.deepEqual(notOffered.steps[0]!.options, ["The Foretold (You's) [you.0]"]);

  const notInHand = run({ you: { play: ['The Foretold'] }, steps: [{ do: 'play', card: 'Luminous Arc' }] });
  assert.match(notInHand.steps[0]!.refused!, /Luminous Arc is not in you's hand/);
});

/* ══ §6 ═════════════════════════════════════════════════════════════ */

test('§6 the silent defaults are listed, never hidden', () => {
  const r = run({ you: { play: ['The Foretold'] }, opponent: { play: ['Tidal Menace'] }, until: 'endOfTurn' });
  assert.ok(r.auto.includes('you finished deploying') && r.auto.includes('opponent finished deploying'), r.auto.join(' | '));
  assert.equal(r.final.phase, 'planning', 'endOfTurn runs to the next turn');
  assert.equal(r.limit, null);
});
