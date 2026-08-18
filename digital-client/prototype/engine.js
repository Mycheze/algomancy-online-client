/* Algomancy prototype rules engine — hotseat 1v1 slice.
 *
 * Deliberately simplified vs the real game (see README.md): no regions, no
 * draft, no grafts, one damage sub-step (no Swift/Sluggish), battle is two
 * sequential rounds (initiative attacks, then the other player) instead of
 * the real counterattack declaration, and hands are visible (test rig).
 *
 * What it DOES implement faithfully enough to poke at:
 *   global turn (Planning → Battle → Regroup → Deployment), resources as
 *   permanents (dormant/open/expended, 2 activations per turn, affinity +
 *   mana), the FILO stack with priority passing, negation & fizzling,
 *   triggered abilities (incl. once-per-turn bounds and "second ally death
 *   this battle" counters), spell units, spell tokens (Fireball), augments
 *   incl. Virus augments on the stack, column combat with shared attributes
 *   (Flying / Evasive / Piercing), front-to-back damage with piercing
 *   overflow, until-regroup temp mods, damage persisting across the battle,
 *   and unstable (modded) units erasing on death.
 */
'use strict';
if (typeof CARDS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(globalThis, require('./cards.js')); // Node: pull card defs into scope
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OTHER = p => 1 - p;

class Game {
  constructor(seed = 42, names = ['Player 1', 'Player 2']) {
    this.rng = mulberry32(seed);
    this.turn = 0;
    this.initiative = 0;
    this.phase = 'setup';
    this.log = [];
    this.nextId = 1;
    this.entities = {};            // id -> in-play object (unit or spell token)
    this.stack = [];               // FILO; last = top
    this.pending = null;           // {player, prompt, candidates, onPick}
    this.triggerQueue = [];
    this.winner = null;

    this.players = names.map(name => ({
      name, life: 30, hand: [], bin: [],
      resources: [{ kind: 'prismite', state: 'open' }, { kind: 'prismite', state: 'open' }],
      activationsLeft: 2,
    }));

    // shared deck: 2 copies of each pool card, shuffled
    this.deck = [];
    for (const n of DECK_LIST) this.deck.push(n, n);
    this.shuffle(this.deck);
    for (const p of [0, 1]) this.drawN(p, 5, true);

    this.battle = null;            // per-round combat state
    this.battleRound = 0;          // 0 = none, 1 = initiative attacks, 2 = other
    this.battleCounters = [{}, {}];// per-player, reset each battle PHASE
    this.priority = null;
    this.passes = 0;
    this.planningDone = [false, false];
    this.deployPlayer = null;
    this.startTurn();
  }

  // ── infrastructure ────────────────────────────────────────────────
  say(msg) { this.log.push(msg); }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  card(name) { return CARDS[name]; }
  unitsOf(p) { return Object.values(this.entities).filter(e => e.controller === p && e.isUnit); }
  tokensOf(p) { return Object.values(this.entities).filter(e => e.controller === p && !e.isUnit); }
  battleCounter(p, key) { return this.battleCounters[p][key] || 0; }
  bumpBattleCounter(p, key) { this.battleCounters[p][key] = (this.battleCounters[p][key] || 0) + 1; return this.battleCounters[p][key]; }

  drawN(p, n, silent = false) {
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) return;
      this.players[p].hand.push(this.deck.shift());
    }
    if (!silent) this.say(`${this.players[p].name} draws ${n}.`);
  }
  draw(p, n) { this.drawN(p, n); }

  // ── resources ─────────────────────────────────────────────────────
  affinity(p, element) {
    let n = 0;
    for (const r of this.players[p].resources) {
      if (r.state === 'dormant') continue;
      if (r.kind === element || r.kind === 'prismite') n++;
    }
    return n;
  }
  openMana(p) { return this.players[p].resources.filter(r => r.state === 'open').length; }

  canPay(p, name) {
    const c = this.card(name);
    if (this.openMana(p) < c.mana) return false;
    for (const [el, n] of Object.entries(affinityPips(c.cost)))
      if (this.affinity(p, el) < n) return false;
    return true;
  }
  pay(p, name) {
    const c = this.card(name);
    let need = c.mana;
    const rs = this.players[p].resources;
    for (const r of rs) { // expend non-prismite first
      if (need && r.state === 'open' && r.kind !== 'prismite') { r.state = 'expended'; need--; }
    }
    for (const r of rs) {
      if (need && r.state === 'open') { r.state = 'expended'; need--; }
    }
  }

  recycleForResource(p, handIdx, element) {
    if (this.phase !== 'planning' || this.planningDone[p]) return false;
    const card = this.players[p].hand.splice(handIdx, 1)[0];
    if (!card) return false;
    this.deck.push(card); // bottom of shared deck
    this.players[p].resources.push({ kind: element, state: 'dormant' });
    this.say(`${this.players[p].name} recycles ${card} for a dormant ${element} resource.`);
    return true;
  }
  activateResource(p, idx) {
    if (this.phase !== 'planning' || this.planningDone[p]) return false;
    const r = this.players[p].resources[idx];
    if (!r || r.state !== 'dormant' || this.players[p].activationsLeft <= 0) return false;
    r.state = 'open';
    this.players[p].activationsLeft--;
    this.say(`${this.players[p].name} activates a ${r.kind} resource.`);
    return true;
  }
  donePlanning(p) {
    if (this.phase !== 'planning') return false;
    this.planningDone[p] = true;
    if (this.planningDone.every(Boolean)) this.startBattlePhase();
    return true;
  }

  // ── turn structure ────────────────────────────────────────────────
  startTurn() {
    this.turn++;
    this.phase = 'planning';
    this.planningDone = [false, false];
    this.say(`— Turn ${this.turn} (initiative: ${this.players[this.initiative].name}) —`);
    for (const p of [0, 1]) {
      for (const r of this.players[p].resources) if (r.state === 'expended') r.state = 'open';
      this.players[p].activationsLeft = 2;
      this.drawN(p, 2);
    }
    for (const u of Object.values(this.entities)) u.usedBounded = {};
  }

  startBattlePhase() {
    this.battleCounters = [{}, {}];
    this.battleRound = 1;
    this.startBattleRound(this.initiative);
  }
  startBattleRound(attacker) {
    this.phase = 'battle';
    this.battle = { attacker, defender: OTHER(attacker), step: 'declare', columns: [], blocks: {}, happened: false };
    this.say(`Battle: ${this.players[attacker].name} may attack.`);
  }

  declareAttack(p, columns) { // columns: [[unitId, unitId?], ...] front first
    const b = this.battle;
    if (!b || b.step !== 'declare' || p !== b.attacker) return false;
    const used = new Set();
    for (const col of columns) {
      if (!col.length || col.length > 2) return false;
      for (const id of col) {
        const u = this.entities[id];
        if (!u || !u.isUnit || u.controller !== p || used.has(id)) return false;
        used.add(id);
      }
    }
    if (!columns.length) return this.skipAttack(p);
    b.columns = columns.map(col => col.slice());
    b.happened = true;
    columns.flat().forEach(id => { this.entities[id].role = 'attacking'; });
    this.say(`${this.players[p].name} attacks with ${columns.length} column(s).`);
    this.emit('attackDeclared', { attacker: p });
    this.openPriority('attackWindow');
    return true;
  }
  skipAttack(p) {
    if (!this.battle || this.battle.step !== 'declare' || p !== this.battle.attacker) return false;
    this.say(`${this.players[p].name} does not attack.`);
    this.endBattleRound();
    return true;
  }

  declareBlocks(p, blocks) { // {colIdx: [unitId, unitId?]}
    const b = this.battle;
    if (!b || b.step !== 'blocks' || p !== b.defender) return false;
    const used = new Set();
    for (const [ci, col] of Object.entries(blocks)) {
      const attCol = b.columns[ci];
      if (!attCol || !col.length || col.length > 2) return false;
      for (const id of col) {
        const u = this.entities[id];
        if (!u || !u.isUnit || u.controller !== p || used.has(id)) return false;
        used.add(id);
      }
      // Flying: a flying column can only be blocked by a column that flies
      if (this.columnAttrs(attCol).has('Flying') && !this.columnAttrs(col).has('Flying')) return false;
      // Evasive: requires two blockers
      if (this.columnAttrs(attCol).has('Evasive') && col.length < 2) return false;
    }
    b.blocks = {};
    for (const [ci, col] of Object.entries(blocks)) {
      b.blocks[ci] = col.slice();
      col.forEach(id => { this.entities[id].role = 'blocking'; });
    }
    this.say(`${this.players[p].name} blocks ${Object.keys(b.blocks).length} column(s).`);
    this.openPriority('blockWindow');
    return true;
  }

  // ── stats & attributes ────────────────────────────────────────────
  effStats(u) {
    const c = this.card(u.name);
    let p = c.stats[0] + u.tempP + u.counters;
    let t = c.stats[1] + u.tempT + u.counters;
    return [p, t];
  }
  ownAttrs(u) {
    const set = new Set(this.card(u.name).attrs || []);
    for (const m of u.mods) for (const a of (this.card(m).augment?.attrs || [])) set.add(a);
    return set;
  }
  columnOf(u) { // the formation column (array of ids) this unit currently fights in
    const b = this.battle;
    if (!b) return null;
    for (const col of b.columns) if (col.includes(u.id)) return col;
    for (const col of Object.values(b.blocks)) if (col.includes(u.id)) return col;
    return null;
  }
  effAttrs(u) { // combat attributes are shared within a column
    const col = this.columnOf(u);
    if (!col) return this.ownAttrs(u);
    const set = new Set();
    for (const id of col) {
      const m = this.entities[id];
      if (m) for (const a of this.ownAttrs(m)) set.add(a);
    }
    return set;
  }
  columnAttrs(ids) {
    const set = new Set();
    for (const id of ids) {
      const u = this.entities[id];
      if (u) for (const a of this.ownAttrs(u)) set.add(a);
    }
    return set;
  }

  // ── priority & the stack ──────────────────────────────────────────
  openPriority(step) {
    this.battle.step = step;
    this.priority = this.initiative; // initiative acts first in every window
    this.passes = 0;
  }
  passPriority(p) {
    if (this.pending || this.phase !== 'battle' || p !== this.priority) return false;
    this.passes++;
    if (this.passes < 2) { this.priority = OTHER(p); return true; }
    // both passed
    if (this.stack.length) {
      this.resolveTop();
      if (this.phase === 'battle') { this.priority = this.initiative; this.passes = 0; }
    } else {
      this.advanceBattleStep();
    }
    return true;
  }
  afterStackPush() {
    this.passes = 0;
    if (this.priority !== null) this.priority = OTHER(this.stack[this.stack.length - 1].controller);
  }

  advanceBattleStep() {
    const b = this.battle;
    this.priority = null;
    if (b.step === 'attackWindow') {
      b.step = 'blocks';
      this.say(`${this.players[b.defender].name} declares blocks.`);
    } else if (b.step === 'blockWindow') {
      this.resolveCombatDamage();
      if (this.phase !== 'battle') return; // someone died to 0 life
      this.emit('afterCombat', {});
      this.openPriority('afterWindow');
      this.say('After-combat step.');
    } else if (b.step === 'afterWindow') {
      this.endBattleRound();
    }
  }

  endBattleRound() {
    for (const u of Object.values(this.entities)) u.role = null;
    this.battle = null;
    if (this.battleRound === 1) {
      this.battleRound = 2;
      this.startBattleRound(OTHER(this.initiative));
    } else {
      this.battleRound = 0;
      this.startRegroup();
    }
  }

  startRegroup() {
    this.phase = 'regroup';
    this.say('Regroup: damage cleared, temporary changes removed, spell tokens erased.');
    for (const e of Object.values(this.entities)) {
      if (!e.isUnit) { delete this.entities[e.id]; continue; } // spell tokens erased
      e.damage = 0; e.tempP = 0; e.tempT = 0; e.role = null;
    }
    this.startDeployment();
  }
  startDeployment() {
    this.phase = 'deploy';
    this.deployPlayer = this.initiative;
    this.say(`Deployment: ${this.players[this.deployPlayer].name} first.`);
  }
  doneDeploying(p) {
    if (this.phase !== 'deploy' || p !== this.deployPlayer || this.pending) return false;
    if (p === this.initiative) {
      this.deployPlayer = OTHER(p);
      this.say(`Deployment: ${this.players[this.deployPlayer].name}.`);
    } else {
      this.emit('endOfTurn', {});
      this.initiative = OTHER(this.initiative);
      this.startTurn();
    }
    return true;
  }

  // ── playing cards ─────────────────────────────────────────────────
  canActNow(p) {
    if (this.pending) return this.pending.player === p;
    if (this.phase === 'planning') return !this.planningDone[p];
    if (this.phase === 'deploy') return p === this.deployPlayer;
    if (this.phase === 'battle') {
      const b = this.battle;
      if (b.step === 'declare') return p === b.attacker;
      if (b.step === 'blocks') return p === b.defender;
      return p === this.priority;
    }
    return false;
  }
  canPlayFromHand(p, idx) {
    const name = this.players[p].hand[idx];
    if (!name || this.pending) return false;
    const c = this.card(name);
    if (!this.canPay(p, name)) return false;
    if (this.phase === 'deploy' && p === this.deployPlayer) return c.timing !== 'battle';
    if (this.phase === 'battle' && p === this.priority)
      return c.timing === 'battle'; // Virus cards enter battle via the augment path
    return false;
  }

  playCard(p, idx) {
    if (!this.canPlayFromHand(p, idx)) return false;
    const name = this.players[p].hand[idx];
    const c = this.card(name);
    if (this.phase === 'battle' && c.timing !== 'battle') return false; // virus cards use playVirus
    this.players[p].hand.splice(idx, 1);
    this.pay(p, name);
    const item = { id: this.nextId++, kind: c.kind, name, controller: p, targets: [], negated: false };
    const finish = () => {
      if (this.phase === 'battle') {
        this.stack.push(item);
        this.say(`${this.players[p].name} plays ${name} → stack.`);
        this.emit('spellPlayed', { controller: p, token: false, name });
        this.afterStackPush();
      } else {
        this.say(`${this.players[p].name} plays ${name}.`);
        if (c.kind === 'unit') this.resolveItem(item);
        else { this.emit('spellPlayed', { controller: p, token: false, name }); this.resolveItem(item); }
      }
    };
    if (c.kind !== 'unit' && c.effect?.targets) this.requestTargets(p, c.effect.targets, item, finish);
    else finish();
    return true;
  }

  castSpellToken(p, id) {
    const tok = this.entities[id];
    if (!tok || tok.isUnit || tok.controller !== p || this.pending) return false;
    const ok = (this.phase === 'battle' && p === this.priority) || (this.phase === 'deploy' && p === this.deployPlayer);
    if (!ok) return false;
    delete this.entities[id];
    const item = { id: this.nextId++, kind: 'spellToken', name: tok.name, controller: p, targets: [], x: tok.x, negated: false };
    const finish = () => {
      if (this.phase === 'battle') {
        this.stack.push(item);
        this.say(`${this.players[p].name} casts ${tok.name} ${tok.x} → stack.`);
        this.emit('spellPlayed', { controller: p, token: true, name: tok.name });
        this.afterStackPush();
      } else {
        this.say(`${this.players[p].name} casts ${tok.name} ${tok.x}.`);
        this.emit('spellPlayed', { controller: p, token: true, name: tok.name });
        this.resolveItem(item);
      }
    };
    const spec = this.card(tok.name).effect?.targets;
    if (spec) this.requestTargets(p, spec, item, finish);
    else finish();
    return true;
  }

  // Augment as a special action during deployment (no stack), or Virus from hand in battle (stack)
  canAugment(p, zone, idx) {
    const name = this.players[p][zone][idx];
    if (!name || this.pending) return false;
    const c = this.card(name);
    if (!c.augment || !this.canPay(p, name)) return false;
    if (this.phase === 'deploy' && p === this.deployPlayer) return true;
    if (this.phase === 'battle' && p === this.priority && c.virus && zone === 'hand') return true;
    return false;
  }
  augment(p, zone, idx, hostId) {
    if (!this.canAugment(p, zone, idx)) return false;
    const host = this.entities[hostId];
    if (!host || !host.isUnit) return false;
    const name = this.players[p][zone][idx];
    this.players[p][zone].splice(idx, 1);
    this.pay(p, name);
    if (this.phase === 'battle') {
      const item = { id: this.nextId++, kind: 'virus', name, controller: p, targets: [{ unit: hostId }], negated: false };
      this.stack.push(item);
      this.say(`${this.players[p].name} plays ${name} as a Virus augment on ${host.name} → stack.`);
      this.afterStackPush();
    } else {
      this.attachMod(host, name, p);
    }
    return true;
  }
  attachMod(host, name, byPlayer) {
    host.mods.push(name);
    this.say(`${name} augments ${host.name} (${this.players[host.controller].name}'s) — it is now Unstable.`);
    this.emit('modded', { host });
  }

  // ── targets & decisions ───────────────────────────────────────────
  targetCandidates(spec, forItem) {
    const out = [];
    if (spec.type === 'unit' || spec.type === 'any') {
      for (const u of Object.values(this.entities)) if (u.isUnit) out.push({ unit: u.id });
    }
    if (spec.type === 'any') { out.push({ player: 0 }, { player: 1 }); }
    if (spec.type === 'stackSpell') {
      for (const it of this.stack) {
        if (it === forItem) continue;
        if (['spell', 'spellUnit', 'spellToken'].includes(it.kind) && !it.negated) out.push({ stack: it.id });
      }
    }
    return out;
  }
  requestTargets(p, spec, item, onDone) {
    const candidates = this.targetCandidates(spec, item);
    if (!candidates.length) { this.say('No legal targets.'); item.fizzled = true; onDone(); return; }
    this.pending = { player: p, prompt: spec.prompt, candidates, pick: (t) => { item.targets = [t]; this.pending = null; onDone(); } };
  }
  clickTarget(p, ref) {
    if (!this.pending || this.pending.player !== p) return false;
    const ok = this.pending.candidates.some(c => JSON.stringify(c) === JSON.stringify(ref));
    if (!ok) return false;
    this.pending.pick(ref);
    this.drainTriggers();
    return true;
  }

  // ── stack resolution ──────────────────────────────────────────────
  targetStillLegal(t) {
    if (t.unit !== undefined) return !!this.entities[t.unit];
    if (t.player !== undefined) return true;
    if (t.stack !== undefined) return this.stack.some(i => i.id === t.stack && !i.negated);
    return false;
  }
  resolveTop() { const item = this.stack.pop(); this.resolveItem(item); this.drainTriggers(); }

  resolveItem(item) {
    const c = this.card(item.name);
    const P = this.players[item.controller].name;
    if (item.negated) {
      this.say(`${item.name} was negated → ${c.kind === 'spellToken' ? 'erased' : 'bin'}.`);
      if (c.kind !== 'spellToken') this.players[item.controller].bin.push(item.name);
      return;
    }
    if (item.kind === 'unit') { this.spawnUnit(item.controller, item.name); return; }
    if (item.kind === 'virus') {
      const host = item.targets[0] && this.entities[item.targets[0].unit];
      if (!host) { this.say(`${item.name} fizzles (host is gone) → bin.`); this.players[item.controller].bin.push(item.name); return; }
      this.attachMod(host, item.name, item.controller);
      return;
    }
    // spell / spellUnit / spellToken
    const legal = item.targets.filter(t => this.targetStillLegal(t));
    if (item.fizzled || (c.effect?.targets && !legal.length)) {
      this.say(`${item.name} fizzles — all targets are gone.`);
      if (c.kind !== 'spellToken') this.players[item.controller].bin.push(item.name);
      return; // a fizzled spell unit never spawns
    }
    const ctx = {
      controller: item.controller, x: item.x, source: item.name,
      targets: legal.map(t => t.unit !== undefined ? this.entities[t.unit] : t),
    };
    this.say(`${item.name} resolves.`);
    c.effect?.run(this, ctx);
    if (c.kind === 'spellUnit') this.spawnUnit(item.controller, item.name);
    else if (c.kind !== 'spellToken') this.players[item.controller].bin.push(item.name);
  }

  negate(ref) {
    const it = this.stack.find(i => i.id === ref.stack);
    if (it) { it.negated = true; this.say(`${it.name} is negated.`); }
  }

  // ── units, damage, death ──────────────────────────────────────────
  spawnUnit(p, name) {
    const u = {
      id: this.nextId++, name, controller: p, isUnit: true,
      damage: 0, tempP: 0, tempT: 0, counters: 0, mods: [], role: null, usedBounded: {},
    };
    this.entities[u.id] = u;
    this.say(`${this.players[p].name} spawns ${name}.`);
    this.emit('spawnOrDie', { source: u, controller: p, mode: 'spawn' });
    return u;
  }
  createSpellToken(p, name, x) {
    const t = { id: this.nextId++, name, controller: p, isUnit: false, x };
    this.entities[t.id] = t;
    this.say(`${this.players[p].name} creates a ${name} ${x}.`);
    return t;
  }
  addTempMod(target, dp, dt) {
    if (!target?.isUnit) return;
    target.tempP += dp; target.tempT += dt;
    this.say(`${target.name} gets ${dp >= 0 ? '+' : ''}${dp}/${dt >= 0 ? '+' : ''}${dt} until regroup.`);
    this.checkDeaths([target]);
  }

  dealEffectDamage(source, target, n, opts = {}) {
    const srcName = source?.name ?? source;
    if (n <= 0) return;
    if (target.player !== undefined) { this.loseLife(target.player, n, srcName); return; }
    if (!target.isUnit || !this.entities[target.id]) return;
    target.damage += n;
    this.say(`${srcName} deals ${n} to ${target.name}.`);
    const died = this.checkDeaths([target]);
    if (opts.reaping && died.length && opts.controller !== undefined) {
      this.say('Reaping: draw a card.');
      this.draw(opts.controller, 1);
    }
  }
  loseLife(p, n, why) {
    this.players[p].life -= n;
    this.say(`${this.players[p].name} loses ${n} life (${why}) → ${this.players[p].life}.`);
    if (this.players[p].life <= 0 && !this.winner) {
      this.winner = OTHER(p);
      this.phase = 'gameover';
      this.say(`*** ${this.players[this.winner].name} wins! ***`);
    }
  }

  checkDeaths(candidates) {
    const dead = [];
    for (const u of candidates) {
      if (!u?.isUnit || !this.entities[u.id]) continue;
      const [, t] = this.effStats(u);
      if (t <= 0 || u.damage >= t) dead.push(u);
    }
    for (const u of dead) this.destroy(u, 'dies');
    return dead;
  }
  destroy(u, verb) {
    if (!this.entities[u.id]) return;
    delete this.entities[u.id];
    if (u.mods.length) {
      this.say(`${u.name} ${verb} — Unstable: it and its ${u.mods.length} mod(s) are ERASED.`);
    } else {
      this.players[u.controller].bin.push(u.name);
      this.say(`${u.name} ${verb} → bin.`);
    }
    // formation cleanup + front-row promotion (state-based, no response)
    if (this.battle) {
      for (const col of [...this.battle.columns, ...Object.values(this.battle.blocks)]) {
        const i = col.indexOf(u.id);
        if (i !== -1) col.splice(i, 1); // survivor slides forward
      }
    }
    const deaths = this.bumpBattleCounter(u.controller, 'allyDeaths');
    this.emit('spawnOrDie', { source: u, controller: u.controller, mode: 'die' });
    this.emit('allyDied', { owner: u.controller, unit: u, count: deaths });
  }
  deleteUnit(u) { if (u?.isUnit) this.destroy(u, 'is deleted'); }
  sacrifice(u) { if (u?.isUnit) this.destroy(u, 'is sacrificed'); }

  // ── combat damage ─────────────────────────────────────────────────
  resolveCombatDamage() {
    const b = this.battle;
    this.say('Combat damage (simultaneous):');
    const unitDmg = new Map();   // id -> total incoming
    const playerDmg = [0, 0];
    const colPower = ids => ids.reduce((s, id) => { const u = this.entities[id]; return u ? s + Math.max(0, this.effStats(u)[0]) : s; }, 0);

    // assign a column's damage front-to-back (lethal each, overflow to the next);
    // leftover damage hits the player only with Piercing, otherwise it is lost
    const assign = (ids, amount, pierc, victimPlayer) => {
      let remaining = amount;
      for (const id of ids) {
        const u = this.entities[id];
        if (!u || remaining <= 0) continue;
        const [, t] = this.effStats(u);
        const lethal = Math.max(0, t - u.damage - (unitDmg.get(id) || 0));
        const a = Math.min(remaining, lethal);
        unitDmg.set(id, (unitDmg.get(id) || 0) + a);
        remaining -= a;
      }
      if (remaining > 0 && pierc) playerDmg[victimPlayer] += remaining;
    };

    b.columns.forEach((atk, ci) => {
      const blk = (b.blocks[ci] || []).filter(id => this.entities[id]);
      const atkAlive = atk.filter(id => this.entities[id]);
      const aPow = colPower(atkAlive);
      if (blk.length) {
        assign(blk, aPow, this.columnAttrs(atkAlive).has('Piercing'), b.defender);
        assign(atkAlive, colPower(blk), this.columnAttrs(blk).has('Piercing'), b.attacker);
      } else if (b.blocks[ci] !== undefined) {
        // column was blocked but blockers died pre-damage: blocked columns stay blocked
        this.say(`Column ${ci + 1} is blocked (blockers gone) — no damage through.`);
      } else {
        playerDmg[b.defender] += aPow;
      }
    });

    for (const [id, n] of unitDmg) {
      const u = this.entities[id];
      if (u && n > 0) { u.damage += n; this.say(`${u.name} takes ${n} (${u.damage} total).`); }
    }
    for (const p of [0, 1]) if (playerDmg[p] > 0) this.loseLife(p, playerDmg[p], 'combat');
    this.checkDeaths(Object.values(this.entities).filter(e => e.isUnit));
  }

  // ── triggers ──────────────────────────────────────────────────────
  emit(event, ctx) {
    // scan in-play units for matching triggers; initiative player's units first.
    // A unit that just died still sees its own death (it's gone from play).
    const order = [...this.unitsOf(this.initiative), ...this.unitsOf(OTHER(this.initiative))];
    if (ctx.mode === 'die' && ctx.source && !order.includes(ctx.source)) order.unshift(ctx.source);
    for (const u of order) {
      const defs = this.card(u.name).triggers || [];
      const modTriggers = u.mods.flatMap(m => (this.card(m).augment?.abilities || [])
        .filter(a => a === 'afterCombatSacrifice')
        .map(() => ({ event: 'afterCombat', self: true, label: `${m} (augment): sacrifice host`, effect: { run: (g, c) => g.sacrifice(c.source) } })));
      for (const tr of [...defs, ...modTriggers]) {
        if (tr.event !== event) continue;
        if (tr.self && ctx.source && ctx.source !== u) continue;
        if (tr.when && !tr.when(this, u, ctx)) continue;
        if (tr.bounded && u.usedBounded[tr.label]) continue;
        if (tr.bounded) u.usedBounded[tr.label] = true;
        this.triggerQueue.push({ unit: u, tr, ctx: { ...ctx, source: ctx.source ?? u, controller: u.controller } });
      }
    }
    this.drainTriggers();
  }
  drainTriggers() {
    while (this.triggerQueue.length && !this.pending) {
      const { unit, tr, ctx } = this.triggerQueue.shift();
      this.say(`Trigger: ${tr.label}.`);
      const fire = (targets) => {
        const fullCtx = { ...ctx, targets, controller: unit.controller };
        if (this.phase === 'battle' && this.priority !== null) {
          // triggered abilities use the stack during battle
          const item = {
            id: this.nextId++, kind: 'trigger', name: tr.label, controller: unit.controller,
            targets: targets ? targets.map(t => t.isUnit ? { unit: t.id } : t) : [], negated: false,
            effect: tr.effect, triggerCtx: fullCtx,
          };
          item.resolveTrigger = true;
          this.stack.push(item);
          this.afterStackPush();
        } else {
          tr.effect.run(this, fullCtx);
        }
      };
      if (tr.effect.targets) {
        this.requestTargetsForTrigger(unit.controller, tr.effect.targets, fire);
      } else fire(null);
    }
  }
  requestTargetsForTrigger(p, spec, onDone) {
    const candidates = this.targetCandidates(spec, null);
    if (!candidates.length) { this.say('Trigger: no legal targets.'); return; }
    this.pending = {
      player: p, prompt: spec.prompt, candidates,
      pick: (t) => {
        this.pending = null;
        onDone([t.unit !== undefined ? this.entities[t.unit] : t]);
      },
    };
  }
}

// triggered stack items resolve via their stored effect
const _origResolveItem = Game.prototype.resolveItem;
Game.prototype.resolveItem = function (item) {
  if (item.resolveTrigger) {
    if (item.negated) { this.say(`${item.name} was negated.`); return; }
    const targets = item.targets.map(t => t.unit !== undefined ? this.entities[t.unit] : t).filter(Boolean);
    if (item.targets.length && !targets.length) { this.say(`${item.name} fizzles.`); return; }
    this.say(`${item.name} resolves.`);
    item.effect.run(this, { ...item.triggerCtx, targets });
    return;
  }
  _origResolveItem.call(this, item);
};

if (typeof module !== 'undefined') module.exports = { Game };
