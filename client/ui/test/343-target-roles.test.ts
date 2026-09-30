/* WHO DOES WHAT on the stack (owner, 2026-09-29): "when an effect has more
 * than one target and will do different things to the different targets, it's
 * not always obvious which target is which … Reconfigure puts a target unit
 * UNDER another target unit. Something like Twin Bolt doesn't need to be
 * clarified since each target will be dealt with identically."
 *
 * The card declares the jobs (TargetSpec.roles) or says there are none
 * (TargetSpec.symmetric); ui/effectface.ts roleSentence fills them in for the
 * stack caption. The first test walks THE WHOLE POOL rather than a list: every
 * spec that can take more than one target must have decided which it is, so a
 * new card cannot arrive undecided. Two of the seven (Scrap For Parts and
 * Chombot) had their roles only implicit in run() — nothing on the spec said
 * which target was which until this.
 *
 * Seeds 34300-34399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import type { TargetSpec } from '../../engine/src/cards/dsl.ts';
import type { EffectPart, StackItem, TargetRef } from '../../engine/src/types.ts';
import { roleSentence } from '../effectface.ts';

/** every effect in the pool that can target, keyed the way the engine keys it */
function allSpecs(): { key: string; spec: TargetSpec }[] {
  const out: { key: string; spec: TargetSpec }[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (c.spellEffect?.targets) out.push({ key: `spell:${name}`, spec: c.spellEffect.targets });
    c.abilities?.forEach((a, i) => {
      const t = (a as { effect?: { targets?: TargetSpec } }).effect?.targets;
      if (t) out.push({ key: `ability:${name}#${i}`, spec: t });
    });
    c.augmentText?.forEach((a, i) => {
      const t = (a as { effect?: { targets?: TargetSpec } }).effect?.targets;
      if (t) out.push({ key: `augment:${name}#${i}`, spec: t });
    });
    if (c.graftEffect?.effect.targets) out.push({ key: `graft:${name}`, spec: c.graftEffect.effect.targets });
  }
  return out;
}

const multi = (s: TargetSpec): boolean =>
  s.count === 'X' || (s.count ?? 1) > 1 || (s.extraSlots ?? 0) > 0;

test('every spec that can take several targets has decided: roles, or symmetric — never both, never neither', () => {
  const specs = allSpecs();
  assert.ok(specs.length > 100, `the walk reached the pool (${specs.length} targeting effects)`);
  const undecided: string[] = [], both: string[] = [], stray: string[] = [];
  for (const { key, spec } of specs) {
    if (!multi(spec)) {
      if (spec.roles || spec.symmetric) stray.push(key);
      continue;
    }
    if (spec.roles && spec.symmetric) both.push(key);
    else if (!spec.roles && !spec.symmetric) undecided.push(key);
  }
  assert.deepEqual(undecided, [],
    'a new multi-target effect: add `roles` (its targets do different jobs — say which) or '
    + '`symmetric: true` (they are all treated alike) to its TargetSpec');
  assert.deepEqual(both, []);
  assert.deepEqual(stray, [], 'a single-target spec has no jobs to tell apart — the field would be noise');
});

test('every roles template names each target it can have, and no target it cannot', () => {
  for (const { key, spec } of allSpecs()) {
    if (!spec.roles) continue;
    const fixed = (spec.extraSlots ?? 0) + (typeof spec.count === 'number' ? spec.count : 0);
    const refs = [...spec.roles.matchAll(/\{(\d+)(\+?)\}/g)].map(m => ({ i: Number(m[1]), rest: m[2] === '+' }));
    for (const r of refs) {
      assert.ok(r.i < fixed + (spec.count === 'X' ? 1 : 0), `${key}: {${r.i}} is past the last target slot`);
    }
    if (spec.count === 'X') {
      assert.ok(refs.some(r => r.rest), `${key}: an X-count spec needs a {i+} for its variable targets`);
    } else {
      for (let i = 0; i < fixed; i++) {
        assert.ok(refs.some(r => r.i === i || (r.rest && r.i <= i)), `${key}: target ${i} has no job in "${spec.roles}"`);
      }
    }
  }
});

test('the seven cards whose targets do different jobs', () => {
  const withRoles = [...new Set(allSpecs().filter(s => s.spec.roles).map(s => s.key.replace(/^\w+:|#\d+$/g, '')))].sort();
  assert.deepEqual(withRoles,
    ['Channel Through', 'Chombot', 'Fight', 'Necromorph', 'Reconfigure', 'Scrap For Parts', 'Squish'],
    'the census taken 2026-09-29 — a change here should be a decision, so it is pinned');
});

// ── the sentences ──────────────────────────────────────────────────────────
const NAMES: Record<number, string> = { 1: 'Graxxlid', 2: 'Chombot', 3: 'Skybreaker', 4: 'Hooba-Nan' };
const label = (t: TargetRef): string => ('unit' in t ? NAMES[t.unit]! : 'player' in t ? `P${t.player}` : '?');
const u = (id: number): TargetRef => ({ unit: id });
const item = (...parts: EffectPart[]): StackItem =>
  ({ id: 1, kind: 'spell', label: 'x', controller: 0, region: 0, negated: false, parts }) as StackItem;

test('Reconfigure: "moves Graxxlid onto Chombot"', () => {
  assert.equal(roleSentence(item({ effectKey: 'spell:Reconfigure', targets: [u(1), u(2)] }), label),
    'moves Graxxlid onto Chombot');
});

test('a grafted trigger reads each part in order, ", then "', () => {
  const s = roleSentence(item(
    { effectKey: 'ability:Chombot#0', targets: [u(1), u(3)] },
    { effectKey: 'graft:Fight', targets: [u(2), u(1)] },
  ), label);
  assert.equal(s, 'up to two counters from Graxxlid onto Skybreaker, then Chombot fights Graxxlid');
});

test('a part without roles keeps its plain list; a spent part is not read', () => {
  const s = roleSentence(item(
    { effectKey: 'spell:Reconfigure', targets: [u(1), u(2)] },
    { effectKey: 'graft:Twin Flame', targets: [u(3), u(4)] },
    { effectKey: 'graft:Fight', targets: [u(2), u(4)], spent: true },
  ), label);
  assert.equal(s, 'moves Graxxlid onto Chombot, then Skybreaker, Hooba-Nan');
});

test('Channel Through: the opponent is {0} and the X allies are the rest', () => {
  assert.equal(roleSentence(item({ effectKey: 'spell:Channel Through', targets: [{ player: 1 }, u(2), u(3)] }), label),
    "2 each to Chombot, Skybreaker; 2 spread over P1's units");
});

test('symmetric and single-target effects leave the caption alone', () => {
  assert.equal(roleSentence(item({ effectKey: 'spell:Twin Flame', targets: [u(1), u(2)] }), label), null,
    'Twin Flame: "each target will be dealt with identically" — the owner\'s own counter-example');
  assert.equal(roleSentence(item({ effectKey: 'spell:Fireball', targets: [u(1)] }), label), null);
  assert.equal(roleSentence(item({ effectKey: 'no such key', targets: [u(1)] }), label), null,
    'an unknown key is not a crash on the table');
});

test('a target that has gone since the cast leaves a dash, and the words are escaped separately', () => {
  assert.equal(roleSentence(item({ effectKey: 'spell:Reconfigure', targets: [u(1)] }), label), 'moves Graxxlid onto —');
  assert.equal(roleSentence(item({ effectKey: 'spell:Reconfigure', targets: [u(1), u(2)] }),
    t => `<em>${label(t)}</em>`, s => s.toUpperCase()),
  'MOVES <em>Graxxlid</em> ONTO <em>Chombot</em>', 'the target labels are the caller\'s; only the words between go through `text`');
});
