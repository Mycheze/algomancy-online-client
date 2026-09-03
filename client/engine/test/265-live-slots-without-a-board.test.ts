/* CT-161 — EVERY LIVE-SLOT HELPER MUST SURVIVE A PAGE WITH NO BOARD.
 *
 * ── THE CLASS, AND WHY ONE MEMBER OF IT WAS NOT ENOUGH
 *
 * R258/CT-123 made `paintLive()` a SECOND writer of the board nodes: render()
 * emits a handful of `class="liveslot"` hosts empty and paintLive fills them
 * afterwards, so the ⏭ chip and the presence dot stay true while R150's
 * throttle is holding and a render would be unsafe (it ends in runAutoPass —
 * it SENDS). paintLive is reached from `flushPace()` and from `pumpPace()`,
 * and `flushPace()` is the FIRST line of the `t === 'error'` handler.
 *
 *     function paintLive(): void {
 *       setLiveSlot('paceslot',     paceChipHtml());
 *       setLiveSlot('presenceslot', presenceHtml());
 *       setLiveSlot('shareslot',    shareBannerHtml());
 *     }
 *
 * `setLiveSlot` opens with "no such node — not a board screen, bail". That
 * guard is INSIDE THE CALLEE, so it protects nothing: the argument is
 * evaluated first, on every screen, including the ones where
 * `NetBackend.state` is still `null as unknown as GameState`.
 * `shareBannerHtml()` read `h.state.phase` there and threw, and the throw ate
 * `uiError = m.msg; playCue(...); render()` three statements further down — so
 * a refused join sat on "Connecting to the server…" forever. That is CT-148 /
 * report #135, and it was closed by patching THAT ONE HELPER (254 §2/§3 guard
 * the symptom). Nothing held the class, and the closing note said so: "ANY
 * markup helper reachable from it must not assume h.state".
 *
 * ── WHAT THIS FILE HOLDS
 *
 * The contract, for every helper in the slot table at once:
 *
 *     a live-slot helper runs on screens that have no board.
 *     It must RETURN — '' is a fine answer — and it must not throw.
 *
 * ── DERIVED, NOT TYPED (docs/13-assessment.md §7.2)
 *
 * The helper list is READ OUT OF `paintLive`'s own body, because a helper
 * added next round is exactly the case that must not slip through, and a
 * hand-typed list of three would pass forever while the fourth shipped broken.
 * `ledgers/unreached.ts`'s header is this repo's post-mortem of the other
 * outcome. §1 also checks the derivation itself: every `setLiveSlot(` call in
 * the body must have been UNDERSTOOD (a call written in a shape the parse
 * cannot read would otherwise shrink the census silently), paintLive must be
 * the only caller in the file, and each helper it names must be a real
 * function declared in main.ts.
 *
 * ── AND THE MEASUREMENT IS PER-HELPER, not "paintLive did not throw"
 *
 * Arguments are evaluated before the call, so `setLiveSlot('shareslot', …)` is
 * ENTERED only if `shareBannerHtml()` returned. `setLiveSlot`'s first act is
 * `document.getElementById(id)` — so recording the ids that reach
 * getElementById during one paint says exactly which helpers returned and
 * which one stopped the run. §2 is the control on that instrument: it must
 * report an empty set for a message that paints nothing, or "all of them" is
 * the only answer it can give and this file is about nothing.
 *
 * ── WHAT THIS ADDS OVER 254, MEASURED RATHER THAN CLAIMED
 *
 * 254 §2/§3 drive the same door, so a fourth helper that throws on the
 * connecting screen DOES redden them — with a bare `TypeError: Cannot read
 * properties of null` out of `push()` and no word about which helper or that
 * there is a class here at all. What 254 cannot see, measured by breaking each
 * one and running both files:
 *
 *   · remove `this.flushPace()` from the `t === 'error'` handler and 254 goes
 *     5/5 GREEN — the refusal still reaches the screen — while the class stops
 *     being exercised by anything. §3/§4 here fail, and say so in those words.
 *   · a live slot the board emits that paintLive never fills, or a
 *     `setLiveSlot` caller outside paintLive: §1 and §6, invisible to 254.
 *
 * §1 the census, derived from paintLive's body
 * §2 the probe: it can tell a paint that ran from one that did not
 * §3 the connecting screen — no state at all (the CT-148 crash site)
 * §4 the constructed waiting room — joined, and still no state
 * §5 the OTHER door, pumpPace, and why it always has a state under it
 * §6 the board: the census against the real markup, and non-vacuity
 *
 * Seeds 26500-26599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { emptyPace, pace, paceDue } from '../../ui/pace.ts';
import { viewFor } from '../../server/view.ts';
import { client } from '../../ui/test/ui-driver.ts';
import type { Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts. It starts on the
 * connecting screen (`?room=…` and no `joined` yet), which is the crash site. */
const ui = await client();
const SEAT: Seat = 0;

const MAIN = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');

/* ══ §1 — the census ═══════════════════════════════════════════════════ */

/** the brace-matched body of a top-level `function <name>(` in main.ts */
function bodyOf(name: string): string {
  const at = MAIN.indexOf(`\nfunction ${name}(`);
  assert.ok(at > 0, `ui/main.ts has no top-level function ${name}() — this file is about it`);
  const open = MAIN.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < MAIN.length; i++) {
    if (MAIN[i] === '{') depth++;
    else if (MAIN[i] === '}' && --depth === 0) break;
  }
  assert.ok(depth === 0, `${name}()'s body is unbalanced`);
  return MAIN.slice(open + 1, i);
}

const PAINT = bodyOf('paintLive');

/** one row of the slot table: the node paintLive fills, and what fills it */
interface Slot { id: string; helper: string }

/** THE DERIVED LIST. Every `setLiveSlot('<id>', <helper>())` in paintLive, in
 * the order it runs — which is also the order the probe in §2 must see. */
const SLOTS: Slot[] = [...PAINT.matchAll(/setLiveSlot\(\s*'([\w-]+)'\s*,\s*([\w$]+)\(\)\s*\)/g)]
  .map(m => ({ id: m[1]!, helper: m[2]! }));
const SLOT_IDS = SLOTS.map(s => s.id);

test('CT-161 §1 the live-slot helpers are derived from paintLive, and the derivation is complete', () => {
  assert.ok(SLOTS.length > 0,
    'the census is EMPTY — a guard over an empty derived set passes forever '
    + '(docs/13-assessment.md §5). Either paintLive stopped calling setLiveSlot, or the '
    + 'shape of the call changed and the parse above no longer reads it.');
  assert.ok(SLOTS.length >= 3,
    `only ${SLOTS.length} live slot(s) found; R258 shipped three (pace, presence, share). `
    + 'If one was deliberately retired, move this floor with it — do not delete the check.');

  // the derivation UNDERSTOOD every call: a `setLiveSlot(id, cond ? a() : b())`
  // would parse to nothing and quietly leave that helper unguarded
  const raw = [...PAINT.matchAll(/setLiveSlot\(/g)].length;
  assert.equal(SLOTS.length, raw,
    `paintLive makes ${raw} setLiveSlot calls and this file could only read ${SLOTS.length} of `
    + 'them. The unread one is UNGUARDED — teach the regex its shape.');

  // …and paintLive is the only caller, so a census of paintLive is a census of
  // the class. (The one extra occurrence is the function's own declaration.)
  const everywhere = [...MAIN.matchAll(/setLiveSlot\(/g)].length;
  assert.equal(everywhere, raw + 1,
    'something outside paintLive() calls setLiveSlot() now — this census no longer covers the '
    + 'class, and the new caller has to be driven here too');

  assert.equal(new Set(SLOT_IDS).size, SLOTS.length, 'two slots share a node id');
  for (const { id, helper } of SLOTS) {
    assert.ok(MAIN.includes(`function ${helper}(`),
      `the census named ${helper}() for #${id} and ui/main.ts declares no such function — `
      + 'the parse is reading something that is not a helper call');
  }
});

/* ══ §2 — the probe ════════════════════════════════════════════════════ */

/* `setLiveSlot(id, helper())` evaluates `helper()` and THEN enters
 * setLiveSlot, whose first act is `document.getElementById(id)`. So the ids
 * that reach getElementById during a paint are exactly the helpers that
 * returned, in order. Anything else on the page that asks for an element is
 * filtered out by SLOT_IDS. If setLiveSlot ever stops looking its node up by
 * id, this probe goes blind — and it fails loudly rather than quietly,
 * because §3 then sees an empty list where it demands the whole census. */
const doc = (globalThis as unknown as {
  document: { getElementById: (id: string) => unknown };
}).document;
const realGetElementById = doc.getElementById;
let watching: string[] | null = null;
doc.getElementById = (id: string): unknown => {
  watching?.push(id);
  return realGetElementById.call(doc, id);
};

/** the live slots `run` painted, in the order their helpers returned — and
 * whatever it threw, because the throw NAMES the property the helper assumed
 * and is the most useful line this file can print. It is caught rather than
 * left to escape: the assertion below says which helper never returned, which
 * is the fact the reader needs, and a bare stack out of `push()` buries it. */
function slotsPainted(run: () => void): { painted: string[]; threw: string } {
  watching = [];
  let threw = '';
  try { run(); } catch (e) { threw = String(e); }
  const seen = watching;
  watching = null;
  return { painted: seen.filter(id => SLOT_IDS.includes(id)), threw };
}

/**
 * The failure message §3, §4 and §5 share. `painted` is a PREFIX of the census
 * — everything up to whatever stopped the run — so `SLOTS[painted.length]` is
 * the helper that did not return.
 *
 * TWO DIFFERENT FAILURES, and they want different sentences. Nothing painted
 * AND nothing thrown is not a broken helper: it means paintLive was never
 * reached on this screen at all, i.e. THE DOOR THIS GUARD DRIVES IS GONE and
 * the class is no longer being exercised by anything. That one is worth
 * saying out loud — 254 (the CT-148 report guard, which drives the same door
 * for its own symptom) stays GREEN through it, measured.
 */
const why = (got: { painted: string[]; threw: string }, screen: string, door: string): string => {
  if (!got.painted.length && !got.threw) {
    return `paintLive() never ran on ${screen} — nothing threw, and no live slot was touched. `
      + `The door is gone, not the guard: paintLive was reached here through ${door}. If that `
      + 'seam moved, move this drive with it — otherwise every helper below is unexercised and '
      + 'this file stops seeing.';
  }
  const dead = SLOTS[got.painted.length];
  return `${dead ? `${dead.helper}() did not return on ${screen}` : `the paint on ${screen} stopped short`}`
    + `${got.threw ? ` — ${got.threw}` : ''}. `
    + 'A bail inside setLiveSlot does not protect its ARGUMENT: the helper is evaluated first, '
    + 'on every screen, and `h.state` is null until a board arrives. Guard the helper, not the '
    + 'call site — this is CT-148 one helper further along.';
};

test('CT-161 §2 the probe can tell a paint that ran from one that did not', () => {
  // `t: 'me'` is a real message the client answers and returns from without
  // painting anything at all. If the probe reported the whole census here it
  // would report it everywhere, and §3 and §4 would be guards on nothing.
  assert.deepEqual(slotsPainted(() => { ui.push({ t: 'me', me: null }); }).painted, [],
    'the probe reported live slots for a message that paints none — it is stuck on success');
});

/* ══ §3 — the connecting screen: no state at all ═══════════════════════ */

test('CT-161 §3 every live-slot helper returns on the connecting screen, where there is no state', () => {
  assert.match(ui.html(), /Connecting to the server/,
    'the fixture is not on the connecting screen — this guard would be testing a board');

  let html = '';
  const got = slotsPainted(() => {
    // the CT-148 path, exactly: onMsg → t==='error' → flushPace() → paintLive()
    html = ui.push({ t: 'error', msg: 'No game with code ZZQX. Start a new game instead.' });
  });
  assert.deepEqual(got.painted, SLOT_IDS,
    why(got, 'the connecting screen', "flushPace(), the first line of the `t === 'error'` handler"));
  assert.match(html, /No game with code ZZQX/,
    'and the symptom the class produces: the throw eats the three statements after flushPace(), '
    + 'so the refusal never reaches the screen and the player sits on "Connecting…" forever');
});

/* ══ §4 — the waiting room: joined, and still no state ═════════════════ */

test('CT-161 §4 every live-slot helper returns in the waiting room, which is joined and stateless', () => {
  // R274 said why this screen is not a copy of §3: it is JOINED, so a helper
  // guarded on `NET.joined` instead of on `h.state` passes §3 and crashes here.
  const waiting = ui.push({
    t: 'joined', seat: SEAT, room: 'QXZZ', waiting: { have: [true, false] },
    peers: [true, false], names: ['Ann', 'Bo'],
  });
  assert.match(waiting, /Constructed/, 'the fixture is not in the waiting room');

  let html = '';
  const got = slotsPainted(() => {
    html = ui.push({ t: 'error', msg: 'that deck is not playable: 39 cards' });
  });
  assert.deepEqual(got.painted, SLOT_IDS,
    `${why(got, 'the waiting room', "flushPace(), off the `t === 'error'` handler")} And note `
    + 'WHICH question the survivors ask: `NET.joined` '
    + 'is true here and `h.state` is still null, so the guard has to be on the state, not on '
    + 'the join (R274 found that one the hard way).');
  assert.match(html, /that deck is not playable/, 'and the refusal reached the player');
});

/* ══ §5 — the other door, and why it is never the one that crashes ═════ */

test('CT-161 §5 pumpPace cannot reach paintLive before a board exists — measured, not assumed', () => {
  // CT-161's brief names pumpPace alongside flushPace, and it is a real
  // caller. But the first arrival of a session is never DELAYED — ui/pace.ts
  // starts `last` at -Infinity precisely so a lone update is not sat on — so
  // pumpPace's first pass always releases what it just queued, applyUpdate
  // sets `this.state` from the view it carried, and paintLive runs with a
  // board under it. The pre-board door is flushPace's, and it is the one §3
  // and §4 drive.
  const now = 1_000_000;
  const q = pace(emptyPace<number>(), 1, now, true);   // true = the throttle MAY hold it
  assert.equal(paceDue(q, now).out.length, 1,
    'the first arrival of a session is released at once — if this ever changes, pumpPace '
    + 'becomes a second pre-board door and needs its own drive above');
});

test('CT-161 §5 an arrival still runs every helper on its way through pumpPace', () => {
  const h = new Harness(26500);
  const got = slotsPainted(() => {
    ui.push({ t: 'update', view: viewFor(h.state, SEAT), legal: [] });
  });
  assert.deepEqual(got.painted, SLOT_IDS, why(got, 'an arrival', 'pumpPace()'));
});

/* ══ §6 — the board: the census against the markup it fills ════════════ */

test('CT-161 §6 the derived census is exactly the set of live slots the board emits', () => {
  const h = new Harness(26501);
  if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });   // 237: drain first
  ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));

  // what render() really wrote, read the way test/ui-driver.ts reads it: a
  // `liveslot` class and an id, in whatever order the attributes are written
  const emitted = [...ui.raw().matchAll(/<[a-zA-Z][^>]*>/g)]
    .map(m => m[0])
    .filter(tag => /class="[^"]*\bliveslot\b[^"]*"/.test(tag))
    .map(tag => /id="([\w-]+)"/.exec(tag)?.[1])
    .filter((id): id is string => id !== undefined);
  assert.deepEqual([...emitted].sort(), [...SLOT_IDS].sort(),
    'the board emits a live slot paintLive does not fill, or fills one it does not emit — '
    + 'either way one of the two writers of these nodes is out of step with the other');
});

test('CT-161 §6 the helpers really build markup — otherwise §3 and §4 guard three empty strings', () => {
  // NON-VACUITY. Every one of these helpers is entitled to return '' on a
  // screen with no board, and that is the whole point. So this asserts they do
  // real work SOMEWHERE: with a board on screen the presence dot is drawn, it
  // is drawn by the patcher and not by the render, and it says something.
  const html = ui.html();
  assert.match(html, /opponent connected/,
    'the presence helper produced nothing even with a board — these helpers are supposed to '
    + 'read state, which is why running them without any is a hazard at all');
  assert.doesNotMatch(ui.raw(), /opponent connected/,
    'render() drew it, so the live slot is not a live slot and paintLive is not its writer');
});
