/**
 * CR 113.2b / CT-341 — THE BASE-STAT LAYER AND THE COPY LAYER ORDER A HIDDEN
 * STEP BY INITIATIVE, NOT BY CLICK.
 *
 * Owner, 2026-10-21: "deployment is stamped accourding to INT/NIT order.
 * 'Real time' doesn't matter in simultanous phases". The strip layer already
 * read E.stampOf / stampNow (532). Layer 2 did not: baseWith sorted the
 * base-setters by the raw clock (a static's source id, setBase's baseSetSeq),
 * and identityCopy sorted copies by CopyRef.seq, so two of them from
 * different seats in one deployment resolved by whoever clicked last.
 *
 * In deployment each seat reaches only its own units (CR 507.1b), so the two
 * effects meet only after a control change; §1 and §2 make it with
 * giveControl. §3 is the copy layer, white-box: no card puts two seats'
 * copies on one unit inside one step today, so the faces are worn directly.
 *
 * Seeds 56600-56699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { effStats, spawn, toDeployment, withE } from './util.ts';

/**
 * One deployment. `sweaver` owns an Aberrant Statweaver ("Your units are base
 * 3/3"); `setter` makes its own Good Whale base 5/5 (setBase, Formless's
 * route). `statweaverFirst` is the CLICK order. Then the Whale is handed to
 * the Statweaver's owner, beside it, so both rewrites reach it.
 */
function layerTwo(seed: number, sweaverIsInitiative: boolean, statweaverFirst: boolean): [number, number] {
  const h = new Harness(seed);
  toDeployment(h);
  assert.equal(h.state.phase, 'deploy', 'setup: in the deployment step');
  const INT = h.state.initiative, NIT = (1 - INT) as Seat;
  const S = sweaverIsInitiative ? INT : NIT, B = (1 - S) as Seat;
  const whale = spawn(h, B, 'Good Whale');                      // 7/5, made before either click
  let weaver: EntityId = -1;
  const statweaver = (): void => { weaver = spawn(h, S, 'Aberrant Statweaver'); };
  const rebase = (): void => withE(h, e => e.setBase(e.s.entities[whale]!, 5, 5));
  if (statweaverFirst) { statweaver(); rebase(); } else { rebase(); statweaver(); }
  withE(h, e => {
    const w = e.s.entities[whale]!;
    w.region = e.s.entities[weaver]!.region;
    e.giveControl(w, S);
  });
  return effStats(h, whale);
}

test('CR 113.2b / CT-341 §1: the NIT Statweaver, clicked first, is still newer than the INT player base rewrite', () => {
  // INT rewrites (clicked second); NIT's Statweaver (clicked first) is the
  // later stamp by initiative, so it wins: base 3/3
  assert.deepEqual(layerTwo(56600, false, true), [3, 3]);
});

test('CR 113.2b / CT-341 §2: the NIT base rewrite, clicked first, is still newer than the INT Statweaver', () => {
  // NIT rewrites first; INT's Statweaver comes second by the clock but first
  // by initiative, so the rewrite is the later and wins: base 5/5
  assert.deepEqual(layerTwo(56601, true, false), [5, 5]);
});

test('CR 113.2b / CT-341 §2b: outside the disagreement the clock and the initiative agree', () => {
  // INT's Statweaver first, NIT's rewrite second: both readings say the rewrite
  assert.deepEqual(layerTwo(56602, true, true), [5, 5]);
});

test('CR 113.2b / CT-341 §3: two seats copies on one unit in one deployment resolve by initiative', () => {
  const h = new Harness(56603);
  toDeployment(h);
  const INT = h.state.initiative, NIT = (1 - INT) as Seat;
  const u = spawn(h, INT, 'Unit Token');
  const whale = spawn(h, INT, 'Good Whale');
  const bubb = spawn(h, NIT, 'Bubb');
  let face = '';
  withE(h, e => {
    const t = e.s.entities[u]!;
    // the NIT player's copy is clicked FIRST, the INT player's second
    e.becomeCopy(t, e.s.entities[bubb]!, { from: 'Apex Prime', until: 'regroup', seat: NIT });
    e.becomeCopy(t, e.s.entities[whale]!, { from: 'Apex Prime', until: 'regroup', seat: INT });
    face = e.faceName(t);
  });
  assert.equal(face, 'Bubb', 'the INT player copy is the older by initiative, so the NIT player Bubb is the face');
  withE(h, e => {
    for (const c of e.s.entities[u]!.copies ?? []) assert.ok(Array.isArray(c.at), `${c.card}: the face carries its stamp`);
  });
});
