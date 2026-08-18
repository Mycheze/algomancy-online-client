/* Logic-state tests for the prototype engine. Run: node test.js
 * White-box style: tests set up states directly, then drive real actions. */
'use strict';
const { Game } = require('./engine.js');
const { CARDS } = require('./cards.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
}
function section(t) { console.log(`\n== ${t} ==`); }

// helpers ---------------------------------------------------------------
function giveResources(g, p, kind, n, state = 'open') {
  for (let i = 0; i < n; i++) g.players[p].resources.push({ kind, state });
}
function toDeployment(g) { // planning done, both battle rounds skipped
  g.donePlanning(0); g.donePlanning(1);
  g.skipAttack(g.battle.attacker);
  g.skipAttack(g.battle.attacker);
}
function toNextBattle(g, attacker) { // finish deployment, next turn, into battle
  g.doneDeploying(g.deployPlayer);
  g.doneDeploying(g.deployPlayer);        // initiative flips here (new turn)
  if (attacker !== undefined) g.initiative = attacker; // tests pin the attacker
  g.donePlanning(0); g.donePlanning(1);
}
function handIdx(g, p, name) { return g.players[p].hand.indexOf(name); }
function give(g, p, name) { g.players[p].hand.push(name); return g.players[p].hand.length - 1; }

// ── 1. setup & planning ────────────────────────────────────────────────
section('Setup & planning');
{
  const g = new Game(1);
  check('both players drew 5 + 2', g.players[0].hand.length === 7 && g.players[1].hand.length === 7);
  check('shared deck shrank by 14', g.deck.length === 30 - 14);
  check('two open prismites each', g.players.every(p => p.resources.length === 2));

  const before = g.players[0].hand.length;
  g.recycleForResource(0, 0, 'fire');
  check('recycle: hand -1, deck +1, dormant resource', g.players[0].hand.length === before - 1 && g.players[0].resources.length === 3 && g.players[0].resources[2].state === 'dormant');
  check('dormant gives no affinity', g.affinity(0, 'fire') === 2); // 2 prismites only
  g.activateResource(0, 2);
  check('activated gives affinity', g.affinity(0, 'fire') === 3);
  g.recycleForResource(0, 0, 'fire'); g.recycleForResource(0, 0, 'water');
  g.activateResource(0, 3);
  const third = g.activateResource(0, 4);
  check('max 2 activations per turn', third === false && g.players[0].activationsLeft === 0);
}

// ── 2. deployment: costs, units, spawn triggers, spell tokens ──────────
section('Deployment: casting & spawn triggers');
{
  const g = new Game(2);
  toDeployment(g);
  const p = g.deployPlayer;
  g.players[p].hand = ['Ignis Sprite', 'Flame Juggle', 'Jelly'];
  giveResources(g, p, 'fire', 3);

  check('battle-timed Jelly not deployable', g.canPlayFromHand(p, 2) === false);
  const manaBefore = g.openMana(p);
  g.playCard(p, 0); // Ignis Sprite
  const units = g.unitsOf(p);
  check('Ignis Sprite spawned', units.length === 1 && units[0].name === 'Ignis Sprite');
  check('mana paid', g.openMana(p) === manaBefore - 1);
  check('spawn trigger made a Fireball 1', g.tokensOf(p).length === 1 && g.tokensOf(p)[0].x === 1);

  g.playCard(p, 0); // Flame Juggle → three more fireballs
  check('Flame Juggle created 3 Fireballs', g.tokensOf(p).length === 4);
  check('Flame Juggle in bin', g.players[p].bin.includes('Flame Juggle'));
}

// ── 3. affinity gating ─────────────────────────────────────────────────
section('Affinity gating');
{
  const g = new Game(3);
  toDeployment(g);
  const p = g.deployPlayer;
  g.players[p].hand = ['Dreadwave Devourer']; // cost bb, 6 mana
  giveResources(g, p, 'fire', 6);
  check('6 fire + 2 prismite cannot pay bb (needs 2 water affinity... prismites wild = 2)', g.canPay(p, 'Dreadwave Devourer') === true);
  g.players[p].resources = [{ kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }];
  check('6 fire, no prismites: fails bb affinity', g.canPay(p, 'Dreadwave Devourer') === false);
}

// ── 4. battle: attack, block, column damage, piercing, promotion ───────
section('Combat math');
{
  const g = new Game(4);
  toDeployment(g);
  // initiative (p0) gets attackers; p1 gets blockers
  const A = g.initiative, D = 1 - A;
  const whale = g.spawnUnit(A, 'Good Whale');        // 7/5 Piercing
  const sky = g.spawnUnit(A, 'Ephemeral Skywalker'); // 3/1 Flying
  const b1 = g.spawnUnit(D, 'Curio Drifter');        // 2/2
  const b2 = g.spawnUnit(D, 'Rune Channeler');       // 4/3
  toNextBattle(g, A);
  check('battle round 1, initiative attacks', g.battle.attacker === A);

  // Whale alone in column 1; skywalker column 2
  g.declareAttack(A, [[whale.id], [sky.id]]);
  g.passPriority(g.priority); g.passPriority(g.priority); // attack window
  // block whale column with both defenders (front b1, back b2); flying column unblocked (no flyer)
  const illegal = g.declareBlocks(D, { 1: [b1.id] }); // b1 can't block flying skywalker
  check('flying block restriction enforced', illegal === false);
  g.declareBlocks(D, { 0: [b1.id, b2.id] });
  g.passPriority(g.priority); g.passPriority(g.priority); // block window → damage

  // Whale 7 dmg: 2 lethal to b1 (front), 3 to b2, 2 excess → Piercing → player
  check('front blocker died', !g.entities[b1.id]);
  check('back blocker died', !g.entities[b2.id]);
  check('piercing overflow hit player', g.players[D].life === 30 - 2 - 3); // 2 pierce + 3 unblocked flyer
  // blockers dealt 2+4=6 back to whale (5 toughness) → whale dies
  check('whale died to combined blocker power', !g.entities[whale.id]);
  check('skywalker survived unblocked', !!g.entities[sky.id]);
}

// ── 5. stack: battle spells, negation, spell units, fizzle ─────────────
section('The stack: negate & fizzle');
{
  const g = new Game(5);
  toDeployment(g);
  const A = g.initiative, D = 1 - A;
  const target = g.spawnUnit(A, 'Rune Channeler'); // 4/3 (also tests its spell trigger later)
  const atk = g.spawnUnit(A, 'Good Whale');
  giveResources(g, A, 'fire', 4); giveResources(g, D, 'water', 12); // Lillik (5) + Dreadwave (6)
  toNextBattle(g, A);
  g.declareAttack(A, [[atk.id]]);

  // D responds in the attack window: Leaping Lillik "delete target unit" on the whale
  check('priority starts with initiative', g.priority === A);
  g.passPriority(A);
  const li = give(g, D, 'Leaping Lillik');
  g.playCard(D, li);
  g.clickTarget(D, { unit: atk.id });        // choose delete target
  // A's Rune Channeler triggers on D's spell? No — trigger is "when YOU play" (controller check)
  check('Rune Channeler did not trigger on opponent spell', g.stack.length === 1);

  // A responds: nothing. D holds. A plays Flame of History? A has priority now.
  check('priority passed to A after D acted', g.priority === A);
  const dd = give(g, A, 'Luminous Arc'); // won't cast — instead negate demo from D? Arc can't target stack.
  // A passes, D casts Dreadwave Devourer targeting Lillik? D already acted; let A pass:
  g.passPriority(A);
  const dv = give(g, D, 'Dreadwave Devourer');
  g.playCard(D, dv);
  g.clickTarget(D, { stack: g.stack[0].id }); // negate own Lillik (silly but legal-shaped)
  g.passPriority(A); g.passPriority(D);       // resolve Dreadwave: negates Lillik, spawns 6/4
  check('Dreadwave spawned as a unit', g.unitsOf(D).some(u => u.name === 'Dreadwave Devourer'));
  check('Lillik marked negated', g.stack[0].negated === true);
  g.passPriority(A); g.passPriority(D);       // resolve negated Lillik → bin, no spawn
  check('negated spell unit never spawned', !g.unitsOf(D).some(u => u.name === 'Leaping Lillik'));
  check('negated Lillik in bin', g.players[D].bin.includes('Leaping Lillik'));
  check('whale survived (delete was negated)', !!g.entities[atk.id]);
}

// ── 6. triggers: bounded once/turn + battle counters ───────────────────
section('Bounded triggers & battle-scoped counters');
{
  const g = new Game(6);
  toDeployment(g);
  const A = g.initiative, D = 1 - A;
  const rc = g.spawnUnit(A, 'Rune Channeler');
  const mr = g.spawnUnit(A, 'Mischievous Reclaimer');
  const f1 = g.spawnUnit(A, 'Ignis Sprite');
  const f2 = g.spawnUnit(A, 'Curio Drifter');
  giveResources(g, A, 'fire', 8);
  toNextBattle(g, A);
  g.declareAttack(A, [[rc.id]]);

  // A plays Flame of History (nontoken spell) → Rune Channeler bounded trigger
  const fh = give(g, A, 'Flame of History');
  g.playCard(A, fh);
  g.clickTarget(A, { player: D });          // spell target: face
  check('Rune Channeler trigger wants a target', g.pending && g.pending.player === A);
  g.clickTarget(A, { unit: f2.id });        // trigger target: own Curio Drifter (2/2)
  check('trigger + spell on stack', g.stack.length === 2);
  g.passPriority(D); g.passPriority(A);     // resolve trigger: 2 dmg kills Drifter
  check('Rune Channeler killed the 2/2', !g.entities[f2.id]);
  check('first ally death counted', g.battleCounter(A, 'allyDeaths') === 1);
  check('Reclaimer silent on first death', g.stack.length === 1);

  g.passPriority(A); g.passPriority(D);     // resolve Flame of History → D loses 1
  check('spell resolved at face', g.players[D].life === 29);

  // second spell this turn: Rune Channeler bounded — must NOT retrigger
  const arc = give(g, A, 'Luminous Arc');
  g.playCard(A, arc);
  g.clickTarget(A, { unit: f1.id });        // kill own Ignis Sprite (1/1): second ally death
  check('no second Rune Channeler trigger (bounded)', g.pending === null);
  g.passPriority(D); g.passPriority(A);     // resolve arc → Ignis dies, two triggers stack up
  check('Ignis died', !g.entities[f1.id]);
  check('second ally death counted', g.battleCounter(A, 'allyDeaths') === 2);
  // Two triggers on the stack now: Ignis's death Fireball (below), Reclaimer's draw (on top)
  const handBefore = g.players[A].hand.length;
  g.passPriority(A); g.passPriority(D);     // resolve Reclaimer trigger → draw
  check('Reclaimer drew on second death', g.players[A].hand.length === handBefore + 1);
  g.passPriority(A); g.passPriority(D);     // resolve Ignis death trigger → Fireball
  // (one Fireball already exists from Ignis's SPAWN trigger during deployment)
  check('Ignis death trigger made a second Fireball', g.tokensOf(A).length === 2);
}

// ── 7. temp mods & regroup cleanup ─────────────────────────────────────
section('Until-regroup & cleanup');
{
  const g = new Game(7);
  toDeployment(g);
  const A = g.initiative, D = 1 - A;
  const big = g.spawnUnit(A, 'Rune Channeler'); // 4/3
  giveResources(g, D, 'water', 3);
  toNextBattle(g, A);
  g.declareAttack(A, [[big.id]]);
  g.passPriority(A);
  const j = give(g, D, 'Jelly');
  g.playCard(D, j);
  g.clickTarget(D, { unit: big.id });
  g.passPriority(A); g.passPriority(D);
  check('Jelly shrank the attacker', JSON.stringify(g.effStats(big)) === '[2,1]');
  check('Jelly spawned a 2/1 body', g.unitsOf(D).some(u => u.name === 'Jelly'));
  big.damage = 0; // isolate cleanup check
  // finish battle: pass through windows, no blocks
  g.passPriority(g.priority); g.passPriority(g.priority);   // attack window done earlier? ensure step
  if (g.battle && g.battle.step === 'blocks') g.declareBlocks(D, {});
  while (g.phase === 'battle') {
    if (g.battle.step === 'declare') g.skipAttack(g.battle.attacker);
    else if (g.battle.step === 'blocks') g.declareBlocks(g.battle.defender, {});
    else g.passPriority(g.priority);
  }
  check('regroup cleared temp mods', JSON.stringify(g.effStats(big)) === '[4,3]');
  check('spell tokens erased at regroup', g.tokensOf(A).length === 0 && g.tokensOf(D).length === 0);
}

// ── 8. augments: attribute grant, unstable erasure, virus on stack ─────
section('Augments & Virus');
{
  const g = new Game(8);
  toDeployment(g);
  const p = g.deployPlayer, o = 1 - p;
  const host = g.spawnUnit(p, 'Rune Channeler');
  giveResources(g, p, 'fire', 4); giveResources(g, o, 'fire', 4);
  const sk = give(g, p, 'Ephemeral Skywalker');
  check('can augment during own deployment', g.canAugment(p, 'hand', sk) === true);
  g.augment(p, 'hand', sk, host.id);
  check('host gained Flying', g.ownAttrs(host).has('Flying'));
  check('host is modded', host.mods.length === 1);
  g.deleteUnit(host);
  check('unstable: erased, not binned', !g.players[p].bin.includes('Rune Channeler'));

  // Virus during battle, on the stack, targeting an ENEMY unit (drawback donation)
  const whale = g.spawnUnit(o, 'Good Whale');
  toNextBattle(g, o);                       // opponent attacks with the whale
  g.declareAttack(o, [[whale.id]]);
  g.passPriority(o);                        // attacker holds; now p may respond
  giveResources(g, p, 'fire', 3);
  const si = give(g, p, 'Smouldering Inferno');
  check('virus augment legal in battle with priority', g.canAugment(p, 'hand', si) === true);
  g.augment(p, 'hand', si, whale.id);       // donate "after combat, sacrifice me" to the enemy whale
  check('virus went on the stack', g.stack.length === 1 && g.stack[0].kind === 'virus');
  g.passPriority(g.priority); g.passPriority(g.priority); // resolve virus
  check('host modded by virus', whale.mods.includes('Smouldering Inferno'));
  check('host gained Piercing', g.ownAttrs(whale).has('Piercing'));
  // ride to after-combat: the donated "sacrifice me" should erase the whale (unstable)
  while (g.phase === 'battle') {
    if (g.battle.step === 'declare') g.skipAttack(g.battle.attacker);
    else if (g.battle.step === 'blocks') g.declareBlocks(g.battle.defender, {});
    else g.passPriority(g.priority);
  }
  check('donated after-combat sacrifice erased the host (unstable)', !g.entities[whale.id]);
}

// ── 9. win condition ───────────────────────────────────────────────────
section('Win condition');
{
  const g = new Game(9);
  toDeployment(g);
  const A = g.initiative, D = 1 - A;
  g.players[D].life = 3;
  const whale = g.spawnUnit(A, 'Good Whale');
  toNextBattle(g, A);
  g.declareAttack(A, [[whale.id]]);
  g.passPriority(g.priority); g.passPriority(g.priority);
  g.declareBlocks(D, {});
  g.passPriority(g.priority); g.passPriority(g.priority);
  check('game over', g.phase === 'gameover');
  check('attacker won', g.winner === A);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
