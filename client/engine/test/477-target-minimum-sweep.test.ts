/**
 * CT-305 — a target spec may require fewer targets than it holds ONLY where the
 * card prints so.
 *
 * The owner, 2026-10-16: "Unless a card says 'up to', it must have targets in
 * order to be cast. If a trigger doesn't have the 'up to' caviat, it MUST have
 * targets (unless there are no legal ones), which might result in damanging
 * your own units if you trigger something during deployment". CR 110.7; the RAQ
 * (_passer, 2025-08-27): "In order to play a card, you must be able to select
 * the valid targets".
 *
 * `min` below the slot count did two jobs at once — "up to" AND "skip the cast
 * gate" — and five cards had it with no "up to" printed: Tilling the Graves,
 * Spell Excavation, Eldritch Reclaimer, Big Glimpse Card and Combustible
 * Bogwalker's activated ability (cast/activated), plus Rippleback Skulker's
 * trigger. The X-count spells (Blight's End, Torrential Reclamation, Channel
 * Through) required one target where they print X (CT-303).
 *
 * This sweep is derived from the registry, so a new card with the shape is in
 * it without being named. A spec "allows fewer" when its `min` is a number
 * below its slots — for `count: 'X'` any number at all, since X is unbounded;
 * `min: 'X'` requires every slot. Such a spec passes only if a sentence of the
 * printed text that names a target says "up to" or "any number", or — for a
 * TRIGGERED ability or a graft rider — "may" (the player declines the whole
 * effect; those cards are listed in the round report for the owner).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard, type EffectDef, type TargetSpec } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import { ent, spawn, toDeployment, withE } from './util.ts';

type Route = 'cast' | 'activated' | 'triggered';
interface Row { card: string; where: string; route: Route; spec: TargetSpec; text: string }

/** every target spec in the pool, with the route it is used by */
function specs(): Row[] {
  const out: Row[] = [];
  for (const card of allCardNames()) {
    const c = getCard(card);
    const add = (where: string, route: Route, eff: EffectDef | undefined) => {
      if (eff?.targets) out.push({ card, where, route, spec: eff.targets, text: c.text ?? '' });
    };
    add('spell', 'cast', c.spellEffect);
    (c.abilities ?? []).forEach((a, i) => add(`ability ${i}`, a.type === 'triggered' ? 'triggered' : 'activated', a.effect));
    (c.augmentText ?? []).forEach((a, i) => add(`augment ${i}`, a.type === 'triggered' ? 'triggered' : 'activated', a.effect));
    // a graft rider rides on its host's cause; its "you may" is the same decline a trigger's is
    add('graft', 'triggered', c.graftEffect?.effect);
  }
  return out;
}

/** does the spec let the chooser stop short of its slots? */
function allowsFewer(spec: TargetSpec): boolean {
  if (spec.min === 'X') return false;
  const min = spec.min ?? 1;
  if (spec.count === 'X') return true;   // any fixed min is below some X
  return min < (spec.count ?? 1) + (spec.extraSlots ?? 0);
}

/** the printed sentences that name a target, markup stripped */
function targetSentences(text: string): string[] {
  const plain = text.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return plain.split(/(?<=[.!?])\s+/).filter(s => /\btargets?\b/.test(s));
}

function excused(row: Row): string | null {
  const ss = targetSentences(row.text);
  if (ss.some(s => /\bup to\b|\bany number\b/.test(s))) return 'up to';
  if (row.route === 'triggered' && ss.some(s => /\bmay\b/.test(s))) return 'may';
  return null;
}

/**
 * X counts that may stop short of X although the text says neither "up to" nor
 * "any number". EMPTY, and meant to stay short: an "X target …" card is
 * `min: 'X'` (all of them). An entry here needs the printed reason beside it.
 */
const X_ALLOWLIST: Record<string, string> = {};

test('every target spec that may stop short of its slots prints up to, any number, or a trigger may', () => {
  const rows = specs();
  assert.ok(rows.length > 150, `the registry walk reaches the pool (${rows.length} target specs)`);
  const fewer = rows.filter(r => allowsFewer(r.spec));
  // the tripwire: the shapes that must stay legal are in the walk at all
  for (const must of ['Twin Flame', 'Penance', 'Minor Kraken', 'Malevolent Machinations', 'Hooba-Mon']) {
    assert.ok(fewer.some(r => r.card === must), `${must} (an "up to" / "any number" / trigger "may") is reached`);
  }
  const bad = fewer.filter(r => !excused(r) && !(r.spec.count === 'X' && X_ALLOWLIST[r.card]))
    .map(r => `${r.card} (${r.where}, ${r.route}, min ${String(r.spec.min)} of ${String(r.spec.count ?? 1)}): ${r.text}`);
  assert.deepEqual(bad, [], 'these specs allow too few targets for what is printed (CR 110.7):\n  ' + bad.join('\n  '));
});

test('the X allowlist names only live X-count specs that still need it', () => {
  const rows = specs();
  for (const name of Object.keys(X_ALLOWLIST)) {
    const r = rows.find(x => x.card === name && x.spec.count === 'X');
    assert.ok(r && allowsFewer(r.spec) && !excused(r), `${name} no longer needs its X allowlist entry`);
  }
});

test('the X target spells require every X', () => {
  for (const name of ["Blight's End", 'Torrential Reclamation', 'Channel Through']) {
    const t = getCard(name).spellEffect?.targets;
    assert.equal(t?.min, 'X', `${name} prints "X target …" and requires all X (CT-303)`);
  }
});

test('a must-target trigger with only the controllers own units as targets picks one of them', () => {
  // Unstable Singularity: "When I die, [Switch1] Delete target unit." In deployment,
  // with no enemy unit anywhere, its one legal target is its controller's other unit
  // — the owner: "which might result in damanging your own units".
  const h = new Harness(47701);
  toDeployment(h);
  const A = h.state.deployPlayer as Seat;
  const sing = spawn(h, A, 'Unstable Singularity');
  const mate = spawn(h, A, 'Cinder Scuttler');
  assert.ok(Object.values(h.state.entities).every(e => e.kind !== 'unit' || e.controller === A),
    'the premise: every unit on the board is the controllers own');
  withE(h, e => e.destroy(e.entity(sing)!, 'dies'));
  const dec = h.state.decision!;
  assert.equal(dec?.kind, 'targets', 'the death trigger asks for its target');
  assert.equal(dec.seat, A);
  assert.deepEqual(dec.options.map(o => o.value), [{ unit: mate }],
    'the own unit is the only option, with no "No targets" beside it');
  h.do({ type: 'decide', seat: A, choice: 0 });
  while (h.state.priority !== null && h.state.stack.length) {
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(ent(h, mate), undefined, 'the trigger deleted its controllers own unit');
});
