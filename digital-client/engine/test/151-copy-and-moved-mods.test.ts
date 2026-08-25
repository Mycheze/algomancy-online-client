/* R178 — THREE THINGS THE DESIGNER SAYS, AND THE ENGINE SAID OTHERWISE.
 *
 * 1. WHEN "targeting me" is asked (Earthbound Replicator). RAQ "[Solved]
 *    Earthbound Replicator. No, it's not infinity" (_passer):
 *      *"He must be targeted while playing the spell. If the spell is played
 *       and target is changed later to him (through Gravitational Correction
 *       or Enigmatic Warder mod), you don't get a copy"*
 *    The card asked at RESOLUTION, against the item's live targets, so a
 *    retarget landing in between wrongly EARNED a copy and a retarget away
 *    wrongly CANCELLED one. It is a condition, so R1 puts it in `when`, and
 *    the `spellPlayed` event carries the declared targets because that event
 *    fires before `pushItem` and there is no stack to consult yet.
 *
 * 2. WHICH item the trigger acts on — the third bottom-up `.find()` after
 *    R166's two (Origon, Hexbane Shiitake). With two same-card same-seat
 *    spells on the stack it copied the OLDER one. The event carries the item
 *    id now, so it is identity rather than any kind of scan.
 *
 * 3. WHAT KIND of thing Maelstrom Charger's line is. RAQ "[Solved] Maelstrom
 *    Charger - all you need to know." (_passer):
 *      *"Maelstrom Charger Ability has unique wording, which works kinda like
 *       cost (but is still optional due to* may*). As you play spell you can
 *       decide to Sacrifice Mael to put copy of spell effect on stack (above
 *       original spell effect)."*
 *      *"Meal copying is not an effect on the stack so enemy cannot interact
 *       with it. Opponent can only interact with copy of a spell effect."*
 *      *"Maelstrom Ability is neither Triggered nor Activated, so Crevice
 *       Lurker doesn't affect it."*
 *      *"If multiple Maelstrom Chargers are in play, while playing a spell you
 *       can decide to Sac none/one/two for 0/1/2 copies of spell effect. This
 *       works with Ancient One adjacent to Maelstrom Charger."*
 *    It was an ordinary `triggered` ability, so it reached the stack (and
 *    could be negated before the copy was ever made) and R121's pay-to-trigger
 *    gate taxed it. It is `CardBehavior.asYouPlay` now — a stage of the CAST
 *    WINDOW (E.collectAsYouPlay), never an item.
 *
 * 4. And MOVE-A-MOD, which had no primitive because nothing had ruled on what
 *    a move carries. The owner did, 2026-08-25, verbatim: *"Unstable is just
 *    an attribute granted to all entities that are modded. Of course it moves
 *    with the mods."* Everything follows the mod, and the mechanism is that
 *    there is no mechanism — {Unstable} is DERIVED (`E.isUnstable` reads
 *    `mods.length`) and every radiated channel re-anchors through
 *    `anchored()`'s live `modOf` lookup. `E.moveMod` keeps that one field
 *    honest; Reconfigure and Rotbeast both route through it.
 *
 * Seeds 15100-15199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import type { DecisionOption, Entity, EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle,
} from './util.ts';

// ── helpers ─────────────────────────────────────────────────────────────

/** run raw engine calls against the harness state, absorbing a suspension */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try { f(e); e.settle(); } catch (sig) { if (!(sig instanceof Suspended)) throw sig; }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** answer the pending decision by option LABEL — the as-you-play option's
 * value names WHICH BODY is being asked, which `pick` cannot express. */
function say(h: Harness, label: string): void {
  const dec = h.state.decision;
  if (!dec) throw new Error(`no decision is pending; expected one offering "${label}"`);
  const idx = dec.options.findIndex(o => o.label.includes(label));
  if (idx === -1) throw new Error(`no option labelled "${label}" in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

const labels = (h: Harness): string[] => (h.state.decision?.options ?? []).map(o => o.label);
const copies = (h: Harness) => h.state.stack.filter(i => i.copy);
const unstable = (h: Harness, id: EntityId): boolean => new E(h.state).isUnstable(ent(h, id)!);
const modsOn = (h: Harness, id: EntityId): Entity[] =>
  (ent(h, id)?.mods ?? []).map(m => ent(h, m)!).filter(Boolean);

/** give `seat` priority if they do not already have it */
function toPriority(h: Harness, seat: Seat): void {
  if (h.state.priority !== seat) pass(h);
  assert.equal(h.state.priority, seat, 'the seat this step is about has priority');
}

/** drive every pending decision and priority pass until the stack is empty */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  let guard = 120;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) { h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) }); continue; }
      const i = Math.max(0, dec.options.findIndex(choose));
      h.do({ type: 'decide', seat: dec.seat, choice: i });
      continue;
    }
    if (!h.state.stack.length) return;
    if (h.state.priority === null) return;
    pass(h);
  }
  throw new Error('resolveAll did not settle');
}

// ═══════════════ 1. "targeting me" is asked AT THE PLAY ═══════════════════

test('R178 Earthbound Replicator: a spell played at something ELSE and retargeted onto me makes NO copy', () => {
  const h = new Harness(15100);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');            // 1/3
  // the RAQ's own instrument, verbatim: "target is changed later to him
  // (through Gravitational Correction or Enigmatic Warder mod)". Worn as a
  // mod, the Warder's "change a target … TO ME" means its HOST — me.
  whiteBox(h, e => { e.attachMod(e.entity(repl)!, 'Enigmatic Warder', D, 'augment'); });
  const warderMod = ent(h, repl)!.mods[0]!;
  giveResources(h, A, 'wood', 2);                               // Burgeon: g, mana 2
  giveResources(h, D, 'earth', 2);                              // the Warder's [two]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: atk });                                       // aimed at A's OWN attacker
  pick(h, 'power');                                             // R57: the half, at cast
  assert.equal(h.state.stack.length, 1,
    'R1: "targeting me" is asked in `when`, at the moment of the play — I was not a target, '
    + 'so NOTHING queued. This used to fire on every nonunit spell and decide at resolution.');

  toPriority(h, D);
  h.do({ type: 'activateAbility', seat: D, entityId: repl, abilityIndex: 0, via: { mod: warderMod } });
  pick(h, { stack: h.state.stack[0]!.id });                     // aim the Warder at the Burgeon
  pass(h); pass(h);                                             // the retarget resolves
  assert.ok(h.state.stack[0]!.parts[0]!.targets.some(t => 'unit' in t && t.unit === repl),
    'setup: the Burgeon really is aimed at me now');

  assert.equal(copies(h).length, 0,
    'RAQ: "He must be targeted WHILE PLAYING the spell … you don\'t get a copy"');
  pass(h); pass(h);                                             // the Burgeon resolves
  assert.equal(copies(h).length, 0, 'and no copy appears on the way out either');
  assert.equal(effStats(h, repl)[0], 2, 'doubled ONCE: 1 → 2, not 1 → 2 → 4');
  finishBattle(h);
});

test('R178 Earthbound Replicator: a spell played AT ME and retargeted away still makes its copy', () => {
  const h = new Harness(15101);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');
  const warder = spawn(h, D, 'Enigmatic Warder');                // 1/2, its own text live
  giveResources(h, A, 'wood', 2);
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });                                       // played AT me: the copy is owed
  pick(h, 'power');
  assert.equal(h.state.stack.length, 2, 'the Burgeon, and my trigger above it');

  // the Warder pulls the Burgeon off me before my trigger resolves. The copy
  // was earned at the play and is not taken back.
  toPriority(h, D);
  h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);                                              // the retarget resolves
  assert.ok(!h.state.stack[0]!.parts[0]!.targets.some(t => 'unit' in t && t.unit === repl),
    'setup: the Burgeon no longer points at me');

  pass(h); pass(h);                                              // my trigger resolves
  pick(h, false);                                                // A keeps the declared targets
  assert.equal(copies(h).length, 1,
    'the condition was true when the spell was PLAYED, so the copy is owed; retargeting '
    + 'afterwards cannot un-earn it. This used to re-read the live targets and cancel it.');
  finishBattle(h);
});

// ═══════════════ 2. WHICH of two identical spells ════════════════════════

test('R178 Earthbound Replicator: with two identical spells on the stack it copies the TOP one', () => {
  const h = new Harness(15102);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, (1 - A) as Seat, 'Earthbound Replicator');
  giveResources(h, A, 'wood', 4);                                // two Burgeons
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  // TWO GENUINE PLAYS of the same card by the same seat — not a copy. R164
  // already excludes copies from this lookup, so a copy fixture could not
  // prove the ordering; only two real items can.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'power');                                              // the OLDER one doubles power
  toPriority(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'defense');                                            // the NEWER one doubles defense
  assert.equal(h.state.stack.length, 4, 'Burgeon, trigger, Burgeon, trigger');

  pass(h); pass(h);                                              // the TOP trigger resolves
  pick(h, false);
  const copy = copies(h)[0]!;
  assert.equal(copy.parts[0]!.mode, 'defense',
    'the trigger belongs to the spell that was just played — the TOP one. A bottom-up '
    + '`.find()` matched the older item and copied \'power\' instead; this is the third '
    + 'instance of the bug R166 fixed on Origon and Hexbane Shiitake, and the event carries '
    + 'the item id now, so it is identity rather than a scan.');
  resolveAll(h); finishBattle(h);
});

// ═══════════════ 3. Maelstrom Charger is not an ability ══════════════════

test('R178 Maelstrom Charger: the option is asked in the cast window and never reaches the stack', () => {
  const h = new Harness(15110);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  toPriority(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });
  pick(h, { player: A });

  // THE QUESTION IS OPEN AND NOTHING IS ON THE STACK FOR IT. RAQ: "Meal
  // copying is not an effect on the stack so enemy cannot interact with it."
  assert.ok(labels(h).some(l => l.includes('Sacrifice Maelstrom Charger')),
    'the option is offered as the spell is played');
  assert.deepEqual(h.state.stack.map(i => i.kind), [],
    'and there is NO stack item for it — not even the Fireball yet: the whole play, this '
    + 'decision included, happens before anything is pushed. As a triggered ability this was '
    + 'a real item that Dematerialize could eat before the copy was ever made.');
  assert.equal(h.state.suspension?.type, 'cast',
    'it is a CAST-window suspension — the same machinery as X, the modes and the bracketed '
    + 'costs, and not a trigger waiting its turn on the stack');

  say(h, 'Sacrifice Maelstrom Charger');
  assert.ok(!ent(h, chg), 'cost-shaped: the sacrifice is spent the instant the option is taken');
  pick(h, false);                                                // keep the original target
  assert.equal(h.state.stack.filter(i => i.copy).length, 1, 'and it bought exactly one copy');
  const [orig, copy] = h.state.stack;
  assert.ok(!orig!.copy && copy!.copy,
    'RAQ: "put copy of spell effect on stack (above original spell effect)" — the copy resolves first');
  assert.ok(!h.state.stack.some(i => i.kind === 'triggered' || i.kind === 'activated'),
    'RAQ: "Maelstrom Ability is neither Triggered nor Activated"');
  finishBattle(h);
});

test('R178 Maelstrom Charger: Crevice Lurker cannot tax it, on a board where it prevents a real trigger', () => {
  const h = new Harness(15111);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Maelstrom Charger');
  // the battle happens in the DEFENDER's region, so a Lurker that is to reach
  // this play has to be standing in it — "Abilities" is unqualified, so D's own
  // Lurker taxes D's own triggers.
  spawn(h, D, 'Crevice Lurker');            // "Abilities cost [one] more to … trigger during battle"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  assert.equal(new E(h.state).openMana(D), 0, 'setup: D cannot pay a [1] tax on anything');
  // the CONTROL: the same board taxes a real trigger to death. R121 —
  // "choosing to not pay this prevents the abilities from triggering", and
  // with no mana at all there is not even an offer.
  assert.equal(new E(h.state).abilityTax(D, 'Maelstrom Charger', h.state.battle!.region, 'trigger').total, 1,
    'the Lurker layer is live and reaches this seat and this card');

  toPriority(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });
  pick(h, { player: A });
  assert.ok(labels(h).some(l => l.includes('Sacrifice Maelstrom Charger')),
    'RAQ: "Maelstrom Ability is neither Triggered nor Activated, so Crevice Lurker doesn\'t '
    + 'affect it." As a triggered ability the Lurker taxed it [1], D had no mana, and the '
    + 'option was PREVENTED outright — the player was never even asked.');
  assert.ok(!h.log.some(l => l.includes('the trigger is prevented')),
    'and no prevention was announced, because nothing triggered');
  resolveAll(h); finishBattle(h);
});

test('R178 Maelstrom Charger: two Chargers are two questions and two copies (none/one/two)', () => {
  const h = new Harness(15112);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Maelstrom Charger');
  spawn(h, D, 'Maelstrom Charger');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  const lifeA = h.state.players[A]!.life;
  toPriority(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });
  pick(h, { player: A });
  say(h, 'Sacrifice Maelstrom Charger');                         // the first body
  say(h, 'Sacrifice Maelstrom Charger');                         // the second — asked separately
  pick(h, false); pick(h, false);                                // each copy keeps the original target
  assert.equal(copies(h).length, 2,
    'RAQ: "If multiple Maelstrom Chargers are in play … you can decide to Sac none/one/two '
    + 'for 0/1/2 copies of spell effect."');
  assert.equal(new E(h.state).unitsOf(D, h.state.battle!.region).length, 0, 'both were sacrificed');
  resolveAll(h);
  assert.equal(h.state.players[A]!.life, lifeA - 3, 'two copies and the original: 3 Fireball 1s');
  finishBattle(h);
});

test('R178 Maelstrom Charger: declining the sacrifice says so and copies nothing', () => {
  const h = new Harness(15113);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  toPriority(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fb });
  pick(h, { player: A });
  say(h, 'Decline');
  assert.equal(copies(h).length, 0, 'a *may* declined is nothing happening');
  assert.ok(ent(h, chg), 'and the Charger is still standing');
  assert.ok(h.log.some(l => l.includes('Maelstrom Charger') && l.includes('declines')),
    'test/85\'s rule: a declined *may* must SAY it was declined, or the log shows a question '
    + 'with no answer');
  finishBattle(h);
});

// ═══════════════ 4. MOVE A MOD, and everything follows it ════════════════

test('R178 Rotbeast: a moved augment takes {Unstable} and its static with it', () => {
  const h = new Harness(15120);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const rot = spawn(h, A, 'Rotbeast');                           // 1/4, its [Augment] text live
  const enemy = spawn(h, D, 'Legion of the Depths');             // 0/8 — survives the hit
  whiteBox(h, e => { e.attachMod(e.entity(rot)!, 'Aetherflux Golem', A, 'augment'); });

  assert.deepEqual(effStats(h, rot), [3, 6], 'setup: "[Augment] I gain +2/+2" buffs its host');
  assert.ok(unstable(h, rot), 'setup: a modded card is Unstable (R69) — DERIVED from mods.length');
  assert.ok(!unstable(h, enemy), 'setup: the enemy carries nothing and is stable');

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rot]] });
  resolveAll(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [enemy] } });
  resolveAll(h);
  pass(h); pass(h);                                              // combat damage → after combat
  resolveAll(h);

  assert.deepEqual(modsOn(h, rot).map(m => m.card), [], 'the augment left me');
  assert.deepEqual(modsOn(h, enemy).map(m => m.card), ['Aetherflux Golem'], 'and landed on the enemy');
  // THE OWNER'S RULING, 2026-08-25: "Unstable is just an attribute granted to
  // all entities that are modded. Of course it moves with the mods." Nothing
  // is bookkept for it — E.isUnstable reads mods.length, so both halves are
  // true the instant `modOf` is re-pointed.
  assert.ok(!unstable(h, rot), 'my last mod left, so I am not Unstable any more');
  assert.ok(unstable(h, enemy), 'and the new host is Unstable now');
  // and the STATIC re-anchored with it: anchored() resolves a mod's host by
  // `modOf` at read time, so the layer simply stops applying to me.
  assert.deepEqual(effStats(h, rot), [1, 4], 'the +2/+2 stopped being mine');
  assert.deepEqual(effStats(h, enemy), [2, 10], 'and started being theirs');
  assert.equal(modsOn(h, enemy)[0]!.controller, D,
    'the mod\'s controller follows its host — the augment radiates for the enemy now');
  finishBattle(h);
});

test('R178 Reconfigure: the moved unit\'s own mods re-parent through the same primitive', () => {
  const h = new Harness(15121);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const dd = spawn(h, D, 'Decay Distributor');                   // has [Augment] — movable
  const host = spawn(h, D, 'Unit Token');
  whiteBox(h, e => { e.attachMod(e.entity(dd)!, 'Aetherflux Golem', D, 'augment'); });
  assert.deepEqual(effStats(h, dd), [2, 9], 'setup: the Golem buffs the unit it is on (0/7 → 2/9)');
  assert.ok(!unstable(h, host), 'setup: the new host carries nothing yet');
  const baseHost = effStats(h, host);

  giveResources(h, D, 'earth', 1); giveResources(h, D, 'metal', 1); giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  toPriority(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  pick(h, { unit: dd });                                         // the unit to move
  pick(h, { unit: host });                                       // the unit it augments onto
  pass(h); pass(h);

  assert.deepEqual(modsOn(h, host).map(m => m.card), ['Decay Distributor', 'Aetherflux Golem'],
    '"…and all of its mods onto another target unit"');
  assert.ok(modsOn(h, host).every(m => m.modOf === host && m.controller === D),
    'E.moveMod re-points modOf and carries the controller across');
  assert.ok(unstable(h, host), 'the new host is modded, so it is Unstable — derived, not stamped');
  assert.deepEqual(effStats(h, host), [baseHost[0] + 2, baseHost[1] + 2],
    'and the moved Golem\'s static re-anchored on it');
  finishBattle(h);
});

test('R178 Maelstrom Charger: an Ancient One beside one offers the option and sacrifices ITSELF', () => {
  const h = new Harness(15114);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const chg = spawn(h, A, 'Maelstrom Charger');
  const ancient = spawn(h, A, 'Ancient One');                    // "I have all abilities of adjacent allies"
  toNextBattle(h, A);
  // one COLUMN is what "adjacent" means in this engine
  h.do({ type: 'declareAttack', seat: A, columns: [[chg, ancient]] });
  resolveAll(h);
  let fb = 0;
  whiteBox(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  toPriority(h, A);
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });
  pick(h, { player: (1 - A) as Seat });

  // RAQ: "This works with Ancient One adjacent to Maelstrom Charger." The
  // option is read off the FACE (`asYouPlay` is a BEHAVIOR_CHANNELS member, so
  // it rides Ancient One's projection), and "sacrifice ME" means the BODY that
  // is wearing it — which is why the offer is keyed on (anchor, face) and the
  // label names the anchor.
  say(h, 'Decline');                                             // the Charger keeps itself
  assert.ok(labels(h).some(l => l.includes('Sacrifice Ancient One')),
    'a SECOND, separate offer: the Ancient One is wearing the Charger\'s face');
  say(h, 'Sacrifice Ancient One');
  pick(h, false);
  assert.ok(ent(h, chg), 'the real Charger is untouched — it declined its own offer');
  assert.ok(!ent(h, ancient), 'the mimic paid with its own body');
  assert.equal(copies(h).length, 1, 'and bought a copy with it');
  resolveAll(h); finishBattle(h);
});
