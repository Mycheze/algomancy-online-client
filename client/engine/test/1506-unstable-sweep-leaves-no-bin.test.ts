/* CR 405.5 (zones.bin.unstable): an {Unstable} card that would enter a bin is
 * erased instead and never enters it — so it never LEAVES one either, and a
 * "When I leave your bin" ability (Rotling, CR 405.7) does not trigger on the
 * state-based sweep that models the replacement. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, giveResources, spawn, toDeployment, withE as whiteBox } from './util.ts';
import type { DecisionOption } from '../src/types.ts';

function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision!;
  assert.ok(dec, 'a decision was expected');
  const i = dec.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

const rotlingAsks = (h: Harness): boolean => /Rotling/.test(h.state.decision?.prompt ?? '');
const rotlingTriggers = (h: Harness, from: number): string[] =>
  h.events.slice(from).filter(ev => ev.type === 'triggered' && /Rotling/.test(ev.msg)).map(ev => ev.msg);
const leftBins = (h: Harness, from: number): unknown[] =>
  h.events.slice(from).filter(ev => ev.type === 'leftBin').map(ev => ev.data?.['card']);

test('CT-574 #421: Rotling grafted out of the bin offers its pay-[1]; when its host dies Unstable it does not', () => {
  const h = new Harness(15061);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 4);
  const host = spawn(h, P, 'Bloated Manablub');
  h.state.players[P]!.bin.push('Rotling');
  h.do({ type: 'graft', seat: P, from: 'bin', index: 0, hostId: host, position: 0 });
  assert.equal(ent(h, host)!.mods.length, 1, 'Rotling is grafted onto the Manablub');
  assert.ok(rotlingAsks(h), 'control: leaving the bin by the graft offers the pay-[1]');
  pickBy(h, o => o.value === false);                 // declined: the [Switch1] use is not spent

  const mark = h.events.length;
  whiteBox(h, e => e.destroy(e.entity(host)!, 'dies'));
  assert.ok(h.state.players[P]!.erased?.includes('Rotling'), 'the Rotling is erased with its Unstable host');
  assert.ok(!h.state.players[P]!.bin.includes('Rotling'), 'and never rests in the bin');
  assert.deepEqual(leftBins(h, mark), [], 'nothing left a bin it never entered');
  assert.deepEqual(rotlingTriggers(h, mark), [], "so Rotling's own bin trigger does not fire");
  // the graft itself still works as printed: Rotling's effect rides the host's
  // "When I despawn" (CR 722.1b), so that composite is what asks now
  assert.ok(h.events.slice(mark).some(ev => ev.type === 'triggered' && /Bloated Manablub/.test(ev.msg)),
    "the host's own despawn trigger, carrying the graft, is the one that fires");
});

test('#421: a Rotling unit that dies Unstable (carrying a mod, or played from the bin) does not trigger off its own erase', () => {
  for (const how of ['modded', 'stamped'] as const) {
    const h = new Harness(15062);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    giveResources(h, P, 'dark', 4);
    const r = spawn(h, P, 'Rotling');
    if (how === 'modded') {
      h.state.players[P]!.bin.push('Rotling');
      h.do({ type: 'graft', seat: P, from: 'bin', index: 0, hostId: r, position: 0 });
      pickBy(h, o => o.value === false);
    } else {
      whiteBox(h, e => { e.entity(r)!.unstable = true; });   // CR 803.8d: the until-regroup stamp
    }
    const mark = h.events.length;
    whiteBox(h, e => e.destroy(e.entity(r)!, 'dies'));
    assert.ok(!h.state.players[P]!.bin.includes('Rotling'), `${how}: no Rotling rests in the bin`);
    assert.deepEqual(leftBins(h, mark), [], `${how}: no bin exit is announced`);
    assert.deepEqual(rotlingTriggers(h, mark), [], `${how}: and no Rotling trigger fires`);
    assert.ok(!rotlingAsks(h), `${how}: nor offers its pay-[1]`);
  }
});

test('#421 control: an unmodded Rotling that dies is binned and has not left the bin', () => {
  const h = new Harness(15063);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const r = spawn(h, P, 'Rotling');
  const mark = h.events.length;
  whiteBox(h, e => e.destroy(e.entity(r)!, 'dies'));
  assert.ok(h.state.players[P]!.bin.includes('Rotling'), 'an unmodded Rotling is binned');
  assert.deepEqual(leftBins(h, mark), [], 'and has not left');
});
