/* R247 — the redacted "somebody owes an answer" stub, and the leak test that
 * bounds it (run: node test-pending-ask.ts). No sockets: builds the report's
 * own {Alluring} board with the engine and reads viewFor() directly, the way
 * test-view-snapshot.ts does for R85.
 *
 * ── the report ───────────────────────────────────────────────────────
 *
 * Playtest #117 (room YFUE, action 92): *"opponent's should see the same effect
 * like thing on the stack that's lightly flashing to indicate when an opponent
 * is choosing targets for a trigger (like here with the Alluring trigger). Show
 * me that Rashi is choosing that."*
 *
 * Measured first, because the obvious fix was impossible: at the instant an
 * {Alluring} target is being chosen the OTHER seat's view held `decision: null`,
 * `stack: []`, `resolving: null` and an empty legal list. The target is chosen
 * while the trigger is being PUT ON the stack, so there is no stack item to
 * flash on either screen, and viewFor nulls a decision that is not yours before
 * it reaches anybody. Nothing was being withheld by the client; it never
 * arrived. Round 31 gave the bar a heartbeat from the client side alone; NAMING
 * the effect needs this file's field.
 *
 * ── what this file is actually guarding ──────────────────────────────
 *
 * R247's line is: **THAT a choice is pending is public; WHAT is being chosen is
 * not.** A stub that leaks the options, the candidate targets, the prompt or
 * the kind of question is worse than no stub at all, so the guards below are
 * written as a LEAK TEST and not as a feature test:
 *
 *   §2 every primitive value in the stub is compared against the rest of the
 *      SAME SEAT'S OWN VIEW — "already public" is a set membership, not a list
 *      of fields somebody remembered to check;
 *   §3 the stub is proved INVARIANT under the question's content: mutate the
 *      prompt, the kind, the options, the counter cap, the numeric range, the
 *      item's label and its declared targets, and the stub must not move. A
 *      stub that read any of them would.
 *   §4 the only thing it DOES move for is the source — which is a public
 *      permanent on the receiving seat's own board;
 *   §5 a card cast out of a HAND is never named, because it has no source
 *      entity at all;
 *   §6 inside a hidden simultaneous segment there is no stub, because the
 *      opponent's half of the world is frozen there and "they are being asked
 *      about their X" is a live readout through the freeze.
 *
 * THE CLIENT HALF is guarded on the other side of the seam, where a DOM-typed
 * module can be imported: engine/test/50-ui-inspect.test.ts drives this exact
 * redacted view straight into `ui/inspect.ts waitingNote`. server/tsconfig.json
 * deliberately has no DOM lib (153-typecheck-reach asserts its flags match the
 * engine's), so `ui/` cannot be reached from here.
 */
import { Harness } from '../../engine/src/harness.ts';
import {
  giveResources, give, spawn, toDeployment, toNextBattle,
} from '../../engine/test/util.ts';
import { viewFor, type SeatView } from '../view.ts';
import type { Element, GameState, Seat } from '../../engine/src/types.ts';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

const otherSeat = (s: Seat): Seat => (s === 0 ? 1 : 0);

/**
 * Every primitive VALUE anywhere inside a structure, as a typed string.
 *
 * This is the whole measuring instrument for §2 and it deliberately knows
 * nothing about decisions, views or field names: whatever a stub carries, it
 * carries as leaves, and a leaf either appears somewhere in the seat's public
 * view or it is new information.
 *
 * ⚠ A NUMERIC KEY IS DATA; A NAMED KEY IS SCHEMA. `entities` is keyed by entity
 * id, so an id has to count as a leaf whether it appears as a key or as
 * `Entity.id` — otherwise a stub could smuggle one in as a key. A field NAME
 * ("source", "seat") tells the reader nothing about the game and is the shape
 * of the wire, not a value on it, so named keys are walked through rather than
 * collected.
 */
function leaves(v: unknown, out = new Set<string>()): Set<string> {
  if (v === null || v === undefined || typeof v !== 'object') {
    out.add(`${typeof v}:${String(v)}`);
    return out;
  }
  if (Array.isArray(v)) { for (const x of v) leaves(x, out); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^-?\d+$/.test(k)) out.add(`number:${Number(k)}`);
    leaves(x, out);
  }
  return out;
}

/** the seat's view with the stub cut out — i.e. everything it already had */
function withoutStub(v: SeatView): SeatView {
  const copy = structuredClone(v);
  delete copy.pendingAsk;
  return copy;
}

// ══ the board: report #117's own example ══════════════════════════════
//
// Tempest Wrangler is the pool's one printed {Alluring} unit. Attacking with
// it queues R84's trigger, and putting that trigger on the stack asks its
// controller to pick the enemy unit being lured — the exact question in the
// report, in the battle phase, with the allurer attacking and fully public.

interface Board { h: Harness; asker: Seat; watcher: Seat; allurer: number }

function alluringBoard(seed: number): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = otherSeat(A);
  const allurer = spawn(h, A, 'Tempest Wrangler');
  spawn(h, D, 'Bumblecrab');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[allurer]] });
  return { h, asker: h.state.decision!.seat, watcher: otherSeat(h.state.decision!.seat), allurer };
}

console.log('\n[the board is the one in the report]');
const { h, asker, watcher, allurer } = alluringBoard(4242);
const state = h.state;
ok(state.decision?.kind === 'targets', 'an {Alluring} target decision is open');
ok(state.suspension?.type === 'cast', 'raised while the trigger is being PUT ON the stack');
ok(state.stack.length === 0 && state.resolving === null,
   'so there is nothing on the stack and nothing resolving — the report measured this');
ok(state.suspension?.type === 'cast' && state.suspension.item.sourceId === allurer,
   'the item names its source entity, and that entity is the attacking allurer');

// ══ 1. the stub reaches the seat that is NOT being asked ══════════════
console.log('\n[1. the fact, and the effect it came from]');
const seen = viewFor(state, watcher, null);
const mine = viewFor(state, asker, null);
ok(mine.decision !== null, 'the asked seat still gets its whole decision');
ok(mine.pendingAsk === undefined, 'and no stub about itself');
ok(seen.decision === null && seen.suspension === null,
   'the watching seat still gets no decision and no suspension');
ok(seen.pendingAsk?.seat === asker, 'but it is told WHICH seat owes an answer');
ok(seen.pendingAsk?.source === allurer, 'and which permanent the question came from');
ok(seen.entities[allurer] !== undefined,
   'a permanent it already holds — the id is a pointer into its OWN entity map');

// ══ 2. THE LEAK TEST: nothing in the stub is new to this seat ═════════
console.log('\n[2. every value in the stub is already in this seat own view]');
const publicLeaves = leaves(withoutStub(seen));
const stubLeaves = leaves(seen.pendingAsk);
const novel = [...stubLeaves].filter(l => !publicLeaves.has(l));
ok(novel.length === 0,
   `THE LEAK: the stub introduces no value this seat did not already hold (${novel.join(', ')})`);

// the same measurement against the ASKER's view, which is where the private
// half of the question lives. Anything the asker holds and the watcher does
// not is private BY DEFINITION — and none of it may be anywhere in the
// watcher's view, stub or not.
const privateLeaves = [...leaves({ d: mine.decision, s: mine.suspension })]
  .filter(l => !publicLeaves.has(l));
const watcherLeaves = leaves(seen);
const escaped = privateLeaves.filter(l => watcherLeaves.has(l));
ok(privateLeaves.length > 0, 'the question really does carry private values to leak');
ok(escaped.length === 0,
   `none of the asker-only values reaches the watcher (${escaped.slice(0, 6).join(', ')})`);
// the report's own worst case, spelled out: the candidate list
ok(!JSON.stringify(seen).includes(state.decision!.prompt),
   'the prompt is not on the wire');
ok(!JSON.stringify(seen.pendingAsk).includes('option'),
   'and the stub is flat — no option list, no target list, no nested question');

// ══ 3. the stub does not MOVE when the question's content changes ═════
console.log('\n[3. the stub is invariant under everything about the question]');
/** rebuild the watcher's stub from a state mutated by `f` */
function stubAfter(f: (s: GameState) => void): unknown {
  const s = structuredClone(state);
  f(s);
  return viewFor(s, watcher, null).pendingAsk;
}
const base = JSON.stringify(seen.pendingAsk);
const contentEdits: { what: string; f: (s: GameState) => void }[] = [
  { what: 'the prompt', f: s => { s.decision!.prompt = 'something else entirely'; } },
  { what: 'the kind', f: s => { s.decision!.kind = 'payOrDecline'; } },
  { what: 'the options', f: s => { s.decision!.options = []; } },
  { what: 'an option label', f: s => { s.decision!.options[0]!.label = 'a secret'; } },
  { what: 'an option value', f: s => { s.decision!.options[0]!.value = { unit: 99999 }; } },
  { what: 'the counter cap', f: s => { s.decision!.counterMax = 7; } },
  { what: 'the numeric range', f: s => { s.decision!.numeric = { min: 3, max: 9, suggest: 4 }; } },
  { what: 'the decision id', f: s => { s.decision!.id = 4321; } },
  { what: "the item's label", f: s => {
    if (s.suspension?.type === 'cast') s.suspension.item.label = 'a secret label';
  } },
  { what: "the item's card name", f: s => {
    if (s.suspension?.type === 'cast') s.suspension.item.card = 'Some Other Card';
  } },
  { what: "the part's declared targets", f: s => {
    if (s.suspension?.type === 'cast') s.suspension.item.parts[0]!.targets = [{ unit: 99999 }];
  } },
];
for (const { what, f } of contentEdits) {
  ok(JSON.stringify(stubAfter(f)) === base, `${what} changes, the stub does not`);
}

// ══ 4. and it DOES move for the one thing it reports ══════════════════
console.log('\n[4. the two things it does read]');
ok(JSON.stringify(stubAfter(s => { s.decision!.seat = watcher; })) !== base,
   'a decision that becomes the watcher own is not stubbed to them at all');
ok(stubAfter(s => { if (s.suspension?.type === 'cast') delete s.suspension.item.sourceId; })
   !== undefined, 'with no source the fact is still published');
ok((stubAfter(s => {
  if (s.suspension?.type === 'cast') delete s.suspension.item.sourceId;
}) as { source?: number }).source === undefined, 'but nothing is named');
// a source that is NOT on the watcher's board is not named either — the
// lookup is against the redacted map, so this is a property of the redaction
// rather than a claim about which sources happen to be public
ok((stubAfter(s => {
  if (s.suspension?.type === 'cast') s.suspension.item.sourceId = 99999;
}) as { source?: number }).source === undefined,
   'a source the watcher does not hold is dropped rather than announced');

// ══ 5. a card cast out of a HAND is never named ═══════════════════════
console.log('\n[5. a spell nobody can see yet stays invisible]');
{
  const b = alluringBoard(4243);
  const g = b.h;
  g.do({ type: 'decide', seat: g.state.decision!.seat, choice: 0 });   // clear the lure ask
  const caster = g.state.priority!;
  for (const el of g.state.elements) giveResources(g, caster, el as Element, 4);
  for (const el of ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as Element[]) {
    giveResources(g, caster, el, 4);
  }
  const idx = give(g, caster, 'Invigorate');   // "Target unit gains +0/+1…"
  g.do({ type: 'playCard', seat: caster, handIndex: idx });
  const susp = g.state.suspension;
  ok(susp?.type === 'cast' && susp.item.kind === 'spell',
     'a spell is mid-cast and its target is being chosen');
  ok(susp?.type === 'cast' && susp.item.sourceId === undefined,
     'a hand-cast card has no source ENTITY — that is the whole gate');
  const opp = viewFor(g.state, otherSeat(caster), null);
  ok(opp.pendingAsk?.seat === caster, 'the opponent is still told a choice is pending');
  ok(opp.pendingAsk?.source === undefined, 'and is told nothing about what it is');
  ok(!JSON.stringify(opp).includes('Invigorate'),
     'THE LEAK: the card name never reaches the other seat');
}

// ══ 6. inside a hidden simultaneous segment there is no stub ══════════
console.log('\n[6. the freeze wins — same board, one variable changed]');
{
  // `frozenOpp` is non-null exactly inside a hidden segment (rooms.ts
  // segSnapshot), and it is the SAME gate R144 uses for the stack. Passing the
  // board's own snapshot is the controlled comparison: identical state, one
  // argument different.
  const frozen = viewFor(state, watcher, structuredClone(state));
  ok(frozen.pendingAsk === undefined,
     'no stub is published while the opponent half of the world is served frozen');
  ok(viewFor(state, watcher, null).pendingAsk !== undefined,
     'and the same state outside a segment does publish one — the gate is frozenOpp alone');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
