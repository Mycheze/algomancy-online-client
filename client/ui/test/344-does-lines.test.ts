/* WHAT A STACK ITEM WILL DO, IN ONE LINE (owner, 2026-09-30) — ui/doesline.ts
 * and its data, ui/does-lines.json.
 *
 * The templates were written once, offline, one per clause in the pool, in
 * the owner's register ("Delete {Unit Name}", "Deal 2 damage to {A} and {B}").
 * Written text rots in two directions and this pins both:
 *
 *  §1 COVERAGE — every clause the engine can put on the stack has a line, and
 *     the file holds nothing for a clause that no longer exists. A new card
 *     cannot arrive without someone writing its line (the caption falls back
 *     to the old name-and-targets rather than a hole, but that fallback is a
 *     debt, not a design).
 *  §2 SLOTS — every slot is one the renderer knows, names a target the clause
 *     can actually have, and a mode slot names the ENGINE's mode values (the
 *     writer guessed them from the printed text once, and was wrong on 8 of 12).
 *  §3 LENGTH — rendered with ordinary names, a line fits the caption.
 *  §4 THE RENDERER — lists, dropped sentences, modes, the ", then " join, and
 *     a graft cause that does nothing itself.
 *
 * Seeds 34400-34499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/sets/index.ts';
import { allCardNames, getCard, type EffectDef } from '../../engine/src/cards/dsl.ts';
import type { EffectPart, GameState, StackItem, TargetRef } from '../../engine/src/types.ts';
import { AMOUNT, DOES, SLOT_RE, amountOf, doesLine, listText, renderTemplate, type SlotContext } from '../doesline.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { spawn } from '../../engine/test/util.ts';

/** every clause the engine can put on the stack, keyed as a part's effectKey */
function poolClauses(): Map<string, EffectDef> {
  const out = new Map<string, EffectDef>();
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (c.spellEffect) out.set(`spell:${name}`, c.spellEffect);
    c.abilities?.forEach((a, i) => out.set(`ability:${name}#${i}`, a.effect));
    c.augmentText?.forEach((a, i) => out.set(`augment:${name}#${i}`, a.effect));
    if (c.graftEffect) out.set(`graft:${name}`, c.graftEffect.effect);
    if (c.ambush) out.set(`ambush:${name}`, { targets: { what: 'allyUnit', prompt: '' } } as EffectDef);
  }
  return out;
}
const POOL = poolClauses();

test('§1 every clause in the pool has a line, and the file has nothing else', () => {
  assert.ok(POOL.size > 500, `the pool walk found ${POOL.size} clauses — it is measuring air`);
  const missing = [...POOL.keys()].filter(k => DOES[k] === undefined);
  assert.deepEqual(missing, [], 'a clause with no line: write one in ui/does-lines.json');
  const stale = Object.keys(DOES).filter(k => !POOL.has(k));
  assert.deepEqual(stale, [], 'a line for a clause the pool no longer has');
});

/** how many targets a clause can name: count + extraSlots, or unbounded for X */
function maxTargets(def: EffectDef): number {
  const t = def.targets;
  if (!t) return 0;
  if (t.count === 'X') return Infinity;
  return (t.count ?? 1) + (t.extraSlots ?? 0);
}

test('§2 every slot is known, names a target the clause has, and modes match the engine', () => {
  const bad: string[] = [];
  let modal = 0;
  for (const [key, def] of POOL) {
    const tpl = DOES[key] ?? '';
    const bare = tpl.replace(SLOT_RE, '');
    if (/[{}]/.test(bare)) bad.push(`${key}: an unknown slot in "${tpl}"`);
    const most = maxTargets(def);
    for (const m of tpl.matchAll(SLOT_RE)) {
      if (m[1] !== undefined && Number(m[1]) >= most) {
        bad.push(`${key}: ${m[0]} but the clause takes at most ${most} target(s)`);
      }
      if (m[4] !== undefined) {
        modal++;
        if (!def.modes) { bad.push(`${key}: a mode slot on a clause with no modes`); continue; }
        let values: string[] | null = null;
        try {
          values = def.modes.options({ s: {} } as never, { x: 3 } as never, {} as never).map(o => String(o.value));
        } catch { values = null; }   // options that read the live table: checked by name below
        const keys = m[4].split('|').map(o => o.split('=')[0]!);
        if (values && !keys.every(k => values!.includes(k))) {
          bad.push(`${key}: mode keys ${keys.join('/')} are not the engine's ${values.join('/')}`);
        }
      }
    }
    // (an {X} whose amount the mode picks names the mode too — Retribution
    // Thing's "lost or gained" is the X, and "(currently N)" is the chosen one)
    if (def.modes && !/\{mode:/.test(tpl) && !tpl.includes('{X}') && tpl !== '') {
      bad.push(`${key}: a modal clause whose line does not say which mode was chosen`);
    }
  }
  assert.ok(modal >= 8, `only ${modal} mode slots found — the walk is not reaching the modal cards`);
  assert.deepEqual(bad, []);
});

/**
 * §2b — WHAT IS ALREADY KNOWN IS A NUMBER (owner, 2026-09-30, on Beyond:
 * "Put {X} -1/-1 counter(s) on Bubb"; on Deformant: the sacrificed units'
 * counters are counted as the cost is paid and cannot change). DERIVED, not
 * listed: an effect whose own code takes its amount from the triggering
 * event's `n`, or from the counters on the units it sacrificed, says {N}.
 * And the other two structural rules the owner's notes turned up:
 *  · a graft MULTIPLIER (`graftCopies`) does nothing itself — its line is
 *    empty, and the copies say what happens ("Should be the same as Amphivore");
 *  · a list slot {i+} only where the clause can name more than one target
 *    from i on — Nothyr's "up to one" read "Negate Twin Flame and Fireball".
 */
test('§2b known amounts are numbers, multipliers are silent, one target is not a list', () => {
  const bad: string[] = [];
  let reads = 0;
  for (const [key, def] of POOL) {
    const tpl = DOES[key] ?? '';
    const src = String(def.run ?? '');
    const amount = /ctx\.event\?\.data\?\.(?:n\b|\['n'\])[^;]*\?\?\s*0/.test(src)
      || /sacrificedUnits[\s\S]{0,120}counters/.test(src);
    if (amount) {
      reads++;
      if (!tpl.includes('{X}')) bad.push(`${key}: the amount is fixed on the stack — say {X}: "${tpl}"`);
    }
    if (def.graftCopies && tpl !== '') bad.push(`${key}: a graft multiplier says nothing itself: "${tpl}"`);
    // {X} is the item's X, set at cast. A card that DEFINES its own X ("a
    // Fireball X, where X is my power") has none — the slot would print a bare
    // "X". Such a clause says it the card's way: "Fireball X (X = its power)".
    // {X} needs somewhere to come from: a cast X, the fixed amount above, the
    // clause's own AMOUNT entry, or the card's xPreview. Otherwise the line
    // would print a bare "X" for ever.
    const card = getCard(key.slice(key.indexOf(':') + 1).split('#')[0]!);
    const hasX = /\b(?:ctx|item)\.x\b|\.x\s*\?\?/.test(src) || def.targets?.count === 'X' || amount
      || key in AMOUNT || !!card.xPreview || !!card.xPreviewRows;
    if (tpl.includes('{X}') && !hasX) bad.push(`${key}: {X} with no amount to show: "${tpl}"`);
    const most = maxTargets(def);
    for (const m of tpl.matchAll(/\{(\d+)\+\}/g)) {
      if (most - Number(m[1]) <= 1) bad.push(`${key}: ${m[0]} on a clause that names at most one target there: "${tpl}"`);
    }
  }
  assert.ok(reads >= 10, `only ${reads} effects read a fixed amount — the source match has drifted`);
  for (const k of Object.keys(AMOUNT)) {
    if (!POOL.has(k)) bad.push(`AMOUNT has ${k}, which the pool does not`);
    else if (!(DOES[k] ?? '').includes('{X}')) bad.push(`AMOUNT has ${k}, whose line never says {X}`);
  }
  assert.deepEqual(bad, []);
});

/** ordinary names, the length a real table has */
const NAMES = ['Skybreaker', 'Chombot', 'Bubb', 'Graxxlid', 'Twin Flame'];
const sample = (tpl: string, mode: unknown): string | null => renderTemplate(tpl, {
  target: i => NAMES[i % NAMES.length]!, count: 2, controllerOf: () => 'Rashi',
  me: 'Skybreaker', you: 'Ben', opponent: 'Rashi', amount: { x: 3, live: true }, mode, text: s => s,
});

test('§3 rendered with ordinary names, every line fits the caption', () => {
  const CAP = 90;
  const long: string[] = [];
  for (const [key, def] of POOL) {
    const tpl = DOES[key] ?? '';
    let modes: unknown[] = [undefined];
    try { modes = def.modes?.options({ s: {} } as never, { x: 3 } as never, {} as never).map(o => o.value) ?? modes; }
    catch { /* live-table options: the first key in the template stands in */ }
    for (const mode of modes) {
      const line = sample(tpl, mode ?? /\{mode:([^=|}]+)/.exec(tpl)?.[1]) ?? '';
      if (line.length > CAP) long.push(`${key} (${line.length}): ${line}`);
    }
  }
  assert.deepEqual(long, [], `a line over ${CAP} characters is not one line on the strip`);
});

// ── §4 the renderer ────────────────────────────────────────────────────────

const ctx = (o: Partial<SlotContext> = {}): SlotContext => ({
  target: i => ['Bubb', 'Skybreaker', 'Chombot'][i] ?? null, count: 2,
  controllerOf: () => 'Rashi', me: 'Graxxlid', you: 'Ben', opponent: 'Rashi',
  amount: { x: 3, live: false }, mode: undefined, text: s => s, ...o,
});

test('§4a the owner\'s three examples, filled', () => {
  assert.equal(renderTemplate('Delete {0}', ctx()), 'Delete Bubb');
  assert.equal(renderTemplate('Deal 2 damage to {0+}', ctx()), 'Deal 2 damage to Bubb and Skybreaker');
  assert.equal(renderTemplate('Negate {0}. {0.controller} draws a card', ctx({ target: () => 'Twin Flame', count: 1 })),
    'Negate Twin Flame. Rashi draws a card');
});

test('§4b lists, X, modes (with a slot inside), and a sentence with nobody in it drops', () => {
  assert.equal(listText(['A', 'B', 'C']), 'A, B and C');
  assert.equal(renderTemplate('Put {X} -1/-1 counters on {0}', ctx()), 'Put 3 -1/-1 counters on Bubb');
  assert.equal(renderTemplate('{0} {mode:lose=loses|gain=gains} {X} life', ctx({ mode: 'gain' })), 'Bubb gains 3 life');
  assert.equal(renderTemplate('{mode:create=Create {X} 1/1 units|base=Your units become base {X}/{X}}', ctx({ mode: 'base' })),
    'Your units become base 3/3');
  // Penance with no player chosen: the list sentence goes, the draw stays
  assert.equal(renderTemplate('{0+} each lose 1 life. Draw a card', ctx({ count: 0, target: () => null })), 'Draw a card');
  assert.equal(renderTemplate('Delete {0}', ctx({ count: 0, target: () => null })), null, 'nothing left to say');
});

function state(): GameState {
  return {
    players: [{ name: 'Ben' }, { name: 'Rashi' }],
    entities: { 7: { id: 7, card: 'Cadaverous Cultivator', controller: 0 }, 8: { id: 8, card: 'Bubb', controller: 1 } },
    stack: [],
  } as unknown as GameState;
}
const item = (parts: EffectPart[], o: Partial<StackItem> = {}): StackItem =>
  ({ id: 1, kind: 'activated', label: 'x', controller: 0, region: 0, negated: false, parts, ...o }) as StackItem;
const name = (t: TargetRef): string => ('unit' in t ? state().entities[t.unit]!.card : '?');

test('§4b2 fixed amounts are numbers, live ones "X (currently N)", and one is singular', () => {
  // the owner's two forms, word for word
  assert.equal(renderTemplate('Create a Fireball {X}', ctx({ amount: { x: 4, live: false } })), 'Create a Fireball 4');
  assert.equal(renderTemplate('Create a Fireball {X}', ctx({ amount: { x: 4, live: true } })), 'Create a Fireball X (currently 4)');
  // twice in a sentence, said once; and in the right sentence
  assert.equal(renderTemplate('Create a Poison {X} and a Fireball {X}', ctx({ amount: { x: 2, live: true } })),
    'Create a Poison X and a Fireball X (currently 2)');
  assert.equal(renderTemplate('Erase {0}. {0.controller} gains {X} life', ctx({ amount: { x: 7, live: true } })),
    'Erase Bubb. Rashi gains X life (currently 7)');
  // no value to show yet: a bare X, and nothing invented
  assert.equal(renderTemplate('Glimpse {X}', ctx({ amount: undefined })), 'Glimpse X');
  assert.equal(renderTemplate('Put {X} -1/-1 counters on {0}', ctx({ amount: { x: 1, live: false } })), 'Put 1 -1/-1 counter on Bubb');
  assert.equal(renderTemplate('Create {X} 1/1 units', ctx({ amount: { x: 1, live: false } })), 'Create 1 1/1 unit');
  // Nothyr, "up to one", nobody chosen: the owner's "Negate nothing"
  const it = item([{ effectKey: 'ability:Nothyr#0', targets: [] }], { kind: 'triggered', card: 'Nothyr' });
  assert.equal(doesLine(it, state(), name), 'Negate nothing');
});

test('§4b3 a multiplier\'s copies say the run once, and how many times', () => {
  const twin = (): EffectPart => ({ effectKey: 'graft:Twin Flame', targets: [{ unit: 8 }] });
  const it = item([{ effectKey: 'ability:Lost Guardian#0', targets: [] }, twin(), twin()], { sourceId: 7 });
  assert.equal(doesLine(it, state(), name), 'Deal 2 damage to Bubb (twice)');
  // copies aimed differently are different lines, and stay so
  const other = twin(); other.targets = [{ unit: 7 }];
  const it2 = item([{ effectKey: 'ability:Lost Guardian#0', targets: [] }, twin(), other], { sourceId: 7 });
  assert.match(doesLine(it2, state(), name)!, /Bubb, then deal 2 damage to Cadaverous Cultivator$/);
});

test('§4c a graft cause that does nothing itself says only what its grafts do', () => {
  assert.equal(DOES['ability:Cadaverous Cultivator#0'], '', 'the owner: one unified ability, not a trigger for the grafts');
  const it = item([
    { effectKey: 'ability:Cadaverous Cultivator#0', targets: [] },
    { effectKey: 'graft:Twin Flame', targets: [{ unit: 8 }] },
  ], { sourceId: 7 });
  assert.equal(doesLine(it, state(), name), 'Deal 2 damage to Bubb');
});

test('§4d parts join ", then ", a spent part is skipped, and an unknown clause falls back', () => {
  const it = item([
    { effectKey: 'spell:Pull Under', targets: [{ unit: 8 }] },
    { effectKey: 'graft:Twin Flame', targets: [{ unit: 8 }] },
  ], { kind: 'spell', card: 'Pull Under' });
  const line = doesLine(it, state(), name)!;
  assert.match(line, /^Delete Bubb.*, then deal 2 damage to Bubb$/, line);
  it.parts[1]!.spent = true;
  assert.doesNotMatch(doesLine(it, state(), name)!, /then/);
  assert.equal(doesLine(item([{ effectKey: 'spell:No Such Card', targets: [] }]), state(), name), null);
});

test('§4e every AMOUNT entry reads a real table without throwing', () => {
  const h = new Harness(34420, ['Ben', 'Rashi']);
  const me = spawn(h, 0, 'Skybreaker');
  const foe = spawn(h, 1, 'Bubb');
  const failed: string[] = [];
  for (const key of Object.keys(AMOUNT)) {
    const it = item([{ effectKey: key, targets: [{ unit: foe }, { unit: me }] }], { sourceId: me, controller: 0, region: 0 });
    try {
      const a = amountOf(it, it.parts[0]!, h.state);
      if (a && !Number.isFinite(a.x)) failed.push(`${key}: ${a.x}`);
    } catch (e) { failed.push(`${key}: threw ${String(e)}`); }
  }
  assert.deepEqual(failed, []);
  // and one of each kind, with numbers a person can check
  const squish = item([{ effectKey: 'spell:Squish', targets: [{ unit: me }, { unit: foe }] }], { kind: 'spell', card: 'Squish' });
  const a = amountOf(squish, squish.parts[0]!, h.state)!;
  assert.equal(a.live, true, 'Squish reads the defense when it resolves');
  assert.equal(a.x, new E(h.state).effStats(h.state.entities[me]!)[1], 'and today that is the unit\'s defense');
  const fireball = item([{ effectKey: 'spell:Fireball', targets: [{ unit: foe }] }], { kind: 'spellToken', card: 'Fireball', x: 3 });
  assert.deepEqual(amountOf(fireball, fireball.parts[0]!, h.state), { x: 3, live: false }, 'a paid X is fixed');
});
