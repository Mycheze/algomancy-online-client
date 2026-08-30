/* R235-adjacent / CT-99 — "WE MOVED IT TO THE BACKLOG" MUST BE CHECKABLE.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `card-todo.ts` and `playtest-ledger.ts` both enforce a hard rule: nothing is
 * `done`/`fixed` without naming a TEST that would fail if it regressed. That
 * rule exists because of Harbinger of Immolation, which looked tracked for two
 * days behind a `{todo:true}` placeholder while the card was completely dead.
 *
 * Round 29 hit the one case the rule does not fit. Playtest report #113 was an
 * IDEA — the owner wrote "UX improvement idea" in the report himself — and the
 * honest resolution was to move it to the backlog, not to build it. But there
 * is no test that "keeps an idea fixed", so closing it named no guard, and the
 * suite refused. Correctly: **"I filed it somewhere else" is exactly the shape
 * of claim this repository has learned not to take on trust.**
 *
 * So relocation gets a guard of its own. If a closure says the work moved to
 * `BL-nn`, that entry must EXIST — and it must not be `dropped`, because
 * "moved it to the backlog and then dropped it" is how a report dies quietly
 * while two ledgers both read as clean.
 *
 * ⚠ THE CHEAP FAILURE THIS AVOIDS: a `done` note reading "tracked as BL-99"
 * when there is no BL-99. Both ledgers would be green, the report would be off
 * both lists, and nothing would ever look for it again. That is the same shape
 * as the four `fixed` reports whose guards could never have failed (docs/13 §5)
 * — a closure that describes an outcome rather than demonstrating one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TODO } from '../../ledgers/card-todo.ts';
import { LEDGER } from '../../ledgers/playtest-ledger.ts';
import { BACKLOG } from '../../ledgers/backlog.ts';

/** every `BL-nn` cited by a closed todo entry or a settled ledger row */
function citedBacklogIds(): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  for (const t of CARD_TODO) {
    const text = `${t.closed ?? ''} ${t.progress ?? ''}`;
    for (const [, id] of text.matchAll(/\b(BL-\d+)\b/g)) out.push({ id: id!, where: `CT-${t.id}` });
  }
  for (const e of LEDGER) {
    for (const [, id] of (e.note ?? '').matchAll(/\b(BL-\d+)\b/g)) {
      out.push({ id: id!, where: `report #${e.id}` });
    }
  }
  return out;
}

test('CT-99 POSITIVE CONTROL: the reader finds the citations it is supposed to police', () => {
  // ⚠ A sweep with an empty subject set passes forever and is indistinguishable
  // from a working one. docs/13 §5 is a catalogue of exactly that, so prove
  // there is something to check before checking it.
  const cited = citedBacklogIds();
  assert.ok(cited.length > 0,
    'no closed todo entry and no ledger row cites a BL-nn, so this guard has NO SUBJECTS and '
    + 'its green means nothing. If relocation stopped being a way work gets closed, delete this '
    + 'test deliberately — do not leave it passing vacuously.');

  // and it must actually parse an id out, not merely find the string
  assert.ok(cited.every(c => /^BL-\d+$/.test(c.id)),
    `the reader produced something that is not a backlog id: ${JSON.stringify(cited.slice(0, 3))}`);
});

test('every BL-nn cited by a closed ticket or a settled report really exists', () => {
  const known = new Set(BACKLOG.map(e => e.id));
  const dangling = citedBacklogIds()
    .filter(c => !known.has(c.id))
    .map(c => `${c.where} says the work moved to ${c.id}, which is not in backlog.ts`);
  assert.deepEqual([...new Set(dangling)].sort(), [],
    'a closure points at a backlog entry that does not exist:\n  ' + dangling.join('\n  ')
    + '\n\nBoth ledgers read as clean and the work is on NEITHER list. Either create the entry '
    + 'or reopen the item — do not edit the note to remove the citation.');
});

test('work relocated to the backlog was not then quietly dropped', () => {
  const byId = new Map(BACKLOG.map(e => [e.id, e]));
  const dropped = citedBacklogIds()
    .filter(c => byId.get(c.id)?.status === 'dropped')
    .map(c => `${c.where} moved the work to ${c.id}, which is now 'dropped'`);
  assert.deepEqual([...new Set(dropped)].sort(), [],
    'work was closed by relocating it, and its destination has since been dropped:\n  '
    + dropped.join('\n  ')
    + '\n\nThat is a report dying quietly while two ledgers both read as clean. If it really '
    + 'is not being done, say so in the ORIGINAL item — the owner filed it there, and that is '
    + 'where he will look for it.');
});
