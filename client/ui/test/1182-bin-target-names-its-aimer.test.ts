/* CT-537 — report #341 (invi, room ASSX, 2026-11-07, feature):
 *
 *   "when targeting, cards that are already targeted should not only say that
 *    they are targeted, but also by what (because it's sometimes ambiguous)"
 *
 * ASSX at [276]: Blightwalker's recall [269] and Combustible Bogwalker's recall
 * (stack item 114) were BOTH aiming at Dropslime copies in invi's bin. Each copy
 * wore the same "🎯 targeted" chip (the region strip a bare "🎯"), with a
 * tooltip that named nothing, so which copy belonged to which item could only
 * be found by hovering the stack rows one at a time.
 *
 * Now the card says what aims at it: in the bin dialog, under the card, "by
 * Blightwalker" (the chip itself is ~14 characters wide, too narrow for
 * "Combustible Bogwalker"), and the chip's tooltip on BOTH surfaces, the
 * region strip and the dialog, names every stack item aiming at that copy. Derived from the public stack (as CT-169's
 * surfacing is), so the opponent reads the same names.
 *
 * Board units carry no target chip to extend: hovering a unit already draws
 * the arrows from every stack item aimed at it (main.ts hoverArrowsFor).
 *
 * Seeds 1182xx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { client, zone } from './ui-driver.ts';
import { E } from '../../engine/src/engine.ts';
import type { BinRef, StackItem } from '../../engine/src/types.ts';

const ui = await client();

/** a Blightwalker trigger aimed at the FIRST Dropslime in seat 0's bin (two
 * copies, one buried), the shape test 260 builds for CT-169 */
function aimed(seed = 118201): Harness {
  const h = new Harness(seed);
  toDeployment(h);
  const bw = spawn(h, 0, 'Blightwalker');
  const atk = spawn(h, 1, 'Unit Token');
  toNextBattle(h, 1);
  h.do({ type: 'declareAttack', seat: 1, columns: [[atk]] });
  h.state.players[0]!.bin.push('Dropslime', 'Wisp', 'Dropslime', 'Fireball', 'Good Whale');
  withE(h, e => { e.destroy(e.entity(bw)!, 'dies'); });
  const dec = h.state.decision!;
  assert.ok(dec, 'the Blightwalker trigger raised no target question');
  const i = dec.options.findIndex(o => o.card === 'Dropslime');
  assert.ok(i >= 0, 'no option names Dropslime');
  h.do({ type: 'decide', seat: dec.seat, choice: i });
  assert.equal(h.state.stack.length, 1, 'the trigger is not on the stack');
  return h;
}

/** ASSX's second aimer: a Combustible Bogwalker recall on the OTHER copy.
 * Cloned from the real trigger rather than activated, because only its card
 * name and its target matter to what is drawn. */
function secondAimer(h: Harness): void {
  const first = h.state.stack[0]!;
  const bin = first.parts.flatMap(p => p.targets).find(t => 'bin' in t) as { bin: { seat: 0; card: string; nth?: number } };
  const other = (bin.bin.nth ?? 0) === 0 ? 1 : 0;
  const it: StackItem = structuredClone(first);
  it.id = h.state.nextId++;
  it.kind = 'activated';
  it.card = 'Combustible Bogwalker';
  it.label = 'Combustible Bogwalker: recall target unit in your bin';
  it.parts = it.parts.map(p => ({ ...p, targets: p.targets.map(t => ('bin' in t ? { bin: { ...t.bin, nth: other } } : t)) }));
  h.state.stack.push(it);
}

/** the bin dialog's own markup, without the board behind it */
function dialog(html: string): string {
  const at = html.indexOf('class="overlaybox binbox"');
  assert.ok(at >= 0, 'the bin dialog did not open');
  return html.slice(at);
}

/** every 🎯 chip in some HTML, as [label, tooltip] */
function chips(html: string): [string, string][] {
  return [...html.matchAll(/<span class="badge[^"]*tgtnow[^"]*"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
    .map(m => [m[2]!, m[1]!]);
}

/** each targeted dialog entry, as bin index → its "by …" caption */
function captions(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/<div class="binentry"><div class="card[^"]*" data-act="bin" data-p="0" data-i="(\d+)"((?:(?!data-act="bin")[\s\S])*?)class="bintgtby">([^<]*)</g)) {
    out.set(Number(m[1]), m[3]!);
  }
  return out;
}

/** the bin index each stack item aims at, by the engine's own lookup */
function aimedIndex(h: Harness, n: number): number {
  const t = h.state.stack[n]!.parts.flatMap(p => p.targets).find(x => 'bin' in x) as { bin: BinRef };
  return new E(h.state).binIndexOf(t.bin);
}

function openDialog(h: Harness, seat: 0 | 1): string {
  ui.join(viewFor(h.state, seat), seat, []);
  const open = ui.click({ btn: 'binopen', p: 0 });
  ui.click({ btn: 'binclose' });
  return dialog(open);
}

test('CT-537 the bin dialog says what is aiming at a targeted card, not just "targeted"', () => {
  const h = aimed();
  const d = openDialog(h, 0);
  const c = chips(d);
  assert.equal(c.length, 1, `expected one target chip in the dialog, saw ${JSON.stringify(c)}`);
  assert.match(c[0]![1], /^Blightwalker is aiming at this card/, `the chip's tooltip ${JSON.stringify(c[0]![1])} does not name the aimer`);
  assert.deepEqual([...captions(d)], [[aimedIndex(h, 0), 'by Blightwalker']],
    'the targeted card does not say, under it, what is aiming at it');
});

test('CT-537 the region strip\'s crosshair names its aimer on hover, for the opponent too', () => {
  const h = aimed();
  for (const seat of [0, 1] as const) {
    const c = chips(zone(ui.join(viewFor(h.state, seat), seat, []), 'bin:0'));
    assert.equal(c.length, 1, `seat ${seat}: expected one target chip on the strip, saw ${JSON.stringify(c)}`);
    assert.equal(c[0]![0], '🎯', 'the strip thumb is 46px: its label stays the bare crosshair');
    assert.match(c[0]![1], /^Blightwalker is aiming at this card/, `seat ${seat}: the strip tooltip does not name the aimer`);
  }
});

test('CT-537 two items aiming at two copies of one card: each copy names its own aimer (the ASSX case)', () => {
  const h = aimed();
  secondAimer(h);
  const a = aimedIndex(h, 0);
  const b = aimedIndex(h, 1);
  assert.notEqual(a, b, 'the fixture aims both items at the same copy');
  // the opponent's screen, which reads the same public stack
  const got = captions(openDialog(h, 1));
  assert.deepEqual([...got].sort((x, y) => x[0] - y[0]),
    [[a, 'by Blightwalker'], [b, 'by Combustible Bogwalker']].sort((x, y) => (x[0] as number) - (y[0] as number)),
    'the two Dropslime copies do not say which item aims at which');
});

test('CT-537 one copy aimed at by two items lists both, bottom of the stack first', () => {
  const h = aimed();
  secondAimer(h);
  // point the second item at the same copy as the first
  const first = h.state.stack[0]!.parts.flatMap(p => p.targets).find(t => 'bin' in t)!;
  const second = h.state.stack[1]!;
  second.parts = second.parts.map(p => ({ ...p, targets: p.targets.map(t => ('bin' in t ? structuredClone(first) : t)) }));
  const d = openDialog(h, 0);
  assert.equal(chips(d).length, 1, 'one copy, one chip');
  assert.match(chips(d)[0]![1], /^Blightwalker and Combustible Bogwalker are aiming at this card/);
  assert.deepEqual([...captions(d)], [[aimedIndex(h, 0), 'by Blightwalker and Combustible Bogwalker']]);
});
