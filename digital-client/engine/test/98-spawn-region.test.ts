/* R115 — A CREATED UNIT ARRIVES WHERE ITS SOURCE IS.
 *
 * THE RULING, in the designer's own words (playtest report #83, 2026-08-23):
 *
 *   "Life Plant's units were made in my region, despite it currently being in
 *    Rashi's region. Anything made by anything needs to spawn in that region
 *    (then can return during regroup)."
 *
 * *That region* is the region the SOURCE is standing in at the moment the
 * effect resolves — which is exactly `ctx.region` on all four resolution paths
 * (spell in battle, spell in deployment, activated ability, triggered ability).
 * There is no new primitive here and nothing to compute: the rule is "pass
 * `ctx.region`", and 25 cards were passing `g.homeRegion(ctx.controller)`
 * instead.
 *
 * THIS IS A REVERSAL, NOT A CLARIFICATION. It WITHDRAWS R28 and R52 and
 * ABSORBS R33:
 *
 *  - R28 said created units go HOME, and its stated reason was "Tidelurker's
 *    2/2 minted mid-attack must be home to block the counterattack". The
 *    designer was asked that exact consequence and answered the other way, so
 *    the third test in this file is R28's rationale INVERTED: the 2/2 is
 *    minted in the enemy region, stands there in no column, and the engine
 *    refuses it as a blocker when the counterattack comes back the other way.
 *    The power cut to Tidelurker, Life Plant, Legion of the Depths and Pack
 *    Leader is intended.
 *  - R52 confirmed R28 as the global default and moved six Light & Dark cards
 *    to home. They are all moved back. R52's "unfinished migration" list — the
 *    base-set cards it said still needed moving — is cancelled: those cards
 *    were already right.
 *  - R33 (Ember of Life's 1/1s arrive where the carrier is) stops being a
 *    per-card exception and becomes a statement of the general rule.
 *
 * WHY THERE IS A SOURCE SCAN IN A CARD TEST FILE
 *
 * Nothing about R115 is hard. What was hard is that the wrong answer was
 * INVISIBLE: three shared helpers (`makeOneOne`, `makeRobot`, `create1s`) took
 * `region?: number` and fell back to `?? g.homeRegion(seat)`, so four cards
 * created units in a region no line of their code named. Those defaults are
 * deleted — `region` is required on all three — and the two scans below are
 * the other half: a card may not reach for `homeRegion` inside an effect at
 * all, and every creation call must NAME the region it creates in. The
 * allow-list holds only cards whose printed text names a place, each with its
 * reason, and every entry is asserted to still be needed, so the list cannot
 * rot into a licence.
 *
 * FORMATION: nothing was built for this. `E.placeInFormation` already refuses
 * a unit whose region is not the battle's, and a unit standing in a region but
 * in no column is a first-class, already-tested state (the invader's zone,
 * 73-play-into-formation). A token minted by an attacker in the enemy region
 * simply stands there until regroup walks it home.
 *
 * Seeds: 9800-9899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard, type EffectCtx } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, effStats, finishBattle, give, giveResources, pass, pick, spawn, toDeployment,
  toNextBattle, unitsOf,
} from './util.ts';

/** run engine code directly against the live state (and survive a suspension) */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

const homeOf = (h: Harness, seat: number): number => new E(h.state).homeRegion(seat as Seat);

// ═══════════════════════ (i) the report, verbatim ═══════════════════════

test('R115: report #83 — Life Plant attacking in the enemy region creates its 1/1s THERE, not at home', () => {
  const h = new Harness(9801);
  toDeployment(h);
  const A = h.state.initiative;
  const plant = spawn(h, A, 'Life Plant');                    // 7/3, [Augment] text live
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[plant]] });
  const battle = h.state.battle!.region;
  const home = homeOf(h, A);
  assert.notEqual(battle, home, 'the carrier really is fighting in the enemy region');
  assert.equal(ent(h, plant)!.region, battle, 'Life Plant is standing in the enemy region');

  // "when you gain or lose life, create that many 1/1 units"
  whiteBox(h, e => e.loseLife(A, 2, 'report #83'));
  pass(h); pass(h);                                           // resolve the queued trigger

  const made = unitsOf(h, A).filter(u => u.token && u.card === 'Unit Token');
  assert.equal(made.length, 2, 'two 1/1s were created');
  assert.deepEqual(effStats(h, made[0]!.id), [1, 1], 'each is a 1/1');
  assert.ok(made.every(u => u.region === battle),
    '"anything made by anything needs to spawn in that region" — the region the SOURCE is in');
  assert.equal(made.filter(u => u.region === home).length, 0,
    'R52 is WITHDRAWN: not one of them went home');

  // …and they are in the region but in NO column — the invader's-zone state
  const inColumns = h.state.battle!.columns.flat();
  assert.ok(made.every(u => !inColumns.includes(u.id)),
    'a token minted mid-attack joins no column: it stands in the region, outside the formation');
  finishBattle(h);
});

// ═══════════════════ (ii) "then can return during regroup" ═══════════════

test('R115: the stranded 1/1s walk home at regroup — the second half of the ruling', () => {
  const h = new Harness(9802);
  toDeployment(h);
  const A = h.state.initiative;
  const plant = spawn(h, A, 'Life Plant');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[plant]] });
  const battle = h.state.battle!.region;
  const home = homeOf(h, A);
  whiteBox(h, e => e.loseLife(A, 2, 'report #83'));
  pass(h); pass(h);
  const made = unitsOf(h, A).filter(u => u.token && u.card === 'Unit Token').map(u => u.id);
  assert.equal(made.length, 2);
  assert.ok(made.every(id => ent(h, id)!.region === battle), 'created in the battle region');

  finishBattle(h);                                            // …through regroup
  assert.equal(h.state.phase, 'deploy', 'the battle is over');
  assert.ok(made.every(id => ent(h, id)!.region === home),
    'regroup returned them to their controller\'s region — "then can return during regroup"');
  assert.equal(ent(h, plant)!.region, home, 'and the carrier came home with them');
});

// ══════════ (iii) R28's rationale, inverted and pinned ══════════

test("R115 inverts R28: Tidelurker's mid-attack 2/2 stays in the enemy region and CANNOT block the counterattack", () => {
  const h = new Harness(9803);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lurker = spawn(h, A, 'Tidelurker');                   // 1/4 — "a player dealt combat damage"
  const counter = spawn(h, D, 'Rune Channeler');              // 4/3 — the counterattacker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lurker]] });
  const invaded = h.state.battle!.region;
  const home = homeOf(h, A);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [counter] });
  pass(h); pass(h);                                           // combat: D is hit → the trigger fires

  const tok = unitsOf(h, A).find(u => u.token && u.tokenStats?.[0] === 2)!;
  assert.ok(tok, 'the 2/2 was created');
  assert.equal(tok.region, invaded, 'R115: minted where Tidelurker is — the enemy region');
  assert.notEqual(tok.region, home, 'R28 is WITHDRAWN: it was NOT sent home');

  pass(h); pass(h);                                           // after-combat window → round 2
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, D, 'the counterattack');
  assert.equal(h.state.battle!.region, home,
    'and the counterattack is fought in A\'s OWN region — which is where the 2/2 is not');
  h.do({ type: 'declareAttack', seat: D, columns: [[counter]] });
  pass(h); pass(h);

  assert.throws(
    () => h.do({ type: 'declareBlocks', seat: A, blocks: { 0: [tok.id] } }),
    /another region/,
    'THE CONFIRMED CONSEQUENCE: the token is in the region it was minted in, so it cannot block');
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });       // A takes it on the chin
  pass(h); pass(h);
  finishBattle(h);
  assert.equal(ent(h, tok.id)!.region, home, 'it walks home at regroup, one battle too late');
});

// ═══════════════ (v) the two battle-timing spells ═══════════════

test('R115: Galactic Germination cast in the enemy region creates its 1/1s in the enemy region', () => {
  const h = new Harness(9804);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const u1 = spawn(h, A, 'Unit Token');
  const u2 = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Stasis Sentry');                               // a defender to be attacked
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'wood', 2);                             // bg/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1], [u2]] });
  const battle = h.state.battle!.region;
  const home = homeOf(h, A);
  assert.notEqual(battle, home, 'the spell is cast in the enemy region');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Galactic Germination') });
  pick(h, { unit: u1 });                                      // a unit in the target formation
  pass(h); pass(h);

  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.id !== u1 && u.id !== u2);
  assert.equal(made.length, 2, 'two 1/1s — one per unit in the attacking formation');
  assert.ok(made.every(u => u.region === battle), 'R115: they arrive where the spell resolved');
  assert.equal(made.filter(u => u.region === home).length, 0, 'none of them went home');
  finishBattle(h);
});

test('R115: Arcane Echo cast in the enemy region copies a token INTO the enemy region', () => {
  const h = new Harness(9805);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                            // m/2
  toNextBattle(h, A);
  let robot = 0;
  whiteBox(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id; });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const battle = h.state.battle!.region;
  const home = homeOf(h, A);
  assert.notEqual(battle, home, 'the spell is cast in the enemy region');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arcane Echo') });
  pick(h, { unit: robot });                                   // R64: the target is a cast-time choice
  pass(h); pass(h);

  const copy = unitsOf(h, A).find(u => u.card === 'Robot')!;
  assert.ok(copy, 'a Robot copy was created for the caster');
  assert.equal(copy.counters, 2, 'with the same X');
  assert.equal(copy.region, battle, 'R115: the unit copy arrives where the spell resolved');
  assert.notEqual(copy.region, home, 'not in the caster\'s home region');
  finishBattle(h);
});

// ═══════════ (vi) the negative control ═══════════

test('R115 negative control: a deploy-timing creator still lands at home, because home IS ctx.region then', () => {
  const h = new Harness(9806);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const home = homeOf(h, p);
  assert.equal(h.state.battle, null, 'there is no battle — deployment');
  giveResources(h, p, 'metal', 6);                            // mmm/6
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Manufacture') });
  const robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.deepEqual(robots.map(r => r.counters).sort(), [1, 2, 3], 'a Robot 3, a Robot 2 and a Robot 1');
  assert.ok(robots.every(r => r.region === home),
    'they arrive at home — but BECAUSE ctx.region is home during deployment, not because "created units go home"');

  // The same card and the same rule with a different ctx gives a different
  // answer, which is the whole point of this control: "at home" and "at the
  // source's region" are indistinguishable from the RESULT here, only from
  // what the code passed. Drive Manufacture's own effect with a ctx pointed at
  // the other region and the Robots follow the ctx, not the seat.
  const elsewhere = 1 - home;
  whiteBox(h, e => {
    getCard('Manufacture').spellEffect!.run(e, {
      controller: p, sourceName: 'Manufacture', region: elsewhere, targets: [], event: null,
      eraseSelf: () => {},
      choose: () => { throw new Error('Manufacture asks nothing at resolution'); },
    } as EffectCtx);
  });
  const away = unitsOf(h, p).filter(u => u.card === 'Robot' && u.region === elsewhere);
  assert.equal(away.length, 3, 'the same effect, run with a non-home ctx.region, creates them THERE');
});

// ═══════════ (iv) the source scan — two passes ═══════════

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(HERE, '..', 'src', 'cards');

function cardSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.ts')) continue;
      out.push({ rel: path.relative(CARDS, full), src: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(CARDS);
  return out;
}

/** strip // and /* comments so a scan reads CODE, not prose about the code */
function stripComments(src: string): string {
  let out = '', i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      out += ' '.repeat(end - i);
      i = end;
    } else if (two === '/*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      for (const c of src.slice(i, end)) out += c === '\n' ? '\n' : ' ';
      i = end;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const q = src[i]!;
      out += src[i]; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i++; }
        if (i < src.length) { out += src[i]; i++; }
      }
      if (i < src.length) { out += src[i]; i++; }
    } else {
      out += src[i]; i++;
    }
  }
  return out;
}

const lineOf = (src: string, idx: number): number => src.slice(0, idx).split('\n').length;

/* ── PASS 1: no card may reach for `homeRegion` at all ──────────────────────
 *
 * The withdrawn R28/R52 rule is spelled exactly one way in card code —
 * `g.homeRegion(ctx.controller)` — and that spelling is now always wrong: an
 * effect knows where its source is, and that is `ctx.region`. The allow-list
 * is deliberately EMPTY. A card that genuinely needs a home region (there is
 * no such card today) would have to be added here with its printed words as
 * the reason, and the assertion below would then hold it to being real. */
const HOME_REGION_ALLOWED: { where: string; why: string }[] = [
  // (empty on purpose — see above. Format: { where: 'sets/batch-x.ts', why: '…' })
];

test('R115 conformance: no card effect reaches for homeRegion() — the source scan', () => {
  const offenders: string[] = [];
  const allowedHit = new Set<string>();
  for (const { rel, src } of cardSources()) {
    const code = stripComments(src);
    for (const m of code.matchAll(/\bhomeRegion\s*\(/g)) {
      const allow = HOME_REGION_ALLOWED.find(a => a.where === rel);
      if (allow) { allowedHit.add(rel); continue; }
      offenders.push(`${rel}:${lineOf(code, m.index)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'R115: a created thing arrives at ctx.region. These sites substitute the controller\'s home '
    + 'region for the source\'s region, which is exactly the withdrawn R28/R52 rule:\n  '
    + offenders.join('\n  '));
  for (const a of HOME_REGION_ALLOWED) {
    assert.ok(allowedHit.has(a.where),
      `stale allow-list entry: ${a.where} no longer calls homeRegion(), so its exemption `
      + `("${a.why}") is dead and must be deleted`);
  }
});

/* ── PASS 2: every creation NAMES the region it creates in ─────────────────
 *
 * The stronger half. `homeRegion` was only the visible spelling of the bug;
 * the invisible one was a helper defaulting the region argument. So: every
 * `spawnUnit` / `createWraith` / `createSpellToken` call in card code must
 * pass `ctx.region`, or be one of the listed bespoke placers whose PRINTED
 * TEXT names a place. Each entry says which card and why, and an entry that
 * stops matching fails as loudly as a card that breaks the rule. */
interface Bespoke { where: string; expr: string; card: string; why: string }
const BESPOKE_REGIONS: Bespoke[] = [
  {
    where: 'sets/batch-light-a.ts', expr: 'self.region', card: 'Hooba-God',
    why: '"create a token that\'s a copy of me IN MY FORMATION" — the copy goes where the '
      + 'carrier is standing, and placeInFormation then puts it in a slot',
  },
  {
    where: 'sets/batch-light-c.ts', expr: 'region', card: 'Feed to Hooba',
    why: '"its controller creates a 3/3 unit IN ITS POSITION IN PLAY" — the 3/3 takes the '
      + 'erased unit\'s region and its exact formation slot (local `region` = the target\'s)',
  },
  // ⚠ TWO ENTRIES DELETED, R157 §3 (2026-08-25) — and their absence is now the
  // stronger guarantee. `sets/batch-dark-b.ts | self.region` (Hooba-Mon's
  // exchange) and `sets/batch-dark-c.ts | victim.region` (Necromorph) were the
  // pool's two EXCHANGES, both hand-placing a replacement body into the
  // outgoing unit's region and slot. R157 §3 ruled an exchange a despawn and a
  // trashing but NOT a death, which Necromorph's `destroy()` could not express,
  // so both moved onto one engine primitive — `E.exchangeInPlace`, which does
  // the spawn. There is no card-code creation left to exempt: this sweep walks
  // card sources only, and an exchange no longer creates anything in one.
  // Re-adding either entry means someone has re-inlined an exchange; send them
  // to E.exchangeInPlace and to test/129-disposal-tail.ts, which guards it.
  {
    where: 'sets/batch-wood-a.ts', expr: 'region', card: 'makeOneOne (shared helper)',
    why: 'the helper\'s own REQUIRED parameter. R115 deleted its `?? homeRegion(seat)` default; '
      + 'every caller now passes ctx.region and the compiler enforces that one is passed',
  },
  {
    where: 'sets/batch-wood-c.ts', expr: 'region', card: 'create1s (shared helper)',
    why: 'the helper\'s own REQUIRED parameter — see makeOneOne',
  },
  {
    where: 'sets/batch-metal-b.ts', expr: 'region', card: 'makeRobot (shared helper)',
    why: 'the helper\'s own REQUIRED parameter — see makeOneOne',
  },
];

/** split the arguments of a call whose '(' is at `open` */
function callArgs(code: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1) continue; }
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { out.push(cur.trim()); return out; }
    }
    if (depth === 1 && c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return out;
}

test('R115 conformance: every card creation names ctx.region, or is an allow-listed bespoke placer', () => {
  const offenders: string[] = [];
  const used = new Set<string>();
  const CALLS: Record<string, number> = { spawnUnit: 2, createWraith: 1, createSpellToken: 3 };
  for (const { rel, src } of cardSources()) {
    const code = stripComments(src);
    for (const m of code.matchAll(/\b(spawnUnit|createWraith|createSpellToken)\s*\(/g)) {
      const fn = m[1]!;
      const args = callArgs(code, m.index + m[0].length - 1);
      const at = `${rel}:${lineOf(code, m.index)} ${fn}`;
      const idx = CALLS[fn]!;
      if (args.length <= idx) {
        offenders.push(`${at} — no region argument at all (it would silently default)`);
        continue;
      }
      const region = args[idx]!;
      if (region === 'ctx.region') continue;
      const ok = BESPOKE_REGIONS.find(b => b.where === rel && b.expr === region);
      if (ok) { used.add(`${ok.where}|${ok.expr}`); continue; }
      offenders.push(`${at} — region is \`${region}\`, not ctx.region and not allow-listed`);
    }
  }
  assert.deepEqual(offenders, [],
    'R115: a created thing arrives where its SOURCE is. Every one of these either substitutes '
    + 'another region or lets one default:\n  ' + offenders.join('\n  '));
  for (const b of BESPOKE_REGIONS) {
    assert.ok(used.has(`${b.where}|${b.expr}`),
      `stale allow-list entry: ${b.where} no longer creates anything at \`${b.expr}\`, so the `
      + `exemption for ${b.card} ("${b.why}") is dead and must be deleted`);
  }
});

test('R115: the three shared token helpers take a REQUIRED region — the deleted silent defaults', () => {
  const wanted: { rel: string; helper: string }[] = [
    { rel: 'sets/batch-wood-a.ts', helper: 'makeOneOne' },
    { rel: 'sets/batch-metal-b.ts', helper: 'makeRobot' },
    { rel: 'sets/batch-wood-c.ts', helper: 'create1s' },
  ];
  const byRel = new Map(cardSources().map(f => [f.rel, f.src]));
  for (const { rel, helper } of wanted) {
    const src = byRel.get(rel);
    assert.ok(src, `${rel} is gone — this guard needs re-pointing`);
    const sig = new RegExp(`const ${helper} = \\(([^)]*)\\)`).exec(stripComments(src));
    assert.ok(sig, `${helper} is no longer declared in ${rel}`);
    assert.ok(/\bregion: number\b/.test(sig[1]!),
      `${helper} must take a REQUIRED \`region: number\`; it declares \`${sig[1]!.trim()}\``);
    assert.ok(!/region\?/.test(sig[1]!),
      `${helper}'s region is optional again — that optionality IS the R115 bug: four cards `
      + 'inherited the wrong region from a `?? homeRegion(seat)` default that no card named');
  }
});
