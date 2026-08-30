/**
 * THE CARD TODO — one tickable list of everything known to be wrong with the
 * cards, in one place, with the evidence that found it.
 *
 * WHY THIS EXISTS
 *
 * The owner, 2026-08-23, commissioning the sweep this file came out of:
 *
 *   "I would like for you to work through every single card in the digital
 *    client game and design AT LEAST one test for it … This full testing suite
 *    should reveal more cards and effects that aren't functional. Don't fix
 *    them quite yet, focus on capturing all the issues (including unanswered
 *    user reports) in a todo repository that can be ticked off as issues get
 *    addressed and fixed."
 *
 * So this is the capture, not the fix. Nothing in this file changes engine
 * behaviour.
 *
 * WHAT IS AND IS NOT IN HERE
 *
 * This is an INDEX of open work, and it deliberately does not restate what
 * another ledger already owns:
 *
 *   · `card-ledger.ts`     — the 28 cards with a printed clause that does
 *                            nothing. Referenced by CT-8, not copied.
 *   · `playtest-ledger.ts` — every owner bug report, one row each (the tally
 *                            line in 83-card-todo.test.ts reads the ledger
 *                            LIVE — a count typed here would only rot). Any
 *                            report still `live` there is carried here as its
 *                            own CT entry (CT-10..CT-14 were that batch), so
 *                            "unanswered user reports" and "cards found
 *                            broken by testing" live in ONE list, which is
 *                            what was asked for.
 *
 * THE RULE THAT KEEPS IT HONEST
 *
 * Every open entry carries a `proof` — a predicate that returns TRUE while the
 * bug is still there. `83-card-todo.test.ts` asserts every open item's proof
 * still holds, so the moment somebody fixes one, the suite FAILS and names the
 * item to tick off. That is the opposite of a `{ todo: true }` test, which can
 * never fail and is exactly how Harbinger of Immolation stayed dead through two
 * playtest reports and a conceded game (see the head of card-ledger.ts).
 *
 * An entry with no machine-checkable proof sets `proof: null` and MUST say in
 * `verify` how a human checks it. Those are the entries most likely to rot, so
 * the test counts them out loud.
 */

export type TodoArea =
  /** a specific card does not do what it prints */
  | 'card'
  /** an attribute is not honoured everywhere it should be */
  | 'attribute'
  /** an engine-wide seam is missing, and cards are parked on it */
  | 'engine'
  /** the UI, not the rules */
  | 'client'
  /** the tests themselves do not cover something they claim to */
  | 'coverage';

export type TodoSeverity =
  /** silently produces a WRONG game outcome, or makes a card unusable */
  | 'blocker'
  /** the card works but misreports, or a whole mechanic is absent */
  | 'major'
  /** cosmetic, or an edge case a real game is unlikely to reach */
  | 'minor';

export interface TodoEntry {
  /** stable id — cite it in commits and in code comments ("CARD-TODO #3") */
  id: number;
  area: TodoArea;
  severity: TodoSeverity;
  /** the card(s) this is about, if it is card-specific */
  cards?: string[];
  title: string;
  /** what is actually wrong, with the printed clause quoted where relevant */
  detail: string;
  /** how it was found — a drill scenario, a probe, a report id, a ruling */
  evidence: string;
  /** what a fix has to do, concretely enough to start from */
  fix: string;
  /** true WHILE the bug is present. Null when nothing can check it. */
  proof: null | (() => boolean);
  /** required when proof is null: how a human confirms it by hand */
  verify?: string;
  /** for an item that came from an owner bug report: its id in
   *  playtest-ledger.ts / playtest-issues.snapshot.jsonl */
  reportId?: number;
  /**
   * The test(s) that keep this fixed, each `file::substring-of-the-test-name`.
   * REQUIRED once `status` is 'done', and the substring must appear in a real
   * `test('...')` title in that file — 83-card-todo.test.ts checks both.
   *
   * This is the same rule `playtest-ledger.ts` runs on, for the same reason:
   * a fix with nothing that can fail when it regresses is not a fix, it is a
   * commit message. A `{ todo: true }` test does NOT qualify — it can never
   * fail, which is exactly how Harbinger of Immolation looked tracked for two
   * days while the card was completely dead.
   */
  guards?: string[];
  /**
   * What actually closed it, written at the time. Distinct from `fix`, which is
   * the plan BEFORE the work: this is the account afterwards, including the
   * places the plan turned out to be wrong. Optional, and only meaningful on a
   * `done` entry — the entries whose briefs were corrected by the agent doing
   * the work are the ones worth reading later, and a plan that was never
   * revisited is exactly how a "fixed" item stops describing reality.
   */
  closed?: string;
  /**
   * For a long-lived entry that is being worked down rather than finished in
   * one go: what the last round actually established, including where THIS
   * entry's own plan turned out to be wrong. CT-49's "activated abilities are
   * the cheap third" was off by a factor of four, and an entry that cannot
   * record that keeps sending the next round down the same path.
   */
  progress?: string;
  /**
   * `open` — still broken. `done` — fixed, and `guards` names what keeps it so.
   *
   * `wontfix` — THE OWNER DECIDED IT SHOULD NOT BE BUILT. Added 2026-08-29 for
   * CT-106, which had nowhere honest to go: there is no fix and therefore no
   * guard, so `done` is a lie the guard requirement correctly refuses; but
   * leaving it `open` means this queue reports work that nobody intends to do,
   * and a list that overstates what is left is the same dishonesty in the other
   * direction. `playtest-ledger.ts` has carried exactly this third state from
   * the beginning, for exactly this reason. A `wontfix` MUST carry `closed`
   * saying who decided and why — that is enforced below.
   */
  status: 'open' | 'done' | 'wontfix';
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import './../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { spawn, toDeployment } from './util.ts';
import type { Seat } from '../src/types.ts';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ENGINE_SRC = fs.readFileSync(path.join(SRC_DIR, 'engine.ts'), 'utf8');
/** a card-batch file's source, comments and strings stripped (R148) */
const setSrc = (file: string): string =>
  stripCode(fs.readFileSync(path.join(SRC_DIR, 'cards', 'sets', file), 'utf8'));

/**
 * TypeScript source with block comments, line comments and string literals
 * removed, in that order. THE one place this repo strips code for reading, and
 * it exists because both halves have burned it inside a single day:
 *
 *  · `JSON.stringify` on a card definition DROPS FUNCTIONS, so a check that
 *    reads card behaviour that way silently answers "clean" (CARD-TODO #27's
 *    first draft).
 *  · `Function.prototype.toString()` KEEPS comments and strings, so a comment
 *    that merely MENTIONS the bad idiom — very often the comment explaining
 *    that the card no longer does it — holds the check true (R140's three
 *    fixed cards).
 *
 * Strings go last so a `'` inside a comment ("a unit's mods") is already gone
 * and cannot open a string that swallows the rest of the file. The one known
 * limit is the mirror of that: a `//` INSIDE a string literal would eat the
 * rest of its line. Nothing in src/ does that, and the cost of the miss is one
 * unread line, never a false alarm.
 *
 * Exported (R148) because the sweeps in 90-coverage-census read whole FILES
 * this way, and a second copy of these three regexes is a second thing to get
 * wrong.
 */
let reClass = false;   // open character class inside a regex literal

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Does the `/` at this point open a REGEX LITERAL, or is it division?
 *
 * The classic JS ambiguity, and the whole reason the old three-regex stripper
 * was unsound. A `/` starts a regex when what precedes it cannot END an
 * expression: an operator, an opening bracket, a comma, a semicolon — or one
 * of the keywords that takes an expression next. It is DIVISION when it
 * follows an identifier, a number, `)`, `]` or a closing quote.
 *
 * A misjudgement here is no longer catastrophic in either direction, because
 * the scanner is line-preserving and re-synchronises at the next newline: the
 * worst case is one mis-blanked span, not a file-long desync.
 */
function startsRegex(prev: string, out: string): boolean {
  if (prev === '') return true;
  if ('([{,;:=!&|?+-*%~^<>'.includes(prev)) return true;
  if (/[)\]}\w$]/.test(prev)) {
    const w = /([A-Za-z_$][\w$]*)\s*$/.exec(out);
    return !!w && KEYWORDS_BEFORE_REGEX.has(w[1]!);
  }
  return true;
}

export function stripCode(src: string): string {
  let out = '';
  let st: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 're' = 'code';
  let prev = '';   // last significant code char, for the regex/division call
  reClass = false;
  // R201 / CT-68: `${ … }` INSIDE A TEMPLATE LITERAL IS CODE, NOT STRING, and
  // this is the THIRD time this one function has been caught blind.
  //
  // Without the stack below, a NESTED template inverts parity: the inner
  // opening backtick reads as the OUTER one's closing tick, so the code before
  // it is swallowed as string and the inner string body comes back as CODE.
  //
  //     stripCode('const a = `x ${ f(`y`) } z`;')  ->  'const a =          y       ;'
  //
  // `f(` gone, `y` promoted to code. Measured across engine/: src/engine.ts has
  // 12 nested templates and leaks those 10 lines; ui/main.ts has 108, leaking
  // 368 lines and BLANKING 911 lines of real code — which is why 147's helper
  // sweep had to exclude ui/ to stay honest.
  //
  // The cost was not theoretical. A real `z.bin.push(1)` planted inside a
  // nested template in src/rng.ts left all nine tests of 90-coverage-census
  // GREEN — a live bypass of the R124/R145 bin choke point, invisible to every
  // sweep that rests on this helper. 164-sweep-sight.test.ts §C runs an
  // INDEPENDENT oracle beside this function over all of src/ and reports only
  // the disagreements, because a checker cannot audit itself: measuring
  // stripCode's blind spots with stripCode is exactly the move that let the
  // first two live for weeks.
  //
  // `braceDepth` counts `{` in code; `tplStack` remembers the depth at which
  // each interpolation opened, so the matching `}` — and only that one — hands
  // control back to the template.
  let braceDepth = 0;
  const tplStack: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!, n = src[i + 1];
    if (st !== 'code') {
      // BLANK, never delete: line and column must survive, because callers
      // report `file:${n + 1}` from the stripped text.
      // RESYNC AT END OF LINE. Only a block comment and a template literal may
      // legally span a newline in JS/TS; a line comment, a quoted string and a
      // regex literal may not. Ending those states here is what makes a
      // misjudged `/` cost one line instead of the rest of the file — the
      // failure that silently deleted 5128 of engine.ts's 8901 lines and blinded
      // every sweep built on this helper.
      if (c === '\n') {
        out += '\n';
        if (st === 'line' || st === 'sq' || st === 'dq' || st === 're') st = 'code';
        continue;
      }
      out += ' ';
      if (st === 'block') { if (c === '*' && n === '/') { out += ' '; i++; st = 'code'; } }
      else if (st === 'sq') { if (c === '\\') { out += ' '; i++; } else if (c === "'") st = 'code'; }
      else if (st === 'dq') { if (c === '\\') { out += ' '; i++; } else if (c === '"') st = 'code'; }
      else if (st === 'tpl') {
        if (c === '\\') { out += ' '; i++; }
        else if (c === '`') st = 'code';
        else if (c === '$' && n === '{') { out += ' '; i++; tplStack.push(braceDepth); braceDepth++; st = 'code'; }
      }
      // A LINE COMMENT ENDS AT THE NEWLINE AND AT NOTHING ELSE. It needs its
      // own branch — without one it fell through to the regex arm below, where
      // an unescaped `/` outside a character class does `st = 'code'`, so the
      // comment ENDED AT ITS FIRST SLASH and its tail was handed back as code.
      // `+1/+1`, `ll/2`, `and/or` and every file path make that near-universal:
      // 927 line-comment lines across the 28 batch files leaked, plus 86 in
      // engine.ts. Worse, a leaked backtick opened a TEMPLATE-LITERAL state,
      // which may legally span newlines, so the desync then swallowed real
      // code — ten `card()` definitions vanished from the stripped view of
      // batch-hybrids-ld-c.ts and batch-light-a.ts, and every sweep resting on
      // this helper was reading English as TypeScript.
      //
      // This is the SECOND time this one function has gone blind (the first was
      // the regex-literal hole that deleted 5128 of engine.ts's 8901 lines).
      // Both times it was found the same way — an agent saying "my sweep says
      // clean and I don't believe it" — and never by the sweeps themselves.
      // 149-strip-code.test.ts measures it directly now.
      else if (st === 'line') { /* consumed above; only a newline leaves this state */ }
      else {
        if (c === '\\') { out += ' '; i++; }
        else if (c === '[') reClass = true;
        else if (c === ']') reClass = false;
        else if (c === '/' && !reClass) st = 'code';
      }
      continue;
    }
    if (c === '/' && n === '*') { out += '  '; i++; st = 'block'; continue; }
    if (c === '/' && n === '/') { out += '  '; i++; st = 'line'; continue; }
    if (c === "'") { out += ' '; st = 'sq'; continue; }
    if (c === '"') { out += ' '; st = 'dq'; continue; }
    if (c === '`') { out += ' '; st = 'tpl'; continue; }
    // R201: track brace depth so an interpolation's CLOSING `}` — and no other
    // `}` — returns to the template it opened inside.
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (tplStack.length && braceDepth === tplStack[tplStack.length - 1]) {
        tplStack.pop(); out += ' '; st = 'tpl'; continue;
      }
    }
    if (c === '/' && startsRegex(prev, out)) { out += ' '; reClass = false; st = 're'; continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

/** the source of a card's spell effect, comments and strings stripped */
function runSrc(card: string): string {
  const f = getCard(card).spellEffect?.run;
  return stripCode(f ? f.toString() : '');
}

/** a two-unit board; returns the engine, the seats and the spawned ids */
function board(seed: number, mine: string, theirs?: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const a = spawn(h, A, mine);
  const d = theirs ? spawn(h, D, theirs) : undefined;
  return { h, A, D, a, d };
}

/** run one card's spell effect against chosen targets and count what it SAID */
function eventsFrom(
  card: string, seed: number, build: (g: E, A: Seat, D: Seat) => { targets: unknown[]; x?: number },
): number {
  const { h, A, D } = board(seed, 'Tidal Menace', 'The Foretold');
  const g = new E(h.state);
  const { targets, x } = build(g, A, D);
  const before = g.events.length;
  const def = getCard(card).spellEffect!;
  try {
    def.run(g, {
      controller: A, sourceName: card, region: g.homeRegion(A),
      targets: targets as never, x, event: null,
      choose: () => { throw new Error('choice'); },
    } as never);
  } catch { return -1; }        // suspended or threw: not a completed silent run
  return g.events.length - before;
}

export const CARD_TODO: TodoEntry[] = [
  // ── found by the whole-pool card drill (81-card-drill.test.ts) ─────────
  {
    id: 1,
    area: 'card',
    severity: 'blocker',
    cards: ['Abduct'],
    title: 'Abduct resolves in complete silence when it targets one of your own units',
    detail:
      'Printed: "Gain control of target unit with cost [x] or less unless its controller '
      + 'pays [x]." The target spec is `what: \'unit\'`, which offers BOTH sides, so '
      + 'pointing it at your own unit is a legal, offered play. The run then hits '
      + '`if (u.controller === ctx.controller) return;   // already yours` — no event, no '
      + 'log line. The spell leaves the stack, the mana and the X are spent, and the '
      + 'player has no way to tell a rule from a bug. There is a second silent return '
      + 'above it (`if (!isEnt(t)) return;`).',
    evidence:
      'The card drill, "lonely" board state (only the caster has units) — the scenario '
      + 'that exists specifically to push targeted cards down their own-unit branch. The '
      + 'fuzz-driven pass in 65-effect-conformance never cast Abduct at all, which is why '
      + 'its identical assertion never fired.',
    fix:
      "Announce it: g.ev('info', `Abduct: ${u.card} is already yours — nothing happens.`). "
      + 'Then answer the SEPARATE question of whether "gain control of target unit" should '
      + 'be offering allied units at all (R64 has the ownership kinds for it — '
      + "`what: 'enemyUnit'`, or a `restrict` — but changing the legal target set is a "
      + 'rules call, not a logging fix, so it needs the owner.)',
    proof: () => eventsFrom('Abduct', 8101, (g, A) => ({
      targets: [g.unitsOf(A, g.homeRegion(A))[0]!], x: 9,
    })) === 0,
    // FIXED 2026-08-23. Both silent branches announce now — the own-unit one
    // named in this entry AND the ransom-PAID one, which was silent too and is
    // the branch a player is most likely to hit. The target spec is deliberately
    // UNCHANGED: whether "gain control of target unit" should offer allied units
    // at all is a rules call the owner has not made, and this was a logging bug.
    guards: [
      '85-silent-branches.test.ts::Abduct aimed at your own unit announces',
      '85-silent-branches.test.ts::Abduct whose ransom',
      '85-silent-branches.test.ts::Abduct whose ransom is declined still takes the unit',
    ],
    status: 'done',
  },
  {
    id: 2,
    area: 'card',
    severity: 'major',
    cards: ['Divine Intervention'],
    title: 'Divine Intervention says nothing on the path where it actually works',
    detail:
      'Printed: "You may change the targets of target effect." The DECLINE branch logs '
      + '("…\'s targets are left alone"), but the branch that succeeds — the one that '
      + 'rewrites `item.parts[pi].targets[ti]` — emits no event at all. So the visible '
      + 'behaviour is backwards: choosing to do nothing is announced, and choosing to '
      + 'redirect an opposing spell is invisible. Two bare guard returns above it are '
      + 'silent as well.',
    evidence:
      'Card drill, "bait" board state. Compare Gravitational Correction, which does the '
      + 'same job and logs "Player 1 changes 1 of Protective Adaptations\'s targets."',
    fix:
      'Emit a line naming the effect and how many of its targets moved, matching '
      + "Gravitational Correction's wording so the two read the same in the log.",
    proof: () => {
      const s = runSrc('Divine Intervention');
      const tail = s.slice(s.indexOf('picks.push'));
      return tail.length > 0 && !tail.includes('g.ev(');
    },
    // FIXED 2026-08-23. The success branch now emits the same line Gravitational
    // Correction does, carrying the same `{ item, n }` data payload — so the two
    // cards that do the same job read the same in the log, and a test asserts
    // that rather than trusting it. ⚠ Gravitational Correction itself needed NO
    // fix: this entry's evidence implied its guards were silent, and they are
    // not — all three of its bare returns are inside forEach callbacks whose
    // caller already announces the aggregate.
    guards: [
      "85-silent-branches.test.ts::Divine Intervention that changes an effect",
      '85-silent-branches.test.ts::Divine Intervention and Gravitational Correction report a retarget the same way',
      '85-silent-branches.test.ts::Divine Intervention driven through a real game',
    ],
    status: 'done',
  },
  {
    id: 3,
    area: 'card',
    severity: 'major',
    cards: ['Immolate'],
    title: 'Immolate resolves in silence when its [Sacrifice a unit] cost is declined',
    detail:
      'Printed: "[Switch1] /[Sacrifice a unit]: Draw a card." The run opens '
      + '`if (!ctx.costPaid?.sacrificed) return;` with no announcement. That path is '
      + 'reachable both as an ordinary cast and — more often — as the bounded graft '
      + 'rider, where the rider\'s cost is declined at cast time and the composite then '
      + 'resolves a part that does nothing and says nothing.',
    evidence:
      'Card drill — Immolate resolved silently in ALL THREE board states, the only card '
      + 'in the pool to do so outside the two already known.',
    fix:
      "g.ev('info', 'Immolate: no unit was sacrificed — no card is drawn.') on that branch.",
    proof: () => eventsFrom('Immolate', 8103, () => ({ targets: [] })) === 0,
    // FIXED 2026-08-23, and WIDER than the card. The identical
    // `if (!ctx.costPaid?.sacrificed) return;` shape was silent on Sacrificial
    // Burst and Linked Extinction too, and Structural Collapse's `bar <= 0` is
    // the same bug with different arithmetic. All four announce now, and because
    // each is a shared `EffectDef` the graft rider — the path this entry says is
    // hit MORE often than the ordinary cast — is covered by the same fix.
    // In total the sweep this entry started closed 46 silent branches on 39
    // cards; see the head of 85-silent-branches.test.ts for the taxonomy.
    guards: [
      '85-silent-branches.test.ts::Immolate resolved as a graft rider with its cost unpaid',
    ],
    status: 'done',
  },

  // ── the owner's own attribute example ─────────────────────────────────
  {
    id: 4,
    area: 'attribute',
    severity: 'major',
    title: '{Piercing} does nothing on non-combat damage',
    detail:
      'The owner\'s second example, verbatim: "piercing is done even when its on a '
      + 'non-combat effect". It is not. `dealEffectDamageAll` — the batch EVERY '
      + 'non-combat damage source goes through — reads Deadly, Powerful, Poisonous, '
      + 'Resonant, Blessed, Reaping and Electric, and never mentions Piercing. A '
      + '{Piercing} source that deals 5 to a 1/1 kills it and the other 4 vanish; the '
      + 'result is byte-identical to a source with no attribute at all. This also makes '
      + 'a virus-donated {Piercing} a dead donation, which contradicts the ruling that '
      + 'authorises the donation in the first place: "you can only do this with '
      + 'attributes — mostly Deadly, Piercing, and Powerful are impacted by this" '
      + '(Caleb 2025-03-06, quoted at R79).',
    evidence:
      'Measured directly: Ruinbringer (8/9 {Piercing}) dealing 5 effect damage to a 7/2 '
      + 'left both life totals at 30, exactly as a vanilla 3/3 did. Also already written '
      + 'down in docs/digital-rules.md under R79 "⚠ Not in scope": "Piercing is a '
      + 'combat-overflow rule in this engine and dealEffectDamage has no overflow to '
      + 'pierce. The attribute now reaches the effect; nothing reads it there yet."',
    fix:
      'RULED, 2026-08-23 — the owner settled it and no further question is open: '
      + '"It redirects excess damage to that unit\'s controller (not as a trigger, just '
      + 'as part of resolution of the damage)." That matches the rulebook\'s combat '
      + 'wording (Rulebook 2023-07: "Excess damage beyond the health of the back row '
      + 'unit does not carry over to the player, unless the damage comes from a unit '
      + 'with the Piercing attribute"), generalised off the column. '
      + 'So: in `dealEffectDamageAll`, when the source has {Piercing}, the amount beyond '
      + 'what was needed to kill the recipient goes to THAT UNIT\'S controller, inside '
      + 'the same damage resolution — not as a separate event and not as a trigger. '
      + 'Excess is computed after {Powerful} doubling and after the receive-side '
      + '{Vulnerable} doubling, on the same lethal arithmetic the combat path uses.',
    proof: () => {
      const from = ENGINE_SRC.indexOf('  dealEffectDamageAll(');
      const rest = ENGINE_SRC.slice(from + 10);
      const next = rest.search(/\n  [a-zA-Z_$][\w$]*\(/);
      return from > 0 && !(next > 0 ? rest.slice(0, next) : rest).includes("'Piercing'");
    },
    // FIXED 2026-08-23. `dealEffectDamageAll` now plans the excess in the same
    // batch as an ordinary player recipient, so it is one resolution with one
    // R80 `total` and nothing reaches the stack in between — which is what "not
    // as a trigger, just as part of resolution" required. The lethal arithmetic
    // moved into a single `poolToKill` closure shared with {Electric} and
    // shaped on `combatSubStep`'s `assign`, so the combat and non-combat paths
    // can no longer drift.
    guards: [
      '82-attr-interactions.test.ts::Piercing: 5 effect damage to a 1/1',
      '82-attr-interactions.test.ts::Piercing: exactly lethal pierces nothing',
      '82-attr-interactions.test.ts::Piercing + Powerful',
      '82-attr-interactions.test.ts::Piercing vs a Vulnerable victim',
      '82-attr-interactions.test.ts::Piercing vs a damage-shielded unit',
      '82-attr-interactions.test.ts::Piercing + Deadly',
      '82-attr-interactions.test.ts::Piercing DONATED by a virus',
      '82-attr-interactions.test.ts::Piercing in a BATCH',
    ],
    status: 'done',
  },
  {
    id: 5,
    area: 'attribute',
    severity: 'major',
    cards: ['Bubb', 'Haboob', 'Trashling'],
    title: '{Unaware} is not implemented anywhere in the engine',
    detail:
      'Three cards print {Unaware} and the engine contains not a single reference to the '
      + 'string. R10 settled what it means ("everything counts as interacting") and stat '
      + 'layer 6 was reserved for it; the layer was never built. The three cards are '
      + 'therefore plain vanilla bodies in play.',
    evidence:
      'A grep of every attribute name against engine.ts + apply.ts: {Unaware} is the only '
      + 'one of the 25 attributes in the pool with ZERO references. The engine still '
      + 'carries the "layer 6 (Unaware) goes here" placeholder that card-ledger.ts keys '
      + 'its Bubb / Haboob / Trashling entries to.',
    fix:
      'RULED 2026-08-23. ⚠ THE FIRST RECORD OF THIS RULING HERE WAS WRONG, and the error '
      + 'was in how the question was ASKED, not in how it was answered — the owner was '
      + 'offered a multiple choice whose "blanket" option described only half his position, '
      + 'and a first implementation shipped on it. His operational statement, which governs: '
      + '"Unaware means that it looks ONLY at what is the literal printed text on all cards '
      + "'involved' (self or others when dealing damage or in combat when dealing/receiving). "
      + 'So Bubb blocking a Robot token would kill it (do Bubb, it has 0 power and 0 '
      + 'defense), no matter how many +1/+1 counters it has. Bubb would also survive 100 '
      + '-1/-1 counters just fine. Haboob kills anything that has 1 defense printed at the '
      + 'card level." '
      + 'So TWO things, and the first implementation had one of them: '
      + '(a) an {Unaware} card reads its OWN stats as PRINTED — layer 1 only, so a base '
      + 'REWRITE is ignored too ("literal printed text on the card"), which is what makes '
      + '"survives 100 -1/-1 counters" true right through the state-based death check; and '
      + '(b) in an interaction involving an {Unaware} card, EVERY card involved reads at '
      + 'printed. The pairwise mechanism the first pass was explicitly told not to build is '
      + 'the correct one. Scope is the owner\u2019s: dealing/receiving damage, and combat. '
      + 'This is ALSO Caleb\u2019s reading — "any Unaware units (or Spells like Haboob) will '
      + 'only look at BASE STAT PRINTED on cards" — so the "we diverge from the designer" '
      + 'note the first pass wrote was an artefact of the bad question and is gone. '
      + '⚠ OPEN EDGE, named rather than silently decided: R10 lists TARGETING as an '
      + 'interaction and the operational statement does not. Targeting is not collapsed; '
      + 'extending it would touch ~33 card-side effStats calls and needs its own ruling. '
      + 'THE LESSON, which is the reusable part: a ruling compressed into multiple choice '
      + 'is a ruling you have paraphrased. Quote the owner and let him write the sentence.',
    proof: () => !ENGINE_SRC.includes("'Unaware'"),
    // FIXED 2026-08-23, on the SECOND attempt. Two halves:
    //  · SELF — `effStats` ends `if (statAttrs.includes('Unaware')) return
    //    this.printedStats(e);`, layer 1 alone, so layers 2-5 (base rewrites
    //    included) are all ignored. Verified: Bubb is 5/6 through +5 counters,
    //    through 100 -1/-1 counters, and through a base rewrite to 4/4.
    //  · PAIRWISE — `interactionStats(u, involved)` collapses EVERY
    //    participant to printed when any of them is Unaware, wired at the three
    //    sites the owner named: the combat sub-step's column exchange,
    //    `dealEffectDamageAll`, and the shared `fight` helper. Verified: a Unit
    //    Token carrying +6 counters reads 7/7 alone and 1/1 in an exchange with
    //    Bubb.
    // A collapsed exchange needs its own death sweep, because `checkDeaths`
    // reads `effStats`: a Robot 20 read as printed 0/0 is assigned no damage at
    // all, so nothing would kill it. `sweepCollapsedDeaths` runs over the
    // exchange's participants and never globally — outside an interaction a
    // Robot 20 is a 20/20 and stays one.
    // The collapse survives {Pure} on purpose: R61 switches off the ATTRIBUTE
    // layer for an exchange, and this is a STAT layer.
    guards: [
      '92-unaware.test.ts::Bubb blocking a Robot token would kill it',
      '92-unaware.test.ts::Bubb would also survive 100 -1/-1 counters just fine',
      '92-unaware.test.ts::Haboob kills anything that has 1 defense printed at the card level',
      '92-unaware.test.ts::a +1/+1 counter on Bubb leaves it a 5/6',
      '92-unaware.test.ts::NEGATIVE CONTROL',
      '05-rulings.test.ts::R10',
    ],
    status: 'done',
  },

  // ── targeting legality, found by the drill ────────────────────────────
  {
    id: 6,
    area: 'card',
    severity: 'minor',
    cards: ['Organic Exchange'],
    title: 'Organic Exchange can be aimed at two of your own units, making it a no-op',
    detail:
      'Printed: "Exchange control of two target units and swap their positions." The '
      + "target spec is `what: 'unit', count: 2, min: 2` with no restriction that the two "
      + 'are controlled by different players. Aimed at two of your own, the two controller '
      + 'assignments cancel out and the log read "Player 1 takes Tidal Menace, Player 1 '
      + 'takes The Foretold — positions swapped", naming the same player twice. The '
      + 'position swap does still happen, so it was never entirely inert.',
    evidence: 'Card drill, "lonely" board state.',
    fix:
      'RULED 2026-08-23 — the play stays LEGAL and no `restrict` is added. Swapping the '
      + 'positions of two of your own units is a real line, the printed text does not '
      + 'forbid it, and narrowing the target set would take a legal play away to fix a '
      + 'sentence. So this was a LOG bug: when both targets already share a controller '
      + 'the line now says the positions swap and control does not change, instead of '
      + 'naming the same player twice as taker. '
      + '⚠ NOTE FOR WHOEVER RE-OPENS THIS: the original proof below asserted '
      + '`what === "unit" && !restrict`, which is precisely the state the ruling says to '
      + 'PRESERVE — it could never have gone false, so the item would have reported open '
      + 'forever. It is re-proofed against the defect that was actually there.',
    // The old shape, measured: aimed at two units under one controller, the log
    // line named that controller TWICE ("Player 1 takes A, Player 1 takes B").
    // The fixed card emits a different line for that case, so the name appears
    // once. Deliberately a shape-detector for the OLD code rather than an
    // assertion about the new wording — the new behaviour is pinned
    // structurally by the guards below, which compare the two cases without
    // fixing either sentence.
    proof: () => {
      const { h, A, a, d } = board(8106, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      // both targets under ONE controller: take the enemy unit first so the
      // board matches the reported situation without changing the card
      const mine = g.entity(a as never)!, theirs = g.entity(d as never)!;
      theirs.controller = A;
      const before = g.events.length;
      getCard('Organic Exchange').spellEffect!.run(g, {
        controller: A, sourceName: 'Organic Exchange', region: g.homeRegion(A),
        targets: [mine, theirs], event: null,
        choose: () => { throw new Error('choice'); },
      } as never);
      const said = g.events.slice(before).map(e => e.msg ?? '').join(' ');
      const name = g.pname(A);
      return said.split(name).length - 1 >= 2;
    },
    guards: [
      '85-silent-branches.test.ts::Organic Exchange aimed at two of your own units is still a legal, offered play',
      '85-silent-branches.test.ts::Organic Exchange announces a same-controller swap differently from a real exchange',
      '85-silent-branches.test.ts::Organic Exchange across the table still exchanges control',
    ],
    status: 'done',
  },

  // ── coverage: the reason these went unnoticed for so long ─────────────
  {
    id: 7,
    area: 'coverage',
    severity: 'major',
    title: 'The fuzz-driven conformance pass never reaches a third of the pool',
    detail:
      '65-effect-conformance carries the right assertions (no undeclared token, no silent '
      + 'resolution) but drives them with 140 fuzz games, and a random walk does not cast '
      + 'the whole box. Measured 2026-08-23: 143 of the 424 cards with effects were never '
      + 'driven once. Its own reach floor (`attempted >= 260` of 449 EffectDefs) is '
      + 'satisfied the whole time, so nothing reports the blind spot. All three silent '
      + 'cards above sat inside it.',
    evidence:
      'A probe that wrapped every EffectDef.run and ran exactly the seeds that file uses.',
    fix:
      'DECIDED 2026-08-23: the fuzz drive is NOT widened, and that is the answer rather '
      + 'than a deferral. A random walk is the wrong tool for coverage by construction — '
      + '81-card-drill.test.ts is the primary net now, playing every card through the real '
      + 'action path in three board states, deterministically, with no exemptions left in '
      + 'its silence sweep. 65 keeps the two guarantees the drill CANNOT make: it reaches '
      + 'abilities, graft compositions, donated [Augment] text and granted text (R63) that '
      + 'a "put it in hand and cast it" driver never touches. '
      + 'What was actually wrong here was not the reach, it was that the reach was '
      + 'INVISIBLE: 65\'s floor counted EffectDefs, and one shared helper def can be owned '
      + 'by a dozen cards, so a third of the pool went uncast while the floor looked '
      + 'healthy. 65 now states its reach in CARDS too and prints it on every run.',
    proof: null,
    verify:
      'node --test test/65-effect-conformance.test.ts prints "fuzz reach: N/M cards with '
      + 'effects were driven at least once — K never cast here" on every run. It was 281 of '
      + '417 (136 never cast) when this closed, and the floor is absolute so adding cards '
      + 'cannot dilute it.',
    guards: [
      '65-effect-conformance.test.ts::the drive states its reach in CARDS, not only in EffectDefs',
      '65-effect-conformance.test.ts::the drive actually covers the pool',
      '81-card-drill.test.ts::the drill plays every card in the pool, in three board states',
      '81-card-drill.test.ts::the drill reports honestly on its own reach',
    ],
    status: 'done',
  },
  {
    id: 8,
    area: 'coverage',
    severity: 'major',
    title: 'Cards with a printed clause that does nothing — see card-ledger.ts',
    detail:
      'Not restated here on purpose. card-ledger.ts is the authority, each entry quoting '
      + 'the printed clause and naming the primitive it is parked on. It was 28 entries on '
      + '2026-08-23 and is 23 now; the tally line in 83-card-todo.test.ts reads the ledger '
      + 'LIVE rather than repeating a number, because a count in a comment is a claim about '
      + 'the repo on the day it was typed. This entry exists so a reader of the todo list '
      + 'cannot miss that the list of broken cards is longer than the items above. '
      + 'THE USEFUL FINDING, 2026-08-23: the ledger is not 28 independent problems. Twelve '
      + 'of its entries were parked on FOUR engine seams, and building those four closed '
      + 'them together — Oorblak on Piercing excess (R103), Suspend / Nullbringer / Conduit '
      + 'of Pain / Counter Thief / Cosmic Conspirator / Automaton of Abundance on the '
      + 'replacement layer (R104), Bubb / Trashling / Haboob on stat layer 6, and Suspend '
      + 'again plus Temporal Rift on self-erase. Read the ledger by MISSING PRIMITIVE, not '
      + 'by card, and it is a much shorter list than it looks.',
    evidence: 'card-ledger.ts, kept honest by 71-card-ledger.test.ts.',
    fix:
      'Work the ledger down BY PRIMITIVE rather than by card — see the finding in the '
      + 'detail. Delete each entry in the same commit as its fix; that is the rule at the '
      + 'head of the file and it is what keeps a park note from outliving its cause. Note '
      + 'that 71-card-ledger.test.ts needs a live CANARY for its dead-shape sweep, so '
      + 'un-parking whichever card currently holds that role means nominating another.',
    proof: null,
    verify:
      'node --test test/71-card-ledger.test.ts prints the current tally on every run, and '
      + '83-card-todo.test.ts prints the ledger length beside the todo counts.',
    // DONE 2026-08-24: the ledger is EMPTY. The last six cards came off in one
    // round, worked exactly as this entry prescribed — by PRIMITIVE, not by
    // card: R121 (ability tax + pay-to-trigger gate → Crevice Lurker), R122
    // (imposed sacrifice cast cost → Vengeance), R123 (bin-anchored play
    // permission + erase-funded grant → Writhing Host, and the play-from-bin
    // action → Trench Stalker whole), R124 ('leftBin' choke point → Rotling),
    // plus Worldbender via replaceCardStep (report #87). The sweep stays armed:
    // its dead-shape assertion fails the day a new card ships with a dead half
    // and no entry, and the canary is synthetic now (T71 Canary), so an empty
    // ledger cannot blunt it.
    guards: [
      '71-card-ledger.test.ts::every card with a readably-dead half is declared',
      '71-card-ledger.test.ts::the sweep has teeth',
    ],
    status: 'done',
  },
  {
    id: 9,
    area: 'coverage',
    severity: 'minor',
    title: 'Many per-card "tests" only assert that the card registers',
    detail:
      '121 of the 494 registered cards were named exactly ONCE across every file in '
      + 'test/. That shape is the registration smoke check — spawn the body, assert the '
      + 'printed power/toughness — which passes for a card whose rules text does nothing '
      + 'at all. It is what let the three silent cards above sit behind a green suite.',
    evidence: 'A count of quoted card names per test file across all 80 test files.',
    fix:
      'STILL OPEN, deliberately — this is a PROGRAM, not a fix, and pretending otherwise '
      + 'is how it would quietly stop happening. What changed 2026-08-23: the population '
      + 'went 131 → 118 (39 cards got real, situation-named tests out of the silent-branch '
      + 'sweep and the replacement layer), and it now has a SCOREBOARD — '
      + '90-coverage-census.test.ts measures the four coverage bands, prints them on every '
      + 'run, and floors the weak band just above its real value so the next card added '
      + 'without a test of its own trips it. '
      + 'The honest read of the number: it counts ATTENTION, not correctness. A card named '
      + 'ten times can still be wrong and a card named twice can be perfect. What it cannot '
      + 'be is a card nobody has looked at.',
    proof: null,
    verify:
      'node --test test/90-coverage-census.test.ts prints the census. This item closes when '
      + 'the "named exactly once" band is small AND the cards in it are ones whose printed '
      + 'text genuinely needs no more than a body check (vanilla bodies, pure attribute '
      + 'cards) rather than ones nobody has got to yet.',
    // DONE 2026-08-24: the whole 97-card "named exactly once" band was
    // audited card-by-card by five parallel agents (combat triggers /
    // lifecycle watchers / play-watchers / spells / statics). 96 of 97
    // already carried real behavior tests — the band was an artifact of the
    // census counting only EXACT-quoted names, so a thorough test titled
    // 'Name: what it does' plus one spawn('Name') call scored as "named
    // once". The census now counts title-style mentions too, and the honest
    // band is 1: Slink, a vanilla body whose {Thieving} is pinned through it
    // in 09-attrs — exactly the "needs no more than a body check" close
    // condition this entry set. The audit also closed the real holes it
    // found: Recyclable Sentinel's death-branch payout (104), Rotspore
    // Herald on effect damage (107), ten R37/token-gate/bin-play negatives
    // (105), and Wraith's start-of-deployment shrink (101, via #23). The
    // floor is 8 (just above 1), so the next card added without a test of
    // its own still trips the census.
    guards: [
      '90-coverage-census.test.ts::the pool coverage census',
      '90-coverage-census.test.ts::every excluded sweep file still exists',
    ],
    status: 'done',
  },
  // ── UNANSWERED OWNER REPORTS ──────────────────────────────────────────
  // Owner reports that were `live` in playtest-ledger.ts when this list was
  // drawn up (CT-10..CT-14 were that batch), carried here so that "cards
  // found broken by testing" and "reports nobody has answered" are ONE list —
  // which is what was asked for. The LEDGER stays the authority on wording
  // and status, and its tally is read live by 83-card-todo.test.ts rather
  // than counted here, so this comment cannot rot when reports get fixed.
  // `reportId` is the index into playtest-issues.snapshot.jsonl, and
  // 83-card-todo.test.ts asserts these entries stay in step with the ledger.
  {
    id: 10,
    area: 'engine',
    severity: 'blocker',
    reportId: 60,
    title: 'There is no replacement-effect layer; twelve cards print replacement wording',
    detail:
      'Owner (XBYN, 2026-08-22): "The engine makes so many things triggers despite them '
      + 'not technically being triggers. We need a whole layer that deals with replacement '
      + 'effects." Twelve cards print replacement wording — five parked, six implemented as '
      + 'triggers. Live consequences: Containment Protocol and Nothyr can NEGATE a '
      + 'replacement (which never uses the stack); Automaton of Abundance fires per spawn so '
      + 'N identical tokens yield N copies instead of one per unique; Cosmic Conspirator '
      + 'really creates then erases, firing a spurious `spawned`; Nullbringer fires a '
      + 'lifeGained for a gain that never happened. Five module-level mutable flags exist '
      + 'only to paper over this.',
    evidence: 'playtest-ledger.ts #60, still `live`. Restated by the owner as #75.',
    fix:
      'BUILT 2026-08-23 as R104, in TWO families rather than one, because Caleb settled '
      + 'that they compose differently. (a) `AmountMod` — continuous, SUMMED, modelled '
      + 'line for line on `CostMod`: "a replacement only happens once … The replacement '
      + 'just takes what would be 1 and makes it 2", so two modifiers both apply and none '
      + 'applies to itself. Conduit of Pain, Flux Resonator, Proliferating Slime. '
      + '(b) Named `replaceX` hooks — first-true-consumes, modelled on the two that '
      + 'already existed: `replaceLifeGain`, `replaceCounters`, `replaceTokenCreation`, '
      + '`replaceTokenBatch`. Nullbringer, Counter Thief, Cosmic Conspirator, Automaton of '
      + 'Abundance. Plus `E.lockLife` for Suspend, which is neither. '
      + 'Deliberately NOT a general "any event" framework — one named hook per replaceable '
      + 'quantity, which is what the engine already said it wanted. '
      + 'Harbinger of Immolation is NOT in this class — it is continuous, not a replacement.',
    // The measured consequences, all now asserted rather than argued:
    // Nullbringer fires NO lifeGained and pushes nothing (verified directly:
    // life 30 → 26 on a gain of 4, event types lifeLost+info, empty stack);
    // Cosmic Conspirator fires no `spawned` for the Robot that was never
    // created and no `erased`; Conduit of Pain produces ONE damage event of 4
    // rather than a 6 then a 1. All seven cards now declare ZERO triggered or
    // activated abilities, so Containment Protocol and Nothyr cannot see them
    // at all — which is this item's stated acceptance criterion.
    // Three module-level flags deleted (`proliferating`, `aoaCopying`, and the
    // `nullbringerClaimed` WeakSet). Two KEPT and they are a different thing:
    // `probing` guards a nested QUERY (Spell Excavation asking targetCandidates
    // about another card's spec) and `aoScanning` stops two adjacent Ancient
    // Ones mimicking each other. One new latch lives in the ENGINE instead of a
    // card file — `inReplaceCounters`, because a counter redirect genuinely
    // re-enters and two thieves would ping-pong.
    proof: null,
    verify:
      'Containment Protocol cannot negate any of the seven, because none of them declares '
      + 'a triggered or activated ability any more — check with '
      + "`getCard(n).abilities` / `.augmentText` filtered on type. `docs/digital-rules.md` "
      + 'R104 records the layer; `88-replacement-conformance` fails if a declared hook is '
      + 'never read in engine.ts.',
    guards: [
      '87-replacement-layer.test.ts::Containment Protocol on the stack cannot negate a life-gain replacement',
      '87-replacement-layer.test.ts::Containment Protocol RESOLVING negates nothing a replacement did',
      '87-replacement-layer.test.ts::Nothyr finds no nonspell effect to target',
      '87-replacement-layer.test.ts::a replaced life gain fires no lifeGained',
      '87-replacement-layer.test.ts::a replaced token creation fires no spawned',
      '87-replacement-layer.test.ts::two different AmountMods both apply',
      '87-replacement-layer.test.ts::an AmountMod does not apply to its own contribution',
      '87-replacement-layer.test.ts::a replacement fires once, not once per source',
      '88-replacement-conformance.test.ts::the layer is NARROW on purpose',
    ],
    status: 'done',
  },
  {
    id: 11,
    area: 'engine',
    severity: 'blocker',
    reportId: 75,
    title: 'The rule for what may reach the stack, in the owner’s own words',
    detail:
      'Owner (WEHH, 2026-08-22), refined 2026-08-23. Only "When" / "Whenever" / a ":" '
      + 'activated ability go on the stack. Cards that say "instead", "as" or "if" AND DO '
      + 'NOT MENTION A TARGET never go on the stack — the target clause is the load-bearing '
      + 'half, because choosing a target is a public, respondable act. By that test '
      + 'Automaton of Abundance, Cosmic Conspirator, Nullbringer, Counter Thief, Flux '
      + 'Resonator, Proliferating Slime and Conduit of Pain all print "instead" with no '
      + 'target and must never reach the stack; R102 (Beyond, Codex Incarnate) is correctly '
      + 'NOT an exception, because it prints "target unit".',
    evidence: 'playtest-ledger.ts #75 — the sharpest statement of #60, and its acceptance criterion.',
    fix:
      'DONE 2026-08-23, and the deliverable is the SWEEP, not the seven cards. A one-card '
      + 'fix is what made this recur: report #46 (Bulborb) was closed with exactly one '
      + 'card and one test, and the class then came back as #60 and again as #75. So the '
      + "owner's printed-word rule is now a conformance test over all 494 cards, in the "
      + 'same family as 68-target-conformance (which exists for the same reason). '
      + 'It classifies per SENTENCE, and the narrowing took four measured rounds: the '
      + 'words literally → 63 cards; drop bare "if" → 19; require "would" → 11; require '
      + '"would" AND "instead" in the same sentence → 10 — plus one addition for the '
      + "owner's \"as\", a verb-anchored `deal|deals|dealt … as` that catches Blightsea "
      + 'Polyp and cannot match "as if it was in your hand". 11 cards flagged, 10 of which '
      + 'must never reach the stack and 1 of which must (Beyond, Codex Incarnate — it '
      + 'prints "target unit", so R102 is right and the sweep asserts the INVERSE for it).',
    // Two exemptions, both self-invalidating: Skittering Blight is exempt only
    // from the "whole text is a replacement" shortcut, because it prints "When
    // I spawn, gain a rot." as a separate sentence — the test fails if its text
    // ever becomes all-replacement. Beyond is pinned the other way.
    proof: null,
    verify:
      'node --test test/88-replacement-conformance.test.ts prints '
      + '"REPLACEMENTS: N of 494 cards — M never reach the stack, K do (they name a '
      + 'target)" on every run, and carries a classifier floor naming all 11 so a future '
      + 'over-narrowing cannot make the file pass vacuously.',
    guards: [
      '88-replacement-conformance.test.ts::a replacement that names NO target is built out of the replacement layer',
      '88-replacement-conformance.test.ts::a card whose whole text is an untargeted replacement declares NO ability at all',
      '88-replacement-conformance.test.ts::a replacement that DOES name a target still uses the stack (R102 stays R102)',
      '88-replacement-conformance.test.ts::every exemption is still needed',
      '88-replacement-conformance.test.ts::the classifier finds the replacement clauses, and only those',
    ],
    status: 'done',
  },
  {
    id: 12,
    area: 'card',
    severity: 'major',
    cards: ['Biotoxicity', 'Cosmic Conspirator'],
    reportId: 64,
    title: 'Biotoxicity never offers the token choice Cosmic Conspirator is supposed to grant',
    detail:
      'Owner (GETD, 2026-08-22): "Biotoxicity didn’t give me the choice of what kinds of '
      + 'tokens I wanted even though I had Cosmic Conspirator." Cosmic Conspirator is a '
      + 'replacement; its "you may instead" is a choice INSIDE the replacement and needs a '
      + 'decision raised BEFORE anything is created. Today the engine creates the Robot, '
      + 'fires `spawned`, then erases it — and Biotoxicity creates several tokens at once, '
      + 'so the per-spawn trigger never asks per kind.',
    evidence: 'playtest-ledger.ts #64. Blocked on CT-10.',
    fix:
      'FIXED 2026-08-23 by R104, and it did fall out of the layer — TWO defects, both of '
      + 'which a trigger patch would have missed. Biotoxicity creates three SPELL tokens '
      + 'and `E.createSpellToken` fired no dispatchable event at all, so the old `spawned` '
      + 'trigger heard nothing; and a per-spawn trigger could not have asked per token in '
      + 'a batch even if it had heard. `replaceTokenCreation` is consulted at the creation '
      + 'call, once per request, BEFORE anything exists — so the Robot that is swapped away '
      + 'is never created, never fires `spawned`, and is never erased.',
    proof: null,
    verify:
      'Play Biotoxicity with Cosmic Conspirator in play: three tokens, three questions, '
      + 'and each token comes out the kind you picked with the same X.',
    guards: [
      '26-metal-a.test.ts::Biotoxicity asks once per token in the batch (report #64)',
      '26-metal-a.test.ts::a created Robot may become a Fireball of the same X',
      '87-replacement-layer.test.ts::one resolving part is one creation batch',
    ],
    status: 'done',
  },
  {
    id: 13,
    area: 'client',
    reportId: 76,
    title: 'Undo during a hidden segment: the reported case is fixed; one narrow refusal remains',
    detail:
      'Owner (WEHH, 2026-08-22): deployment is simultaneous and hidden, so what the '
      + 'opponent did cannot have depended on your action. The undo guard asks "did anyone '
      + 'act after you", which is the right question during battle (shared, public stack) '
      + 'and the wrong one here.',
    evidence: 'playtest-ledger.ts #76.',
    fix:
      'FIXED 2026-08-23, and NOT the way the report asks. "Always be able to" is unsafe: '
      + 'splicing your action out shifts every entity id above its floor, and an opponent '
      + 'action that still replays LEGALLY while naming a different unit is silent '
      + 'corruption — worse than a refusal. `undoActionAt`\'s rebuild only ever measured '
      + '`IllegalAction`, so it was blind to exactly that. '
      + 'So: `spliceable()` is now cheap and EXACT for the id route only (refuse iff the '
      + 'spliced action allocated ids AND a later action names an id above that floor); it '
      + 'no longer asks who acted. Everything else is MEASURED — every action carries a '
      + 'resolved reference key (an entity id becomes "the k-th entity created by action '
      + 't7", a hand index becomes the card at it, a decision becomes its option label), '
      + 'plus the rng state and the actor\'s own private-zone delta; splice, rebuild, '
      + 'recompute, accept only if every later key is byte-identical. `RENUMBER_IMMUNE` is '
      + 'deleted as SUBSUMED — its five members were exempt because they name nothing, '
      + 'which the general rule now says once. '
      + 'Planning is covered for free: the gate reads the SEGMENT, never the phase, which '
      + 'is what report #37 asked for in so many words.',
    // ⚠ RECURRENCE, and the reason it recurred is on the record now: report
    // #37 (2026-08-21) made this same complaint, was marked FIXED, and NEITHER
    // of its two guards could ever have failed on #76's behaviour — both drive
    // the resource step, which allocates no id and draws no RNG, so the splice
    // gate is never even reached. #37's fix built the hidden SEGMENTS (which
    // decide which of your actions an undo looks at); it never touched the
    // splice GATE (which decides whether the undo may go). The decision also
    // lived inside main.ts's WebSocket handler, reachable only by playing a
    // whole game over a socket — a test nobody writes. It is now
    // `undoForSeat(room, seat)` in rooms.ts, and the guards below drive THAT.
    proof: null,
    verify:
      'The gate is `undoForSeat` in server/rooms.ts. Reproduce the report: deploy, have '
      + 'the opponent deploy a card (a real play, not a bare done), and your own play must '
      + 'still come back. It is done when the string "already acted on top of that one" '
      + 'appears nowhere in server/ except as a quoted report.',
    guards: [
      'server/test-undo-segment.ts::and it carries a PAYLOAD',
      'server/test-undo-segment.ts::is still undoable',
      'server/test-undo-segment.ts::whole position came through the rebuild untouched',
      'server/test-undo-segment.ts::and the reported error text is gone for good',
      'server/test-undo-segment.ts::the splice is refused',
      'server/test-undo-segment.ts::a fresh room opens inside the plan segment',
      'server/test-hidden.ts::freeze is captured at room creation',
    ],
    // CLOSED 2026-08-23 at the owner's second answer: "In deployment and
    // planning, you're 'alone' in a world that no one else can see. So you
    // should be perfectly allowed to undo everything, up to the beginning of
    // that phase." No residual refusal remains inside a hidden segment.
    //
    // ⚠ THE FIRST ATTEMPT WAS TOO CAUTIOUS AND THE SECOND FOUND OUT WHY.
    // Dropping the conservative id screen was NOT enough, and the reason is
    // worth keeping: the log is replayed VERBATIM, so a later action's raw
    // `hostId: 4` names a number that ceases to exist after the splice. The
    // measurement cannot wave that through — it refused four real games with
    // the engine's own "no such unit". The renumbering is not a false alarm to
    // be silenced, it is damage to be REPAIRED.
    // So `undoActionAt` now splices, RENUMBERS the surviving log (the spliced
    // action allocated [lo, hi); everything at or above `hi` shifts down by
    // hi - lo), rebuilds, and uses the reference-key measurement as the PROOF
    // that the renumbering was a repair rather than a guess — if the world
    // moved in any way other than that constant shift, a key differs and the
    // whole undo rolls back.
    // ⚠ This REWRITES ENTITY IDS IN THE PERSISTED LOG. Deliberate: an id is the
    // row number a choice was filed under, not the choice, and `seed + actions`
    // still reproduces the game exactly, which is the log's actual contract.
    // The only alternative is the refusal the owner just rejected.
    // The floor is `segmentFloor`, which lifts over a leading run of `decide`s
    // when the segment opened mid-suspension — debt (R39) and start-of-
    // deployment rot (R38) are paid inside the barrier action and were already
    // below it, but a start-of-phase trigger that ASKS something leaves its
    // `decide` at the segment start and must not be undone.
    severity: 'minor',
    status: 'done',
  },
  {
    id: 14,
    area: 'client',
    severity: 'minor',
    reportId: 77,
    title: 'A refused block declaration throws away the entire block plan',
    detail:
      'Owner (WEHH, 2026-08-22): declaring illegal blocks resets the whole board, so a '
      + 'large block has to be rebuilt over one mistake. It should name the offending '
      + 'units, keep the rest, and offer a "Reset blockers?" button.',
    evidence: 'playtest-ledger.ts #77. Client-side, not the engine.',
    fix:
      'FIXED 2026-08-23. Two halves, and the second was the real cause. '
      + '(a) `doDeclareBlocks` in apply.ts is split into `checkBlocks` — the same legality '
      + 'run, verbatim and in the same order — and the mutation, so the refusal is '
      + 'available as a VALUE (`blockDeclarationIssue`). `IllegalAction` did not need '
      + 'widening. ui/battle.ts\'s `blockVerdict` then walks a refused plan against that '
      + 'oracle (base, then columns in order, then counterattackers, then riders) and '
      + 'returns `{ why, offenders, keep, required }`. Every judgement is a question put '
      + 'to the engine, so no block rule is restated client-side and what survives is '
      + 'legal by construction. R84\'s compulsory duty comes back as `required`, not as an '
      + 'offender. Which blocks are LEGAL did not change. '
      + '(b) `declareBuiltBlocks` cleared the plan immediately after `act()`. That is '
      + 'correct in hotseat, where the refusal is synchronous, and WRONG over a socket, '
      + 'where the refusal lands after the wipe — i.e. in every network game, which is '
      + 'every game the report came from. The plan is now held until an authoritative '
      + 'state says the declaration landed.',
    proof: null,
    verify:
      'Declare a block plan with one bad column in a NETWORK game (the bug does not '
      + 'reproduce in hotseat). Only the named units clear, the notice names them by card, '
      + 'and a "Reset blockers?" button is offered.',
    guards: [
      '86-ui-block-refusal.test.ts::one bad column does not cost you the other five',
      '86-ui-block-refusal.test.ts::what the verdict keeps is something the engine actually accepts',
      '86-ui-block-refusal.test.ts::a compulsory block is REQUIRED, not an offender',
      '86-ui-block-refusal.test.ts::widening the error did not widen the RULE',
      '86-ui-block-refusal.test.ts::a sent block declaration leaves the plan standing on the board',
      '86-ui-block-refusal.test.ts::the block legality the client could only reach by being refused is now askable',
    ],
    status: 'done',
  },

  // ── found by the SEMANTIC pass (84-card-semantics.test.ts) ────────────
  {
    id: 15,
    area: 'card',
    severity: 'major',
    cards: ['Collect Remains', 'Temporal Rift', 'Suspend', 'Skybreaker'],
    title: '"Erase me" is unimplemented on four of the six cards that print it',
    detail:
      'Four cards print a self-erase and none of them erases anything: Collect Remains '
      + '("Put target card in a bin into your hand. Erase me."), Temporal Rift ("End this '
      + 'battle. Erase this spell."), Suspend ("… Erase me.") and Skybreaker ("[Augment] '
      + 'Erase me: Negate all spell effects."). Each has real, working code for its OTHER '
      + 'half, which is exactly why nothing caught it: the shape sweep in 71-card-ledger '
      + 'sees live code, and the drill sees the card do something. The two cards that DO '
      + 'implement it are Spore of Regenesis (erasing as a cost) and Zephyrzoa (in its '
      + '[Augment] box). '
      + 'This is not cosmetic. The erased pile is the zone cards leave the game through '
      + '(R65), so a spell that should erase itself instead lands in the bin, stays '
      + 'recurrable, and keeps counting toward every "cards in your bin" effect and every '
      + '"erase X cards from your bin" cost. Collect Remains is the worst of them, being '
      + 'itself a bin-recursion spell that is supposed to remove itself from the game.',
    evidence:
      'The semantic pass: the printed clause promises an `erased` event and the drill '
      + 'observed none, in any of the three board states. Confirmed by reading each run — '
      + 'none contains an erase call at all.',
    fix:
      'A resolving spell is binned by the engine after its effect runs, so a self-erase '
      + 'has to redirect that disposal rather than erase a card that is still on the '
      + 'stack. Skybreaker is the odd one out: there "Erase me" is an activation COST on '
      + 'a unit, so it follows Spore of Regenesis\'s pattern (eraseUnit on self) rather '
      + "than the spell-disposal one. Do Collect Remains first — it is the only one whose "
      + 'gap changes what a deck can do.',
    proof: () => {
      const dead = ['Collect Remains', 'Temporal Rift', 'Suspend', 'Skybreaker'].filter(n => {
        const c = getCard(n);
        const src = [c.spellEffect?.run, ...(c.abilities ?? []).map(a => a.effect?.run),
          ...(c.augmentText ?? []).map(a => a.effect?.run), c.graftEffect?.effect?.run]
          .map(f => (f ? f.toString() : '')).join('');
        return !/erase/i.test(src);
      });
      return dead.length === 4;
    },
    // FIXED 2026-08-23. `StackItem.eraseSelf` + `EffectCtx.eraseSelf()`, read by
    // a new branch in `dischargeItem` — the same choke point R79's Unstable
    // erase already goes through, so the two cannot double-log or double-push
    // to the public pile. The flag is state on the ITEM rather than a closure
    // variable, which is what makes it survive a mid-part suspension being
    // serialised and replayed (R85); a save/load round-trip test proves it.
    //
    // Two rulings came out of the work, both pinned:
    //  · A NEGATED self-erase spell is BINNED, not erased. "Erase me." is a
    //    sentence OF THE EFFECT, and R68 says a negated effect does nothing.
    //    The contrast one branch up proves it is a decision and not an
    //    accident: R79's {Unstable} IS erased on negation, because Unstable is
    //    a stamp on the object (a virus rode it) rather than an instruction.
    //    A FIZZLED one is binned for the same reason.
    //  · Skybreaker is not in this class at all — there "Erase me" is an
    //    activation COST on a unit in play, so it needed `AbilityCost.eraseSelf`
    //    and a real `eraseFromPlay`. It had been approximated as `sacrificeSelf`,
    //    which is a DEATH: the card reached a bin, fired death triggers and
    //    stayed recurrable. An erase is none of those things.
    guards: [
      '89-self-erase.test.ts::Collect Remains: it takes the bin card AND leaves the game',
      '89-self-erase.test.ts::having erased itself, it is not there for the next copy to recur',
      '89-self-erase.test.ts::Suspend: the life lock lands for the battle and the spell erases itself',
      '89-self-erase.test.ts::Temporal Rift: ending the battle does not carry off its own disposal',
      '89-self-erase.test.ts::Skybreaker: "Erase me" is paid as the activation cost, and an erase is not a death',
      '89-self-erase.test.ts::a NEGATED self-erase spell is binned, not erased',
      '89-self-erase.test.ts::a virus rides a self-erasing spell',
      '89-self-erase.test.ts::the erase survives a save/load',
      '89-self-erase.test.ts::every card in the pool that prints a self-erase reaches the erased pile',
      '84-card-semantics.test.ts::the \"Erase me\" class is exactly the four cards CARD-TODO #15 names',
    ],
    status: 'done',
  },
  // ── found while FIXING the above, 2026-08-23 ──────────────────────────
  // Every one of these was surfaced by the silent-branch sweep or the Piercing
  // work and confirmed by direct measurement before being written down. They
  // are here rather than in a report because the lesson of this repo is that a
  // finding with no entry and no failing test is a finding that comes back.
  {
    id: 16,
    area: 'engine',
    severity: 'major',
    title: 'A non-combat damage batch with nothing in it resolves in total silence',
    detail:
      '`E.dealEffectDamageAll` opens with `if (!order.length) return;` and says nothing. '
      + 'Measured 2026-08-23: an empty batch emits ZERO events. That is the same defect '
      + 'CARD-TODO #3 fixed on three cards, one level down — and it is the level that '
      + 'matters, because every "I deal N damage to each opponent / each enemy unit" card '
      + 'builds a hit list and hands it over. With no opponent in the region (R25) or no '
      + 'enemy unit on the board the list is empty, the card resolves, the mana is spent '
      + 'and the log is blank. Three carriers were patched card-side during the #3 sweep '
      + '(Flzzz, Restitution, Vroot); the rest of the pool is not, and patching them one '
      + 'at a time is exactly the shape that makes a bug recur.',
    evidence:
      'Direct probe: `dealEffectDamageAll(ctx, [])` against a live game state, counting '
      + 'events before and after. Zero. Raised by the agent that fixed CARD-TODO #3, which '
      + 'could not fix it because engine.ts was out of its scope.',
    fix:
      'Announce it in `dealEffectDamageAll` itself, at the `!order.length` return, naming '
      + '`ctx.sourceName` — one line covers every carrier at once and no card needs to '
      + 'know. Watch the two shapes that are NOT this bug and must stay silent: a batch '
      + 'whose hits were all `n <= 0` (a card that computed zero damage on purpose), and '
      + 'a fully PREVENTED batch, which R98 says was never dealt and which already logs '
      + 'the prevention itself.',
    proof: () => eventsFrom('Immolate', 8116, () => ({ targets: [] })) >= 0 && (() => {
      const { h, A } = board(8116, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      const before = g.events.length;
      g.dealEffectDamageAll({
        controller: A, sourceName: 'Immolate', region: g.homeRegion(A),
        targets: [], event: null, choose: () => { throw new Error('choice'); },
      } as never, []);
      return g.events.length === before;
    })(),
    // FIXED 2026-08-23. The guard is at the TOP of `dealEffectDamageAll` and
    // keyed on `hits.length`, not on `order.length` — which is what keeps the
    // two must-stay-silent shapes silent. An all-zero batch has a non-empty
    // `hits` and never reaches it (the planning loop's `n <= 0` drops it, and
    // the CARD owns that explanation — Siphon Life already says "X = 0"). A
    // fully prevented batch structurally cannot reach it either: prevention
    // runs after `!order.length`, in the `received` loop, so its `order` is
    // never empty, and R98 logs the prevention itself.
    // Four real carriers were covered without a single card edit: Meteor
    // Shower, Roving Quillback, Infernal Grovekeeper, Channel Through.
    guards: [
      '93-engine-defects.test.ts::handed an empty hit list announces that there was nothing to damage',
      '93-engine-defects.test.ts::still deals its damage and fires a damage event',
      '93-engine-defects.test.ts::whose every hit computed zero damage stays silent',
      '93-engine-defects.test.ts::a fully prevented damage batch reports only the prevention',
      '93-engine-defects.test.ts::Meteor Shower with no unit anywhere to hit',
    ],
    status: 'done',
  },
  {
    id: 17,
    area: 'engine',
    severity: 'major',
    cards: ['Wake the Dead'],
    title: 'Playing another player’s card out of their bin makes you its OWNER, permanently',
    detail:
      'Wake the Dead prints "Play up to two units in ANY bin with total cost [8] or less '
      + 'now, for free." It ends `g.spawnUnit(seat, c.name, ctx.region)` where `seat` is '
      + 'the CASTER and `c.seat` may be the opponent — and `E.spawnUnit` takes no owner '
      + 'parameter at all: it sets `owner: seat, controller: seat` together. So a unit '
      + 'raised out of an enemy bin is not borrowed, it is naturalised. When it dies it '
      + 'goes to the CASTER’s bin, it counts toward the caster’s "cards in your bin" '
      + 'effects for the rest of the game, and the original owner can never recur it. '
      + 'The engine tracks owner and controller separately everywhere else and says so '
      + 'out loud at R65 ("each card reaches ITS OWN owner’s erased pile — a virus on '
      + 'an enemy spell is the enemy’s card"), so this is a missing parameter rather '
      + 'than a deliberate reading. The card’s own header already calls it an '
      + 'approximation; the ledger does not carry it.',
    evidence:
      'Read from `E.spawnUnit`’s signature (`owner: seat, controller: seat`, no owner '
      + 'option) against Wake the Dead’s run, which is the only effect in the pool that '
      + 'reaches into a bin it does not control and then spawns. Found by the '
      + 'silent-branch sweep as a side observation and confirmed by reading both.',
    fix:
      'Give `spawnUnit` an `owner` option defaulting to `seat`, and pass the picked '
      + 'card’s real owner from Wake the Dead. Then check the neighbours: '
      + 'batch-dark-c already passes an explicit `owner`, batch-hybrids-ld-a spawns for '
      + '`opp` and for `m.controller`. A control-change is R8 and is NOT this — R8 moves '
      + 'the unit, it does not renationalise the card.',
    // ⚠ THE FIRST VERSION OF THIS PROOF WAS A SOURCE-TEXT PROXY (it matched
    // `g.spawnUnit(seat,`) and it stayed TRUE after the bug was fixed, because
    // the fix adds a fourth argument rather than changing the first. A proof
    // that reads source can be satisfied — or defeated — by restructuring, and
    // this one very nearly forced a pointless rename to make it go false. It is
    // behavioural now: raise an enemy's binned unit and ask who OWNS it.
    proof: () => {
      const { h, A, D } = board(8117, 'Tidal Menace', 'The Foretold');
      const g = new E(h.state);
      g.player(D).bin.push('Curio Drifter');
      let asked = 0;
      try {
        getCard('Wake the Dead').spellEffect!.run(g, {
          controller: A, sourceName: 'Wake the Dead', region: g.homeRegion(A),
          targets: [], event: null,
          choose: (_k: string, dec: { options: { card?: string; value: unknown }[] }) =>
            (asked++ === 0
              ? dec.options.find(o => o.card === 'Curio Drifter')!.value
              : dec.options[dec.options.length - 1]!.value),
        } as never);
      } catch { return true; }
      const raised = Object.values(g.s.entities).find(u => u.card === 'Curio Drifter');
      // the bug is present while the CASTER ends up owning the opponent's card
      return !!raised && raised.owner === A;
    },
    // FIXED 2026-08-23. `spawnUnit` gained an `owner` option defaulting to
    // `seat` (which stays the CONTROLLER), and the `spawned` event carries
    // `owner` only when it differs, so no existing reader's payload moved.
    // Verified directly: a unit raised out of P0's bin by P1 comes back
    // controller P1 / owner P0, and dies to P0's bin.
    // The sweep found TWO more, both wrong in more interesting ways than Wake
    // the Dead: Uglk ("each player puts a unit from THEIR bin into play under
    // an OPPONENT's control") was handing the card over permanently, which its
    // text never says — it now sets controller and owner in opposite directions
    // from one sentence; and Reclaim the Fallen ("under their CONTROLLER's
    // control") means a virus you stuck on an enemy comes back on their side
    // and is still your card. Every other spawn site reads the caster's own
    // zone, and every token site is correct by construction — a creation is
    // owned by its creator.
    guards: [
      '93-engine-defects.test.ts::raising a unit from the ENEMY bin gives the caster control, not ownership',
      '93-engine-defects.test.ts::raising a unit from your OWN bin is unchanged',
      '93-engine-defects.test.ts::the borrowed spawn says so in its event',
      '93-engine-defects.test.ts::Uglk hands an opponent CONTROL of a unit without handing over the card',
    ],
    status: 'done',
  },
  {
    id: 18,
    area: 'engine',
    severity: 'minor',
    cards: ['Hexbane Shiitake'],
    title: 'A [once] budget is spent when the trigger is QUEUED, so an ability that does nothing still burns it',
    detail:
      '`E`’s trigger-composition writes `budgetHolder.budgets[budgetKey] = 1` the moment '
      + 'a `bounded` ability is composed — before its run has a chance to discover it can '
      + 'do nothing. 88 of the pool’s 138 bounded ([once] / [Switch1]) abilities have a '
      + 'run that can bail out, and most of those bail-outs are harmless type guards. '
      + 'One was not: Hexbane Shiitake used to read `inEndOfTurn(g) ? false : ctx.choose(...)`, '
      + 'so during the end-of-turn window the player was NEVER ASKED and the [once] was spent '
      + 'anyway. The same shape burns the budget when the carrier is already gone or when '
      + 'the spell it wanted has left the stack. '
      + '⚠ The general case needs a RULING, not just code: does declining a "you may" '
      + 'on a bounded trigger spend the budget? A defensible yes (the trigger did fire). '
      + 'What is NOT defensible is spending it on a question nobody was asked.',
    evidence:
      'Read at engine.ts’s bounded-budget write (`if (ability.bounded) { … budgets[key] = 1 }`), '
      + 'which runs at composition time, against a census of every bounded ability whose run '
      + 'contains a bare `return;`: 88 of 138. Surfaced by the CARD-TODO #3 sweep.',
    fix:
      'RULED 2026-08-23: DECLINING NEVER SPENDS IT. A [once] is spent only when the '
      + 'ability actually does something — say no to a "you may" and the budget is intact, '
      + 'so the same trigger can ask again later the same turn. That answers both halves '
      + 'at once (the never-asked auto-decline and the ordinary decline) and makes all 88 '
      + 'bounded abilities with a bail-out branch behave the same way. '
      + 'SINCE UPDATED (same day): the never-asked half no longer exists. The premise it '
      + 'rested on — that a ctx.choose suspension in the end-of-turn window strands the '
      + 'game — was stale, so `inEndOfTurn` and all 21 of its auto-answers were deleted '
      + 'and Hexbane now ASKS wherever it resolves (99-endofturn.test.ts). The RULING is '
      + 'unchanged and still load-bearing: it is what makes the ORDINARY decline refund. '
      + 'IMPLEMENTATION NOTE, because the obvious version does not work: "emitted no '
      + 'event" is NOT the test for "did nothing" any more — CARD-TODO #3\u2019s sweep just '
      + 'gave every one of those bail-out branches an announcement, which was the point of '
      + 'it. So the seam has to be EXPLICIT: keep the reservation at composition time (it '
      + 'is also the re-entrancy guard) and add a way for a run to say "I did nothing, '
      + 'refund it", called from the ~46 branches the #3 sweep already found and annotated. '
      + 'Those branches are the list; they do not have to be rediscovered.',
    // ⚠ THE FIRST VERSION OF THIS PROOF matched `inEndOfTurn(g) ? false` in the
    // card's source — and after the fix it went on matching the EXPLANATORY
    // COMMENT that replaced the code. Source-text proofs measure the wrong
    // thing. (The shape is gone from the pool entirely now, which is exactly
    // why a proof written against it would have proved nothing.) This one asks whether the seam exists at all: a refund cannot
    // happen if there is nothing to call. The BEHAVIOUR — declined refunds,
    // successful activation still spends — is asserted by the guards below,
    // which is where behaviour belongs.
    proof: () => !ENGINE_SRC.includes('settleBudgetRefund'),
    // FIXED 2026-08-23 to the owner's ruling. `EffectCtx.refundBudget?.()`
    // raises `EffectPart.refunded`; `E.settleBudgetRefund` pays it out AFTER
    // the part finishes, so a suspension throws past it and R85's replay starts
    // with the flag clear — idempotent, and a run that succeeds never raises it.
    // The reservation stays at composition time because it is also the
    // re-entrancy guard.
    // Called from the bounded subset of the CARD-TODO #3 population — 10 cards,
    // 21 branches — plus three ENGINE sites, which is a scope extension worth
    // knowing about: a graft rider's cast [cost] is marked spent at cast time,
    // BEFORE the run exists, so `ctx.refundBudget()` can never be reached there
    // and `E.refundPart` had to be called from `payCastCost`'s decline and the
    // two unpayable-cost branches. Same ruling, different route: declining a
    // cost you were offered is declining.
    guards: [
      '93-engine-defects.test.ts::in the end-of-turn window is ASKED, and declining does not spend its [once]',
      '93-engine-defects.test.ts::can still fire later the same turn',
      '93-engine-defects.test.ts::whose exchange is DECLINED keeps its [once]',
      '93-engine-defects.test.ts::a SUCCESSFUL Hexbane Shiitake exchange really does spend its [once]',
      '93-engine-defects.test.ts::a declined "you may pay" on a bounded trigger keeps its budget',
      '93-engine-defects.test.ts::a bounded ability that DID something keeps the budget spent',
    ],
    status: 'done',
  },
  {
    id: 19,
    area: 'card',
    severity: 'major',
    cards: ['Spellbind'],
    title: '{Modular} opens its window but offers only GRAFTS — never augments, which is half the keyword',
    detail:
      'Printed (Spellbind, the pool\'s only {Modular} card): "(You can apply mods to a '
      + 'modular card from your hand and/or bin as it is played. You still pay their '
      + 'costs.)" The WINDOW is built and works — `E.collectModular` asks inside R35\'s '
      + 'cast-time collection, offers hand and bin, charges each mod as an additional cast '
      + 'cost, rides the mods on the stack item where both players can see them, adds each '
      + 'one\'s effect as an extra part, and bins them with the spell (R40). '
      + 'What it offers is the problem: `if (!isGraftable(name) …) return;` — 137 of 494 '
      + 'cards, GRAFTS ONLY. The Manual defines two ways to apply a mod and this is one of '
      + 'them: an AUGMENT needs the [Augment] symbol on the mod ("There is no restriction '
      + 'on the number of times a card can be augmented"), while a GRAFT additionally '
      + 'requires "both cards must have the graft symbol". The Light & Dark glossary says '
      + 'it outright — a Modular card "can arrive already carrying augments/grafts". '
      + 'The engine\'s own comment justifies the exclusion: "it is the only kind of mod '
      + 'that means anything on a spell — a spell has no body for an augment to grant '
      + 'attributes to." That is contradicted by R79 IN THE SAME FILE: a virus augmenting '
      + 'a spell donates its type-line [Augment] attributes into `ctx.grantedAttrs`, and '
      + '`dealEffectDamageAll` reads them (R103 added {Piercing} to that list). An augment '
      + 'on a spell demonstrably does something.',
    evidence:
      'Measured 2026-08-23. Graftable cards and type-line-[Augment]-attribute cards are '
      + 'DISJOINT — 137 and 22, overlap ZERO — so the filter does not narrow the choice, it '
      + 'makes attribute donation through {Modular} impossible. Of those 22, fourteen are '
      + 'viruses and can already reach a spell through R79\'s own virus window, so they '
      + 'lose nothing. EIGHT are not viruses and can reach a spell by NO route at all: '
      + 'Resonant Form, Noxious Sporefiend, Carapace Devourer, Tempest Wrangler, Bubb, '
      + 'Ephemeral Skywalker, Curio Drifter, Whispering Mantid. {Modular} is the only '
      + 'timing that could ever put them on a spell, and the reminder text says it should. '
      + 'A further 143 cards carry [Augment] TEXT and are excluded too. '
      + 'Not found by any sweep: 43-dark-c.test.ts asserts the graft rider works, which it '
      + 'does, and no test asks what is NOT on the menu — the same blind spot shape as the '
      + '"Erase me" class (CARD-TODO #15), where each card\'s OTHER half worked.',
    fix:
      'TWO changes, and one of them is not enough on its own. '
      + '(1) Widen `collectModular`\'s filter from `isGraftable` to "graftable OR '
      + 'augment-capable", the same predicate `doAugment` already uses for a mod applied '
      + 'to a unit — so the offer matches the Manual\'s definition of a mod rather than a '
      + 'subset of it. '
      + '(2) Union `item.mods` into `grantedAttrs` in `resolveParts`, beside the existing '
      + '`item.augments?.length ? this.stackAugmentAttrs(item) : []`. Without this the '
      + 'widened offer donates nothing and the bug looks fixed while nothing changed — '
      + 'exactly the shape of the parked halves this round has been closing. '
      + 'RULED 2026-08-23, and it is wider than the question asked. The owner: "I think '
      + "it's legal to apply ANYTHING to a Modular card. But many cards wont do anything "
      + 'at all since it requires being in play (which a spell never is). Same with '
      + 'viruses, they should also be allowed to be applied to the modular card, even if '
      + 'they might not do anything." So the menu is EVERY card in hand and bin whose cost '
      + 'you can pay — no graft filter, no augment filter, viruses included. A mod that '
      + 'does nothing is a legal, wasteful play, not something to prevent. The [Augment] '
      + 'TEXT half therefore needs no ruling and no code: it does nothing on a spell '
      + 'because there is no body for it to live on, and that must be TESTED so a '
      + 'deliberate no-op cannot later be mistaken for an unimplemented one. '
      + 'SECOND RULING, same day, which the first one exposed: "A modded Spellbind should '
      + 'also have unstable. It basically works as a \'flashback\' for graft cards. You pay '
      + '1 to put it on the stack, then add in some effects from your yard that you also '
      + 'want to happen. Since otherwise, gaining 1 rot is pretty bad." That is the '
      + 'Manual\'s PERMADEATH paragraph (p.35) applied to this card — "As long as a card '
      + 'is modded, it has the unstable attribute … even though mods can be applied from '
      + 'the bin, they are generally only able to be applied once" — and the one-shot mod '
      + 'is the PRICE OF THE FLASHBACK rather than a harsh edge case. Before this, a mod '
      + 'applied through the {Modular} window was binned and reusable while a virus '
      + 'applied to the same spell through R79\'s window was erased: the same act with '
      + 'opposite outcomes, which stops being defensible the moment anything can be '
      + 'applied.',
    proof: () => {
      const from = ENGINE_SRC.indexOf('  private collectModular(');
      if (from < 0) return false;
      const rest = ENGINE_SRC.slice(from + 10);
      const next = rest.search(/\n  (private |public )?[a-zA-Z_$][\w$]*\(/);
      const body = next > 0 ? rest.slice(0, next) : rest;
      // the bug is present while the offer is graft-only
      return body.includes('isGraftable(name)') && !/augmentAttrs|isAugment|augmentText/.test(body);
    },
    // FIXED 2026-08-23 as R105. The menu is now `canPayCard(seat, name,
    // { purpose: 'mod' })` and nothing else — verified end to end: with a
    // graftable card, a non-virus type-line augment, a virus and an
    // [Augment]-text card in hand, all four are offered. (An earlier probe that
    // showed only the graftable one was an AFFINITY artefact of the probe's own
    // resources, not a filter — worth knowing before re-testing this.)
    // Three things had to land together or the fix would have looked done and
    // changed nothing:
    //  · the offer, widened;
    //  · `payModularMod` pushing a `graft:` part ONLY for a graftable card —
    //    an invented graft key throws in `effectByKey`, so this was the crash
    //    the widening would otherwise have caused;
    //  · `E.stackModAttrs`, unioning the mods' type-line attributes into
    //    `grantedAttrs` beside R79's virus channel. Kept a SEPARATE method so
    //    the virus channel keeps meaning what its name says.
    // And the owner's second ruling: a modded carrier is {Unstable}, so the
    // spell and its mods are ERASED, never binned. Verified: a graft card
    // applied FROM THE BIN produces its effect (3 Wraiths, rot 0 → 3) and both
    // it and Spellbind end in the public erased pile with neither in a bin.
    // That is the flashback working as designed — the one-shot mod is the price.
    guards: [
      '91-modular.test.ts::the {Modular} menu offers every card you can pay for',
      '91-modular.test.ts::a card in the BIN is offered beside the hand, and an unaffordable one is not',
      '91-modular.test.ts::a GRAFT mod still contributes its [Switch] effect as an extra part',
      '91-modular.test.ts::a mod with NO graft effect adds no part',
      '91-modular.test.ts::a type-line [Augment] mod really donates',
      '91-modular.test.ts::an [Augment]-TEXT mod is accepted and does nothing',
      '91-modular.test.ts::the flashback line',
      '91-modular.test.ts::an UNMODDED {Modular} spell is not Unstable',
      '91-modular.test.ts::the {Modular} window and the virus window agree',
      '91-modular.test.ts::a NEGATED modded Spellbind is erased too',
    ],
    status: 'done',
  },
  // ── follow-ups from the fix round itself, 2026-08-23 ──────────────────
  {
    id: 20,
    area: 'engine',
    severity: 'minor',
    title: 'A bounded [once] is still spent when the ability FIZZLES for want of a target',
    detail:
      'RE-ANSWERED, AND THE FIRST ANSWER WAS WRONG. The question was whether a fizzle is '
      + '"the ability did nothing" (refund, consistent with CARD-TODO #18) or "the ability '
      + 'happened and missed" (spend, consistent with the way R86 already treats a fizzle '
      + 'as a real resolution that produced nothing). Both readings are defensible and the '
      + 'engine originally answered by accident. '
      + 'It was first closed on the REFUND reading, and shipped that way for part of a '
      + 'day. The designer then ruled the whole bounded family directly — a bounded '
      + 'ability "can only be activated or triggered once per turn. REGARDLESS OF IF THAT '
      + 'ABILITY RESOLVES OR DOESN\'T" — which names the fizzle by its own description. '
      + 'Reachable, not theoretical: 61 bounded abilities in the pool declare a target '
      + 'spec, so any of them can be answered by removing its target in response — and '
      + 'under the correct answer that answer COSTS the bounded ability its turn, which '
      + 'is the whole reason to play it.',
    evidence:
      'Read at `resolveItem`\'s R86 fizzle branch (`item.label fizzles — all targets are '
      + 'gone`), which returns before `resolveParts`. Counted 61 bounded abilities with a '
      + '`targets` spec. Raised by the agent that implemented #18, which could not answer '
      + 'it without the owner; re-answered by the designer on the same day.',
    fix:
      'RULED (designer, 2026-08-23), superseding the same day\'s first answer: a FIZZLE '
      + 'SPENDS THE USE. Written up as R113, which draws the line for the whole family — '
      + 'a bounded use is spent by being USED (activated, or put on the stack), and only '
      + 'a decline, or an offer that could not be made at all, keeps it. '
      + 'The fizzle branch\'s `refundPart` loop is deleted; `E.refundPart` stays, because '
      + 'the three cast-cost decline sites still need it. Six card-level '
      + '`ctx.refundBudget()` calls moved to the other side of the line at the same time '
      + '(Auric Ascendant x2, Slag Spewer x2, Graxxlid x2) and one was split '
      + '(Structural Collapse, on whether the [cost] was actually paid).',
    proof: null,
    verify:
      'Give a bounded targeted ability a target, remove the target in response, and read '
      + '`budgets` on the source. It must still hold the reservation.',
    guards: [
      '93-engine-defects.test.ts::a bounded ability that FIZZLES for want of a target has SPENT its [once]',
      '94-bounded-uses.test.ts::a bounded trigger that is NEGATED on the stack has still spent its use',
    ],
    status: 'done',
  },
  {
    id: 21,
    area: 'engine',
    severity: 'minor',
    title: 'A [once] on a ZONE trigger is reserved on a throwaway ghost, so it bounds nothing',
    detail:
      'R51 dispatches a trigger to a card sitting in a ZONE (a bin, the hand) through '
      + '`E.standIn`, which builds a detached `Entity` with `id: -1` and a fresh '
      + '`budgets: {}`. `composeParts` writes the bounded reservation onto that object — '
      + 'which is never in `s.entities` and is thrown away the moment the trigger is '
      + 'queued. So a `bounded` zone-triggered ability reserves nothing, refunds nothing, '
      + 'and is effectively UNBOUNDED however many times it fires in a turn. '
      + 'LATENT, NOT LIVE: measured 2026-08-23, ZERO cards in the pool of 494 declare an '
      + 'ability that is both `bounded` and zone-dispatched, so nothing is wrong in a game '
      + 'today. It is here because the failure is SILENT — the next card that prints '
      + '"[Augment][once] When I am trashed …" gets an unbounded [once] and nothing in the '
      + 'suite would say so. The engine already carries a note about the ghost; what it '
      + 'does not carry is anything that fails.',
    evidence:
      '`E.standIn` (engine.ts) returns `{ id: -1, …, budgets: {} }`; `composeParts` writes '
      + '`budgetHolder.budgets[key] = 1` on the host it is handed. A census of every '
      + 'ability in the pool: 0 are both bounded and zone-dispatched.',
    fix:
      'Cheapest honest fix is a TEST, not code: assert that no registered ability is both '
      + '`bounded` and zone-dispatched, so the day someone prints one the suite fails and '
      + 'names this entry. Doing it properly means giving a zone trigger a real budget '
      + 'holder — per (seat, card name) rather than per entity, since there is no entity — '
      + 'which is a design decision about what "per card" (R9) means for a card that is '
      + 'not in play, and should not be guessed at while nothing needs it.',
    proof: null,
    verify:
      'Census: no ability with `bounded: true` also declares a `zone`. When one appears, '
      + 'this stops being latent.',
    // DONE 2026-08-24 by the entry's own "cheapest honest fix": the census is
    // a test now. SAME DAY, the PROPER fix landed too — R124 (Rotling's
    // 'leftBin' trigger is bounded AND zone-dispatched) built the real budget
    // holder this entry specified: `GameState.zoneBudgets`, per seat × card
    // name, written by composeParts' stand-in branch for zone-dispatched
    // abilities only, refunded through refundPart, wiped in startTurn,
    // serialized. The census's premise changed with it — from "ban the
    // combination" to "enumerate the population" — and its guard substring
    // below still names it.
    // ⚠ GUARD REPAIR 2026-08-25. The census guard below is a STATIC ENUMERATION
    // — it walks `getCard(name).abilities`/`augmentText` and asserts the set of
    // bounded+zone abilities equals ["Rotling (zone 'bin')"]. It never builds a
    // GameState and never touches `zoneBudgets`; the only mention of that field
    // in it is inside an assertion MESSAGE. So reverting composeParts' stand-in
    // branch to write `budgetHolder.budgets[key] = 1` onto E.standIn's throwaway
    // `budgets: {}` — i.e. restoring the exact defect in this entry's title —
    // leaves the census output byte-identical and the guard green.
    // The behavioural protection existed all along and was simply never cited.
    // This is the failure mode the audit of 2026-08-25 was looking for: the
    // structural check in 83-card-todo.test.ts can only ask whether a guard
    // EXISTS, never whether it could fail.
    guards: [
      '90-coverage-census.test.ts::no ability is both bounded and zone-dispatched',
      '43-dark-c.test.ts::Rotling: the [Switch1] bounds it once per turn',
      '43-dark-c.test.ts::zoneBudgets reservation survive a JSON round-trip',
    ],
    status: 'done',
  },
  {
    id: 22,
    area: 'engine',
    severity: 'major',
    cards: ['Mirage Walker'],
    title: 'Mirage Walker asks who has INITIATIVE, not who acted, so it misfires both ways',
    detail:
      'Its bookkeeping `when()` reads `g.s.deployPlayer === self.controller`. `deployPlayer` is '
      + 'NOT the acting seat: deployment is simultaneous and it is a derived initiative-ordered '
      + 'marker (its own comment in apply.ts says "derived sequential marker"). The predicate '
      + 'therefore reduces to "is my controller the initiative seat?" and never asks who acted. '
      + 'FALSE NEGATIVE (the reported case, EGCW turn 8): the non-initiative seat\'s own '
      + 'deployment actions are never counted, so Rashi played Mirage Walker and it still fired. '
      + 'FALSE POSITIVE: the OPPONENT applying a mod in your region sets the flag and suppresses '
      + 'your trigger though you did nothing — reachable whenever someone grafts onto your unit, '
      + 'which is exactly what happened in that same deployment. '
      + 'RULED by the owner 2026-08-23: "the idea is that YOU did something during deployment '
      + 'other than just hitting Done" — any deployment action counts, mods and ability '
      + 'activations included.',
    evidence:
      'Playtest report #86 (EGCW). Confirmed over the full seat x deployPlayer matrix: 2 of the 4 '
      + 'combinations misfire. Mirage Walker is the ONLY card in the pool that reads '
      + '`deployPlayer` (grep over src/cards/), so the class is narrow — the real class is not '
      + '"phase-begin triggers" but "entity-local when() bookkeeping with a wrong window '
      + 'predicate". The parent hypothesis that permanents generally misfire for the phase they '
      + 'entered was CHECKED AND REFUTED: fireEvent snapshots entities at the instant the event '
      + 'fires, so a late arrival has already missed it.',
    fix:
      'Do NOT patch the predicate in card code — stamp the truth in the REDUCER. Add a per-seat '
      + '`deployActed` to GameState, zeroed in E.startDeployment(), set in apply() for any '
      + 'deployment action other than doneDeploying/decide. Mirage Walker\'s when() then becomes '
      + 'a pure read and the whole bookkeeping ability can be deleted. This also fixes the '
      + 'approximation the card\'s own header admits ("pure activations with silent effects can '
      + 'slip through") and removes its dependence on region scoping and event payloads — note '
      + '`modApplied` carries no seat at all today, so the minimal card-level fix would need a '
      + 'payload change anyway.',
    proof: null,
    verify:
      'Drive playCard(Mirage Walker) in deployment for each of the four (mwSeat, deployPlayer) '
      + 'combinations and count the 3/3 tokens at end of turn. While the bug is live, the two '
      + 'combinations where deployPlayer !== mwSeat wrongly produce a token.',
    // DONE 2026-08-24, exactly per `fix`: per-seat GameState.deployActed,
    // zeroed in startDeployment, stamped at ONE choke point in apply.ts's
    // dispatch (any deployment action except doneDeploying/decide — an illegal
    // action throws and discards the stamp with the draft). The card's whole
    // bookkeeping trigger is deleted; its end-of-turn when() is a pure read.
    // Red 6/9 before the fix across the seat × deployPlayer matrix, including
    // BOTH misfire directions. CARD-TODO #23 (the 763-use deployPlayer test
    // habit) stays open — this entry's guards are the first tests in the repo
    // that drive deployment from the non-initiative seat on purpose.
    guards: [
      '14-water-a.test.ts::Mirage Walker #86: acting suppresses, idling triggers',
      '14-water-a.test.ts::Mirage Walker #86: the OPPONENT acting during deployment does not suppress the trigger',
      '14-water-a.test.ts::Mirage Walker #86: activating an ability during deployment counts as acting',
    ],
    reportId: 86,
    status: 'done',
  },
  {
    id: 23,
    area: 'coverage',
    severity: 'major',
    title: 'deployPlayer is used as "the acting seat" by 763 assertions, so seat-asymmetric deployment bugs are invisible',
    detail:
      'The guard that should have caught CARD-TODO #22 reads `const p = h.state.deployPlayer!` '
      + 'and then drives THAT seat — which is always the initiative seat right after '
      + 'toDeployment(), i.e. the one seat Mirage Walker\'s buggy predicate happens to serve '
      + 'correctly. The test is green with the bug live. '
      + 'This is not one test\'s mistake: `h.state.deployPlayer` appears 763 times across 65 test '
      + 'files as the canonical "acting seat". ANY seat-asymmetric deployment bug is therefore '
      + 'invisible to the whole suite, not just this one. Same shape as the drill\'s own trap '
      + 'list: a fixture that always picks the convenient seat is not coverage, it is a habit.',
    evidence:
      'A count of `deployPlayer` occurrences across test/. The Mirage Walker replacement test, '
      + 'parameterised over seat x deployPlayer, was confirmed red 4/4 before the fix while the '
      + 'original single-seat test stayed green.',
    fix:
      'Not a mass rewrite — most of those 763 uses are legitimately "whoever is deploying". The '
      + 'useful move is a lint-style test asserting that any card test which drives a DEPLOYMENT '
      + 'action runs from both seats, plus fixing the fixtures for cards whose behaviour is '
      + 'seat-dependent. Start from the cards whose text says "you" or "your" about a deployment '
      + 'action, since those are the ones where the two seats can differ.',
    proof: null,
    verify:
      'grep -c "deployPlayer" over test/*.test.ts, and check whether any test drives the '
      + 'NON-deployPlayer seat through a deployment action.',
    // DONE 2026-08-24: test/101-deploy-seat-matrix.test.ts drives every card
    // whose printed text ties a "you/your/ally" clause to deployment through
    // the full owner-seat × deployPlayer 4-way (the Mirage Walker shape from
    // report #86) — Bonesculptor, Gridxlan, Invasive Species, Scholar of the
    // Void, Wraith, Xzydris, Prediction Prophet, Slurpr; Mirage Walker is
    // EXEMPT with a reason (its 4-way lives in 14-water-a). The engine turned
    // out genuinely seat-symmetric (`deploying()` reads per-seat deployDone,
    // dispatch keys on controller/bin-owner), so no fix was needed — but the
    // matrix was red-checked against both classic bugs (deploying :=
    // initiative seat → 4 red; listener dispatch biased to initiative → 10
    // red), and Wraith's start-of-deployment shrink had NO test anywhere
    // before this. A sync lint scans printed.json both directions so a new
    // deployment-"you" card must join the matrix or carry a written exemption.
    guards: [
      '101-deploy-seat-matrix.test.ts::seat-matrix',
      '101-deploy-seat-matrix.test.ts::every deployment-"you" card in printed.json is in the matrix or exempt',
    ],
    status: 'done',
  },
  {
    id: 24,
    area: 'engine',
    severity: 'major',
    cards: ['Worldbender'],
    title: 'Worldbender is a vanilla 2/2 — none of its text exists, and no draft-step skip machinery does either',
    detail:
      'Printed: "Skip your draft step. When you do, draw a card. You also lose 3 life if playing '
      + 'a constructed format." The card is registered as a vanilla 2/2 {Feeble}. It has been '
      + 'carried in card-ledger.ts as `gap: dead, severity: high`. '
      + 'The owner played it and filed report #87, which finally supplies the spec that no ruling '
      + 'had settled — and the key point is that the card REPLACES the turn\'s normal card '
      + 'acquisition rather than adding to it: '
      + 'LIVE DRAFT — skip looking at the pack; draw 2 for turn + 1 for Worldbender = 3; NO life '
      + 'loss. CONSTRUCTED and CUBE — skip the draw-4-then-put-2-back; draw 2 for turn + 1 for '
      + 'Worldbender = 3; lose 3 life.',
    evidence:
      'Playtest report #87 (XVUR, 2026-08-23): "I have it in play and didn\'t skip my draft step". '
      + 'card-ledger.ts has carried the entry since the pool audit, with a {todo:true} test at '
      + '28-metal-c.test.ts::Worldbender naming exactly what was missing — neither of which can '
      + 'fail, which is why the suite stayed green while the card stayed dead. Only playing it '
      + 'surfaced it.',
    fix:
      'Build a per-seat "skip your next draft step" flag consulted by the draft step, firing the '
      + 'draw only when the skip ACTUALLY happens ("when you do" is conditional). Then branch the '
      + 'two formats per the spec above. '
      + 'TWO THINGS THE REPORT DOES NOT SETTLE and which must not be guessed: `GameMode` is '
      + "'shared' | 'draft' | 'constructed' — there is no CUBE mode to branch on, so cube "
      + 'presumably rides the constructed branch if it is ever added; and `shared` mode is not '
      + 'mentioned at all and needs its own answer.',
    proof: null,
    verify:
      'Play Worldbender in a draft game and take the draft step: while the bug is live the pack '
      + 'is still offered and no extra card is drawn. In constructed, the draw-4-put-2-back still '
      + 'happens and no life is lost.',
    // DONE 2026-08-23/24: `CardBehavior.replaceCardStep`, consulted by
    // E.startDraftStep (the seat is marked done before anyone acts and its
    // pack passes untouched) and by the constructed draw. Draft: draw 1 on top
    // of startTurn's 2, no life loss. Constructed: no draw-4-put-2-back, draw
    // 3 THEN lose 3 (a lethal 3 still leaves the cards drawn). Cube rides the
    // constructed branch the day a mode exists; shared has no card step to
    // replace, so the hook returns false. Card-ledger entry deleted in the
    // same change; report #87 flipped to fixed with the same guards.
    guards: [
      '28-metal-c.test.ts::Worldbender in a live draft',
      '28-metal-c.test.ts::Worldbender in constructed',
    ],
    reportId: 87,
    status: 'done',
  },
  {
    id: 25,
    area: 'engine',
    severity: 'major',
    cards: ['Flux Resonator'],
    title: 'Spawn-with-counters bypasses the R104 amount layer, so Flux Resonator never sees a Robot spawn',
    detail:
      'The Robot token prints "I spawn with X +1/+1 counters on me", and Caleb has ruled Flux '
      + 'Resonator applies to that placement (2025-03-21: tokens created under it enter with a '
      + 'counter, "Yep"; 2025-05-30: "it\'s just X+1 … a 2/2 robot would spawn as a 3/3"). '
      + 'E.addCounters consults `amountDelta({kind: \'counters\'…})`; E.spawnUnit sets '
      + '`u.counters = opts.counters` DIRECTLY and never asks the layer, so every '
      + '"create a Robot X" in the pool ignores an allied Resonator.',
    evidence:
      'Playtest report #88 (XVUR, 2026-08-23). Code read: spawnUnit\'s counters assignment vs '
      + 'addCounters\' amountDelta fold, engine.ts.',
    fix:
      'Fold the counters amount layer into spawnUnit at the single site where `u.counters` is '
      + 'set (opts.counters >= 1 only — zero counters is no placement), before the spawn '
      + 'announce/event so the logged number is the final one. Deliberately NOT routed through '
      + 'replaceCounters (Counter Thief redirect on a token\'s own spawn counters is unsourced).',
    proof: null,
    verify:
      'Spawn a Robot 1 with an allied Flux Resonator in the region: while the bug is live it '
      + 'enters as a 1/1 with 1 counter; fixed, a 2/2 with 2.',
    // DONE 2026-08-24, exactly per `fix`: the fold sits at spawnUnit's single
    // counters site (positive spawns only), the spawn line and 'spawned' event
    // carry the final number, the token batch records the pre-mod REQUEST so a
    // batch copy replays the creation, and replaceCounters is deliberately not
    // consulted (unsourced). Red-checked: the first three guards fail with the
    // fold removed; the last two pin non-application (enemy / counterless).
    guards: [
      '27-metal-b.test.ts::Flux Resonator: an allied Robot spawns with one more counter',
      '27-metal-b.test.ts::Flux Resonator: a Robot 2 enters as a 3/3, not a 4/4',
      '27-metal-b.test.ts::Flux Resonator: two allied Resonators give a spawn X plus TWO',
      '27-metal-b.test.ts::Flux Resonator: an ENEMY Resonator adds nothing',
      '27-metal-b.test.ts::Flux Resonator: a token that spawns with NO counters gets none',
    ],
    reportId: 88,
    status: 'done',
  },
  {
    id: 26,
    area: 'engine',
    severity: 'major',
    cards: ['Rotling', 'Writhing Host'],
    title: "Two bin removals bypassed the R124 'leftBin' choke point (mods-from-bin; the R123 grantor erase)",
    detail:
      "R124 claims E.removeFromBin is the ONE way a card leaves a bin, firing 'leftBin' "
      + '{seat, card, reason} once per card. Two sites still spliced bins directly: '
      + "(a) apply.ts zoneTake — a mod (augment or graft) applied `from: 'bin'` ran "
      + "`e.player(seat)[from].splice(index, 1)`, so no 'leftBin' fired for the applied card; "
      + '(b) the R123 erase-funded haste play — the Writhing Host grantor was spliced out of '
      + "the bin directly before the 'erased' announce. No reachable card misbehaved: Rotling, "
      + "the only 'leftBin' listener, has no augment/graft symbol and cannot leave a bin via "
      + 'either path. But the invariant and its doc were FALSE, and any future leftBin '
      + 'listener that IS a mod card would have missed its own exit silently — the '
      + '"check the guards, not the status" class this repo keeps re-learning.',
    evidence:
      'Self-found 2026-08-24 by grepping for direct bin splices against the R124 claim: '
      + 'apply.ts zoneTake bin branch and the binErase block in playAtTiming (haste branch).',
    fix:
      "Route both through the choke point: zoneTake's bin branch calls "
      + "e.removeFromBin(seat, index, 'modded') — a new reason verb, added to the R124 verb "
      + 'list in types.ts and docs/digital-rules.md — and the R123 grantor leaves via '
      + "e.removeFromBin(seat, binErase.index, 'erased'), KEEPING the site's own 'erased' "
      + 'announce (the R65 hook on that announce is what feeds the public erased pile, once). '
      + 'Plus a static conformance sweep in 90-coverage-census so the NEXT direct splice '
      + 'fails a test instead of waiting to be re-found.',
    proof: null,
    verify:
      'node --test test/90-coverage-census.test.ts — the static sweep asserts the only '
      + 'direct bin splice in src/ is inside removeFromBin itself. The behavioural guards '
      + "assert one 'leftBin' per removal on the event stream and the erased pile holding "
      + 'the grantor exactly once.',
    // DONE 2026-08-24 in the same change that found it. Red-checked: each fix
    // reverted alone makes its matching guard fail (the mod tests see zero
    // 'leftBin' events; the Writhing Host test sees zero; the static sweep
    // counts two splices instead of one), then restored.
    guards: [
      "04-mods.test.ts::graft from the bin goes through the R124 choke point",
      "04-mods.test.ts::augment from the bin goes through the R124 choke point",
      '42-dark-b.test.ts::the grantor leaves through the R124 choke point',
      '90-coverage-census.test.ts::the only direct bin splice in src is inside removeFromBin',
    ],
    status: 'done',
  },
  {
    id: 27,
    area: 'engine',
    severity: 'major',
    cards: ['Cthyrian Rector', 'Murkdrop Distiller', 'Biomass Devourer'],
    title: "A 'trashed' responder finds its card by lastIndexOf(name), not by R131's binNth",
    detail:
      'R131 put `binNth` on the trashed event precisely because a bin holds bare card NAMES, so '
      + 'identity there is (name, nth occurrence) — "copies of one card are genuinely '
      + 'indistinguishable". The cards that RESPOND to a trash never read it. They re-find the '
      + 'card with `g.player(seat).bin.lastIndexOf(name)`, which answers "the last copy of that '
      + 'name in the bin right now" — a different question. The two answers diverge whenever the '
      + 'trashed copy has LEFT the bin before the responder resolves, which is exactly what a '
      + 'state-based erase does: the trigger goes on the stack, the erase sweeps the copy, and on '
      + 'resolution lastIndexOf lands on an INNOCENT older copy of the same name. Cthyrian Rector '
      + 'then recalls the wrong card to hand (having already paid a sacrifice), and Biomass '
      + 'Devourer erases the wrong card outright — a card leaving the game permanently by '
      + 'mistake. ~13 sites use the lastIndexOf idiom; only the ones reacting to an event that '
      + 'carries binNth are wrong, so this needs classifying site by site, not a blanket rewrite '
      + '(Lurking Dread and Xzydris ask "is my own name in my bin", which lastIndexOf answers '
      + 'correctly).',
    evidence:
      'Found 2026-08-24 by the R137 agent while pinning the two bin-reaching hazards for playtest '
      + 'report #93, and confirmed by reading batch-dark-c.ts:262 (Rector) and batch-metal-a.ts:384 '
      + '(Biomass Devourer) against E.noteTrashed. R137 did NOT create it — a dying TOKEN already '
      + 'bins, trashes and is swept, so the window has always existed — but R137 widened it a lot, '
      + 'because every modded unit death now opens the same window. Deliberately left unfixed in '
      + 'R137 so a reversible ruling and an unrelated pre-existing bug did not land in one commit.',
    fix:
      "Pass R131's binNth through to the responders and index with it instead of searching by "
      + 'name: the trashed event already carries {seat, card, binNth}, so a responder wants '
      + '`bin[binNth] === name ? binNth : -1` and must treat the mismatch as "gone" rather than '
      + 'falling back to a search. Classify all ~13 lastIndexOf sites first and fix only those '
      + 'driven by an event that carries an index. Then pin it the way this repo pins invariants: '
      + 'a static sweep in 90-coverage-census asserting no card reacting to a binNth-carrying '
      + 'event resolves its target by lastIndexOf, so the next one fails a test instead of being '
      + 're-found.',
    proof: () => {
      // TRUE while a 'trashed' responder still resolves its card by name-search.
      //
      // Two ways this proof has already lied, both worth keeping in view:
      //  1. The first draft read JSON.stringify(augmentText) — which DROPS
      //     FUNCTIONS, so it silently answered false and the suite reported the
      //     bug fixed while the code was untouched. Read `run.toString()`.
      //  2. toString() KEEPS COMMENTS, so a comment merely *mentioning*
      //     lastIndexOf held this true after the code stopped using it. R140's
      //     own census sweep hit the identical trap on the same day. Strip
      //     comments and strings first: measure CODE, never prose.
      const at = (getCard('Cthyrian Rector').augmentText ?? []) as Array<
        { effect?: { run?: (...a: never[]) => unknown } }>;
      const src = at.map(t => t.effect?.run?.toString() ?? '').join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");
      return src.includes('lastIndexOf');
    },
    status: 'done',
    guards: [
      '43-dark-c.test.ts::R140: the Rector does NOT recall an innocent older copy',
      '43-dark-c.test.ts::R140: the Distiller does NOT cache an innocent older copy',
      '43-dark-c.test.ts::R140: eraseFromZone can be told WHICH bin slot to take',
      '26-metal-a.test.ts::R140: Biomass Devourer does NOT erase an innocent older copy',
      '26-metal-a.test.ts::R140: a stolen unit dies',
      '90-coverage-census.test.ts::R140: no card responding to a bin-index event re-finds its card by lastIndexOf',
    ],
  },
  // ── the SMVJ batch (2026-08-24 afternoon, reports #94-#102) ───────────
  // Nine reports arrived while round 22 was being worked. None is a card
  // doing the wrong thing except CT-29/CT-30; the rest are the client and two
  // rules questions. Each carries `reportId` so 83's cross-check binds them.
  {
    id: 28, area: 'client', severity: 'minor', reportId: 94,
    title: 'The stack resolves faster than a human can read it',
    detail:
      'With auto-yield on and nothing to respond to, the whole stack resolves in one frame. The '
      + 'log scrolls past and a player cannot tell WHY the board changed. Owner proposes a ceiling '
      + 'of about one item per second.',
    evidence: 'Owner report #94, room SMVJ, action 104.',
    fix:
      'A throttle in the CLIENT render/animation layer, replaying the event list it already '
      + 'receives. The engine is pure and must NOT learn about wall-clock time — putting a delay '
      + 'in the reducer would make replay and the test suite time-dependent. Likely a queue in '
      + 'ui/main.ts that drains events on a timer, with a skip/fast-forward affordance so a player '
      + 'who does not want the pacing is not held hostage by it.',
    proof: null,
    verify: 'Play a battle with auto-yield on and a multi-item stack; the items should appear one '
      + 'at a time at a readable rate rather than all at once.',
    // CLOSED by R150. ui/pace.ts, clock injected, PACE_MS the single named knob — the engine
    // never learns about wall-clock time, so replay-room.ts and the suite stay deterministic.
    // ⚠ THE LESSON OF THE ROUND, recorded because it nearly shipped: the decisions WERE lifted
    // into a pure module and 14 tests passed, and the pacing was still WRONG — it spaced from
    // the waiting queue, which empties between real server updates, so nothing was ever held.
    // A headless-Chrome run against a live two-seat game is what caught it. The queue carries
    // `last` now and there is a DRIP test beside every BURST test. Lifting a decision into a
    // testable function does not tell you that you tested the right thing.
    guards: [
      '128-ui-pace.test.ts::a BURST of updates surfaces ONE per PACE_MS, on an injected clock',
      '128-ui-pace.test.ts::a DRIP is throttled too — the queue emptying is not a reset',
      '128-ui-pace.test.ts::skip flushes the whole queue to the live state in ONE step',
      '128-ui-pace.test.ts::an urgent arrival FLUSHES the backlog rather than jumping it',
      '128-ui-pace.test.ts::a decision of MINE is never held',
    ],
    status: 'done',
  },
  {
    id: 29, area: 'card', severity: 'major', reportId: 95, cards: ['Hush Mush'],
    title: 'Hush Mush hands over control as a TRIGGER; the card says it is part of the spell',
    detail:
      'Printed: "Negate target effect. Its controller gains control of me." One spell resolution, '
      + 'no ability. The engine implements the handover as a `triggered` ability on the body\'s own '
      + '`spawned` event, passing the seat through battleCounters[HUSH_KEY], so the body spawns '
      + 'under the CASTER and changes hands a step later. The intermediate state is observable '
      + '(see CT-30) and a trigger can be responded to or suppressed where spell resolution cannot.',
    evidence: 'Owner report #95, room SMVJ, action 123. Confirmed by reading '
      + 'src/cards/sets/batch-wood-a.ts (card definition at ~line 506) against the printed text.',
    fix:
      'Spawn the body already under the negated effect\'s controller instead of handing it over. '
      + 'R107 (owner != controller on spawnUnit) is exactly this primitive and already exists, so '
      + 'this should DELETE the triggered ability and the HUSH_KEY battleCounters handoff rather '
      + 'than add machinery. Check the header note in batch-wood-a.ts about two Hush Mushes in one '
      + 'battle before removing the ledger key.',
    proof: () => {
      // TRUE while the handover is still a separate triggered ability
      const abil = (getCard('Hush Mush').abilities ?? []) as Array<{ type?: string }>;
      return abil.some(a => a.type === 'triggered');
    },
    status: 'done',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
  },
  {
    id: 30, area: 'card', severity: 'major', reportId: 96, cards: ['Hush Mush', 'Flourishing Flora'],
    title: 'Hush Mush briefly spawns as the CASTER\'s ally, firing their ally-spawn watchers',
    detail:
      'The observable half of CT-29, and the reason it is not cosmetic. Flourishing Flora is '
      + '"[Augment] Whenever another ally spawns, put a +1/+1 counter on me." Because Hush Mush '
      + 'enters under the caster and only then changes hands, the caster\'s ally-spawn watchers '
      + 'fire on a unit that was never meant to be theirs, and the caster gets a counter. WIDER '
      + 'THAN THE ONE CARD: every "whenever an ally spawns" watcher can see this intermediate '
      + 'state; Flourishing Flora is just the one that happened to be on the board.',
    evidence: 'Owner report #96, room SMVJ, action 123 — the owner refused a counter he could see '
      + 'was wrong. Same action index as #95: cause and symptom, reported one minute apart.',
    fix: 'Fixing CT-29 fixes this: if the body never enters under the caster, no ally-spawn '
      + 'watcher of theirs can observe it. Pin it with a test that puts Flourishing Flora on the '
      + 'CASTER\'s board and asserts it gains NO counter when Hush Mush resolves.',
    proof: null,
    verify: 'Control Flourishing Flora, cast Hush Mush negating an opponent effect: Flora must not '
      + 'gain a counter, and the body must appear on the opponent\'s side without a handover step.',
    status: 'done',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
  },
  {
    id: 31, area: 'client', severity: 'minor', reportId: 97,
    title: 'Dormant resources read as active outside planning',
    detail:
      'A dormant resource cannot be spent until it activates, but it is drawn similarly enough to '
      + 'an active one to be miscounted mid-battle, when a player is totting up available mana '
      + 'under time pressure.',
    evidence: 'Owner report #97, room SMVJ, action 149.',
    fix: 'Phase-scope the presentation, per the owner\'s own proposal: de-emphasise or hide '
      + 'dormant resources during battle and deployment, and show them normally during planning, '
      + 'which is the phase you actually act on them in. Presentation only — no engine change.',
    proof: null,
    verify: 'During battle, dormant resources must be visually distinct from (or absent beside) '
      + 'active ones; during planning they appear as they do today.',
    // CLOSED by R151. ui/resources.ts::resourceRow returns a DOM-free view model with a
    // discrete `emphasis` per resource, so the muting is asserted rather than being a CSS
    // colour nobody can test. `spendable`/`active` are read from E.openMana and E.affinity —
    // NOT re-derived in the UI — so a future rules change cannot desync the two (R132 just
    // moved this surface once already).
    guards: [
      '127-token-x-and-dormant.test.ts::dormant resources are muted in battle and deployment, normal in planning',
      '127-token-x-and-dormant.test.ts::only DORMANT is muted — an expended resource is not',
      '127-token-x-and-dormant.test.ts::the spendable/dormant split is the ENGINE',
    ],
    status: 'done',
  },
  {
    id: 32, area: 'client', severity: 'minor', reportId: 98,
    title: 'One player resolving triggers blocks the other player\'s simultaneous deployment',
    detail:
      'Deployment is SIMULTANEOUS — both players act and moves are revealed when both are done — '
      + 'so an opponent working through a pile of start-of-combat triggers should not seize your '
      + 'screen or block your input while you deploy.',
    evidence: 'Owner report #98, room SMVJ, action 238 (a stack of Wraith triggers).',
    fix: 'Client concurrency: the opponent\'s trigger resolution should render without taking '
      + 'input focus or gating the local deploy UI. Related to CT-35, which is the rules-side '
      + 'proposal for the same pile of triggers.',
    proof: null,
    verify: 'While the opponent resolves start-of-combat triggers, you can still place and confirm '
      + 'deployment moves without waiting.',
    // CLOSED by R150 — and the diagnosis reversed my brief, which said to suspect the
    // presentation layer. It is the RULES layer: apply.ts's global `if (e.s.decision && …)`
    // gate refuses every non-decide action from EITHER seat, and legalActions returns [] to
    // the seat that does not own the decision. The client's "Waiting for X…" bar was a
    // faithful drawing of an empty legal list — un-gating the UI alone would have turned a
    // frozen screen into a screen full of refusals. Reachable only since R144 put
    // start-of-deployment triggers on the stack. CT-28 and CT-32 do NOT share a root cause.
    // Fixed at the server (legalForSeat + a deferral queue) because the engine gate is CORRECT
    // in battle, where priority is sequential. ⚠ That makes it a COMPENSATION, not the real
    // fix: hotseat still freezes, because Harness goes through apply() directly. Carried as
    // CT-44 — the gate should become seat-aware during simultaneous phases.
    guards: [
      'server/test-concurrency.ts::seat 0 is still offered actions while seat 1 is mid-question — the whole of #98',
      'server/test-concurrency.ts::deploy action is DEFERRED, not refused',
      'server/test-concurrency.ts::and it is the SAME set of action kinds they had a moment earlier',
      'server/test-concurrency.ts::seat 1 is mid-question in the authoritative state',
    ],
    status: 'done',
  },
  {
    id: 33, area: 'client', severity: 'minor', reportId: 99,
    title: 'A token created with X=5 still prints a literal "X" in its text box',
    detail:
      'The value is known when the token is created, but the box shows the generic printed text, '
      + 'so the player must remember what it was made for. Owner: a Poison 5 should read "Put 5 '
      + '-1/-1 counters on target unit". NOT the markup class (R134/R141/R142) — nothing is failing '
      + 'to be consumed here; this is a live per-instance VALUE that should be substituted in.',
    evidence: 'Owner report #99, room SMVJ, action 264.',
    fix:
      'Decide where the substitution lives: stamped onto the token entity at creation, or done by '
      + 'the text box reading the entity\'s stored X. Prefer the latter — the printed text stays '
      + 'the printed text and only the DISPLAY specialises, which keeps printed.json (generated) '
      + 'and the per-instance value from being confused. Applies to every X-valued token, not just '
      + 'Poison.',
    proof: null,
    verify: 'Create a Poison with X=5; its text box reads "5", not "X".',
    // CLOSED by R151, and the reason it is a RENDER-TIME substitution rather than a stamp at
    // creation is Robot: "if the number of counters changes, so does the X value", so a Robot 3
    // that gains a counter IS a Robot 4 and a frozen X starts lying immediately. X comes from
    // Entity.x for a spell token and from live COUNTERS for a unit token. Reminder text ({i}…)
    // is carved out — substituting there gives Robot "so does the 3 value", a broken sentence.
    // Census first, per R141: the pool spells it X, X/X, +X/+X, -X/-X and [x] (a cost PIP), and
    // only the bare X moves. 4 of the 6 token cards carry one; the sweep pins that census.
    guards: [
      '127-token-x-and-dormant.test.ts::a Poison created with X=5 says',
      '127-token-x-and-dormant.test.ts::sweep: EVERY token card with an X placeholder renders a number',
      '127-token-x-and-dormant.test.ts::a Robot reads its X off its COUNTERS',
      '127-token-x-and-dormant.test.ts::are STAT notation and never substituted',
    ],
    status: 'done',
  },
  {
    id: 34, area: 'client', severity: 'major', reportId: 100,
    title: 'The R120 elective damage-split UI is confusing',
    detail:
      'The mechanic is right — R120 made the combat damage split ELECTIVE because "never decide '
      + 'for the player" — but the affordance is not. Owner: "terrible and confusing".',
    evidence: 'Owner report #100, room SMVJ, action 290.',
    fix:
      'The owner names it exactly: a per-unit up/down ticker, constrained so the assignments '
      + 'always sum to the damage available. ⚠ REUSE, do not rewrite: R139/BL-25 just built this '
      + 'shape for counter removal — a stepper with a max asked of the engine, clamped, an "All" '
      + 'that sets without submitting — lifted into ui/inspect.ts precisely so it is testable. A '
      + 'second independent stepper implementation is how the two drift apart.',
    proof: null,
    verify: 'Assign combat damage across several blockers with steppers; the total is forced to '
      + 'match the damage available and nothing submits until you confirm.',
    // CLOSED by R149 — but NOT in the shape the report asked for, and that matters. The engine
    // (E.electionWalk) asks ONE victim at a time, front to back; each decision is a single
    // scalar and the last living victim is auto-filled. So no decision ever carries N victims,
    // the sum is forced by construction upstream of any client, and an over-allocation is not
    // representable rather than refused. What the player was missing was the ARITHMETIC: the
    // old bar was a flat wall of "1 to X / 2 to X / 3 to X" with no running total and no sign
    // another question was coming. Built on the SHARED quantityStepper lifted out of BL-25's
    // counterStepper, not a second one — BL-19 is what happens when one control is hand-copied.
    guards: [
      '126-assign-split.test.ts::the total is forced',
      '126-assign-split.test.ts::the ticker clamps to what THIS victim can take',
      '126-assign-split.test.ts::jumps to everything-left and does NOT submit',
      '126-assign-split.test.ts::NEGATIVE CONTROL',
    ],
    status: 'done',
  },
  {
    id: 35, area: 'engine', severity: 'major', reportId: 101,
    title: 'RULES QUESTION: should deployment use the stack, and may triggers over-target?',
    detail:
      '⚠ A RULES CHANGE, not a defect, and the largest item in this batch. Owner: "Deployment '
      + 'should use the stack. All Wraith triggers should go onto the stack simultaneously and be '
      + 'allowed to target the same unit, even exceeding its defense (the final triggers would '
      + 'just fizzle)." Two separable claims: (a) deployment-phase triggers use the STACK like '
      + 'everything else; (b) several may target the SAME unit even when the total exceeds what it '
      + 'can absorb, the surplus fizzling ON RESOLUTION rather than being prevented at targeting '
      + 'time. (b) is the load-bearing half — it says targeting must not pre-validate against a '
      + 'limit that earlier-resolving triggers may consume, which is the ordinary fizzle rule.',
    evidence: 'Owner report #101, room SMVJ, action 318.',
    fix:
      'DO NOT START until the owner confirms scope — this touches the deployment phase, the stack '
      + 'and every start-of-deployment trigger, and (b) may change existing targeting restrictions '
      + 'across the pool. Get a ruling number, then split (a) and (b) into separate commits so '
      + 'either can be reverted alone.',
    proof: null,
    verify: 'Owner ruling required before implementation.',
    status: 'done',
    guards: [
      '37-attrs-wight.test.ts::R144(a): every start-of-deployment trigger is on the stack before any of them resolves',
      '37-attrs-wight.test.ts::R144(b): three Wraith triggers may all aim at one 1/1, and the surplus fizzles',
      '37-attrs-wight.test.ts::does not pre-validate against a limit an earlier trigger will consume',
      '37-attrs-wight.test.ts::a subject is not a target',
      '37-attrs-wight.test.ts::R12 — a shared deployment stack does not let a Wraith reach across regions',
      '67-resolving-and-stack-viruses.test.ts::a NESTED resolution that suspends does not strand the outer marker',
    ],
  },
  {
    id: 36, area: 'client', severity: 'major', reportId: 102,
    title: "Caleb's formatting markup reaches the player: literal '/[', {i1} eating spaces",
    detail:
      'Owner: the {i}/{g}/"/" family is "pure engine markup used by some system Caleb uses to '
      + 'format cards better", so none of it may reach a player. Three renderer defects: "/[" '
      + 'prints literally on ~15 cards; consuming {i1} EATS THE ADJACENT SPACE, so Wither and '
      + 'Bloom renders "each enemy orput a +1/+1"; and a {/n} nested inside an unrecognised '
      + 'bracket never becomes a line break. Plus a DATA half — printed.json carries 49 cards with '
      + 'double spaces and 4 with layout hyphenation ("adja- cent", "oppo- nent" x3).',
    evidence:
      'Owner report #102, room SMVJ, action 341. Census of the whole pool: formatting family is '
      + '{i} 80, {/n} 73, {g} 8, {i1} 6, {/i} 5, {p} 2; the ~30 capitalised tokens are KEYWORD '
      + 'names and must keep showing. "/" settled: it occurs only as "/[…]" directly after a '
      + '[Switch1]/[Switch] marker, and is NOT the "/" of X/X or +1/+1 stat notation.',
    fix:
      'Renderer half in ui/cardtext.ts, with a whole-pool sweep over text AND type lines so no '
      + 'formatting token or "/[" can survive again. Data half in scripts/extract-printed.mjs — '
      + 'printed.json is GENERATED, so a hand edit there is silently wiped on the next '
      + 'regeneration. Linked Extinction\'s "Sacrifce a unit" was a typo in CALEB\'S SOURCE: the '
      + 'owner corrected it AT SOURCE on 2026-08-24 ("that\'s a typo in the backend"), in the '
      + 'oracle file, not by an extractor override. The general invariant replaced the '
      + 'single-card record: the extractor may change LAYOUT but never a word.',
    proof: null,
    verify: 'Render every card\'s text and type line: no {i}/{/i}/{i1}/{g}/{p}/{/n} and no "/[" '
      + 'survives, while X/X and +1/+1 are untouched and {Battle}/{Virus}/{Haste} still show.',
    status: 'done',
    guards: [
      '122-cardtext-markup.test.ts::R142: the /[…] box drops the slash and the brackets',
      '122-cardtext-markup.test.ts::R142: {i1} does not eat the space beside the word',
      '122-cardtext-markup.test.ts::R142: no card in the pool renders engine markup to a player',
      '122-cardtext-markup.test.ts::R142: no printed card carries a hyphenation artifact',
    ],
  },
  // ── found by R143's pool sweep (2026-08-24), not by a report ──────────
  {
    id: 37,
    area: 'card',
    severity: 'major',
    cards: ['Borrower of Forms', 'Nectar Ridge Oracle'],
    title: 'Borrower of Forms ENTERS as itself and only then becomes the copy',
    detail:
      'The same defect class as CT-29, one layer over: IDENTITY instead of CONTROL. Its spell '
      + 'parks the copied face and stats on a region ledger (`bof:*`) and its own `spawned` '
      + 'trigger claims them, so the body enters play as a plain Borrower of Forms and only '
      + 'afterwards becomes the thing it copied. Anything watching the spawn sees the wrong body. '
      + 'Nectar Ridge Oracle — "when an ally with greater defense than power spawns", which is '
      + "R1's own worked example — reads the pre-copy stats, and the player is asked a spurious "
      + 'trigger-ordering question that should not exist.',
    evidence:
      'Found 2026-08-24 by the R143 agent sweeping every giveControl / cross-seat spawn / '
      + 'opts.owner site in the pool after fixing Hush Mush. batch-metal-a.ts:477.',
    fix:
      'The same shape R143 used: carry the answer on the spell\'s own StackItem and apply it AS '
      + 'the body spawns, rather than parking it on a shared region ledger for a follow-up '
      + 'trigger to claim. R143 added `ctx.spawnUnder(seat)` for the controller; this wants the '
      + 'equivalent for the copied face/stats. Deletes the trigger and the ledger, as R143 did.',
    proof: () => {
      // TRUE while becoming the copy is still a separate triggered ability on
      // the body's own spawn — which is the whole defect: a trigger cannot run
      // before the event that raised it, so the body has to enter as itself
      // first. R147 deleted it; `abilities` is now empty.
      const abil = (getCard('Borrower of Forms').abilities ?? []) as Array<{ type?: string }>;
      return abil.some(a => a.type === 'triggered');
    },
    verify:
      'Control a Nectar Ridge Oracle; cast Borrower of Forms copying something with greater '
      + 'defense than power. The Oracle must see the COPIED body, and no trigger-ordering '
      + 'question should be raised.',
    status: 'done',
    guards: [
      // no apostrophe in the needle: the title scanner reads the SOURCE, so an
      // escaped `\'` in a test name is a backslash the needle would have to match
      '26-metal-a.test.ts::watcher sees the COPIED body, not Borrower of Forms',
      '26-metal-a.test.ts::R147: becoming the copy is NOT a trigger',
      '26-metal-a.test.ts::R147: the body wears the borrowed IDENTITY from the instant',
      '26-metal-a.test.ts::R147 (negative control): a Borrower whose target is gone',
      '26-metal-a.test.ts::R147: two Borrowers of Forms in ONE region',
    ],
  },
  {
    id: 38,
    area: 'engine',
    severity: 'major',
    cards: ['Mindspore Fiend', 'Organic Exchange', 'Download'],
    title: 'Three cards flip `controller` by raw assignment, bypassing E.giveControl',
    detail:
      'E.giveControl is the choke point for a control change: it propagates the new controller to '
      + "the unit's MODS, unslots it from the old formation and moves it to the new region. Three "
      + 'cards assign `controller` directly and skip all of it. Mindspore Fiend '
      + '(batch-wood-b.ts:121) is the worst: it skips the formation unslot and the region move as '
      + 'well, so it hands over a unit whose MODS STILL ANSWER TO THE OLD CONTROLLER. Organic '
      + 'Exchange (batch-wood-b.ts:224) and Download (batch-metal-a.ts:865) skip the mod '
      + 'propagation. Nothing reported this — it was found by sweep — so the failure is latent, '
      + 'not yet observed at a table.',
    evidence: "Found 2026-08-24 by the R143 agent's sweep of every control-change site in the pool.",
    fix:
      'Route all three through E.giveControl. Then pin the invariant the way R124 pinned the bin '
      + 'choke point: a STATIC sweep in 90-coverage-census asserting that the only assignment to '
      + '`.controller` on a unit in src/cards/ is inside giveControl itself, so the next bypass '
      + 'fails a test instead of waiting to be swept up.',
    // FIXED 2026-08-25 (R148). All three route through E.giveControl now, and
    // the sweep is a test. TWO corrections to the entry above, from reading the
    // three call sites rather than trusting the description:
    //
    //  · Mindspore Fiend did NOT skip a reachable "region move". It picks its
    //    recipient out of `presentSeats(g, ctx.region)`, so the new controller
    //    is a seat present in the unit's region BY CONSTRUCTION and
    //    giveControl's exclusivity branch cannot fire from there. What it
    //    really skipped was the mods and the formation unslot. (It also
    //    carried a card-local note claiming the formation slot was kept on
    //    purpose; that note had nothing behind it and described exactly the
    //    state the choke point exists to prevent — the afterWindow priority is
    //    still to come — so it went with the fix.)
    //  · Organic Exchange must NOT be unslotted, and that is not a bypass: an
    //    exchange re-slots both units into each other's places, which keeps
    //    every unit in a formation its new controller owns. giveControl grew
    //    `{ keepFormation: true }` for it — the one caller in the pool that
    //    passes it. Its symmetric REGION swap was dead code (both targets come
    //    from one region's `unitsIn`) and is gone.
    proof: () => /[A-Za-z_$][\w$]*\.controller\s*=(?!=)/
      .test(setSrc('batch-wood-b.ts') + '\n' + setSrc('batch-metal-a.ts')),
    verify:
      'Give a MODDED unit away with Mindspore Fiend: the mods must answer to the new controller, '
      + 'and the unit must leave the old formation.',
    guards: [
      '24-wood-b.test.ts::Mindspore Fiend gives away a MODDED blocker',
      '24-wood-b.test.ts::Organic Exchange hands over MODDED units',
      '26-metal-a.test.ts::Download steals a MODDED unit token',
      '90-coverage-census.test.ts::R148 stays solved',
    ],
    status: 'done',
  },
  {
    id: 39,
    area: 'engine',
    severity: 'minor',
    title: 'No event fires when a unit changes controller',
    detail:
      "E.giveControl emits only an `info` line, so nothing in the pool can trigger on \"a unit "
      + 'changed controller\". No printed card needs it TODAY — this is a missing seam, recorded '
      + 'so the next card that prints "whenever you gain control of a unit" is a small change '
      + 'rather than a surprise.',
    evidence: "Found 2026-08-24 by the R143 agent's control-change sweep.",
    fix:
      "Emit a real typed event from giveControl (both seats' listeners, region-scoped per R12) "
      + 'and add it to the event vocabulary that 84-card-semantics reads. Do it WITH the first '
      + 'card that needs it, not before — an event nothing listens to is untested surface.',
    // DONE 2026-08-25 (R148), and the "do it with the first card that needs
    // it" instruction was deliberately overruled rather than ignored. Its
    // objection was that the event would be untested surface. CT-38 removed
    // that objection in the same commit: three real printed cards now route a
    // control change through giveControl, so the event has three drivers that
    // can be observed today, and the tests below drive it through all three.
    // What remains untested is only the LISTENING half — no card prints
    // "whenever you gain control of a unit" yet — and that half is
    // `fireEvent`'s, shared with every other dispatched event in the union.
    //
    // `controlChanged` carries the log line giveControl used to emit as plain
    // `info`, so it is not a signal-only event and the game log is unchanged.
    // The two "nothing changes hands" branches still emit `info` and dispatch
    // nothing, because no controller changed.
    proof: () => !fs.readFileSync(path.join(SRC_DIR, 'types.ts'), 'utf8').includes("| 'controlChanged'"),
    verify:
      'Steal a unit with Download in a region both seats are in: an event of type '
      + "'controlChanged' must appear, carrying { unit, card, from, to, region }.",
    guards: [
      '24-wood-b.test.ts::Mindspore Fiend gives away a MODDED blocker',
      '24-wood-b.test.ts::Organic Exchange hands over MODDED units',
      '26-metal-a.test.ts::Download steals a MODDED unit token',
      '24-wood-b.test.ts::an UNMODDED control change behaves exactly as it did before R148',
    ],
    status: 'done',
  },
  // ── found by the R146 sweep of bin entries written by CARD code ───────
  {
    id: 40,
    area: 'card',
    severity: 'major',
    cards: ['Hooba-Mon'],
    title: "Hooba-Mon's exchange binned an {Unstable} body and left it there",
    detail:
      '"[Augment] When I attack, you may exchange me for target unit in your bin with cost 3 or '
      + 'less." The exchange sends the outgoing body to its owner\'s bin FROM PLAY, and '
      + '`exchangeInPlace` pushed the card and trashed it and stopped. On the AUGMENT line — the '
      + 'line the card is printed for — `self` is the HOST WEARING Hooba-Mon, so it carries a mod '
      + 'and is {Unstable} by derivation (R69/R79). R137/R145: an Unstable card leaving an active '
      + 'zone into a bin is binned, trashed there, and then SWEPT into the erased pile. This one '
      + 'stayed in the bin instead — fully recurrable, and still counting toward every "cards in '
      + 'your bin" effect and every "erase X from your bin" cost. It was the only bin entry in '
      + 'card code that disagreed with E.destroy about the same disposal.',
    evidence:
      'Found 2026-08-25 by the R146 audit of every site in src/cards/ that writes to a bin '
      + 'without going through E.toBin or E.destroy. Two sites; this was one of them.',
    fix:
      'FIXED 2026-08-25 (R146). `exchangeInPlace` asks `g.isUnstable(self)` BEFORE deleting the '
      + "host's mods (isUnstable derives from `self.mods`), then follows destroy()'s statement "
      + 'order exactly: push, `noteTrashed`, and — when Unstable — `eraseFromZone(..., "bin", '
      + '{ index })` naming the slot it just pushed (R140, never a name search). A TOKEN host is '
      + 'unchanged: no card, so nothing to bin, trash or erase.',
    proof: null,
    verify:
      'Augment Hooba-Mon onto a host, attack, and take the exchange: the HOST card must fire a '
      + '`trashed` event and then an `erased` one, in that order, and must not be in the bin '
      + 'afterwards. Played NORMALLY (unmodded) it must still be binned and stay there.',
    guards: [
      '42-dark-b.test.ts::Hooba-Mon exchanges a MODDED host',
      '42-dark-b.test.ts::Hooba-Mon exchanges an UNMODDED host',
      '42-dark-b.test.ts::Hooba-Mon exchanges a TOKEN host',
    ],
    status: 'done',
  },
  {
    id: 41,
    area: 'card',
    severity: 'major',
    cards: ['Tides of the Cosmos', 'Collect Remains', 'Suspend', 'Temporal Rift'],
    title: 'A spell played free by Tides of the Cosmos could not obey its own "Erase me."',
    detail:
      '`playInline` (batch-water-a) — the shared "play this card as part of my resolution" helper '
      + 'behind Tides of the Cosmos, Hooba-Pon, Insidious Invitation and Spell Excavation — passed '
      + '`eraseSelf: () => {}` to the effect it ran, with the comment "an inline mod run has no '
      + 'stack item to erase". True about the mechanism, wrong as an answer: Collect Remains, '
      + 'Suspend and Temporal Rift each print a self-erase sentence, and played for free off the '
      + 'top of the deck by Tides they were BINNED and stayed recurrable. This is CARD-TODO #15 '
      + 'over again on a second route — and hidden the same way, because the other half of each '
      + "card worked. Tides also wrote its bin entry as a raw `bin.push`, bypassing E.toBin.",
    evidence:
      'Found 2026-08-25 by the R146 audit of bin writes in src/cards/, which turned up the raw '
      + 'push and then the swallowed eraseSelf one line above it.',
    fix:
      'FIXED 2026-08-25 (R146). `InlinePlay` carries an `eraseSelf` flag: playInline records the '
      + 'request and the CALLER, which is what decides where the card goes, honours it — the same '
      + 'split `StackItem.eraseSelf`/`dischargeItem` uses. Tides erases instead of binning when it '
      + 'is set, and otherwise goes through `E.toBin(..., "stack")`. The other three call sites '
      + 'were checked: Hooba-Pon and Insidious Invitation only reach their disposal on a FIZZLE, '
      + 'where the effect never ran and the flag cannot be set, and Spell Excavation never bins '
      + 'what it played (R96).',
    proof: null,
    verify:
      'Stack Suspend on top of the deck and cast Tides of the Cosmos; take Suspend as a free play. '
      + "It must reach the caster's erased pile and must not appear in the bin.",
    guards: [
      '15-water-b.test.ts::for free → the ERASED pile',
      '15-water-b.test.ts::Tides plays an ORDINARY spell for free',
    ],
    status: 'done',
  },
  {
    id: 42,
    area: 'engine',
    severity: 'major',
    cards: ['Aberrant Statweaver', 'Oorblak'],
    title: 'Printed {Unstable} was invisible to every STACK exit — the bin-entry twin of CT-26',
    detail:
      'R145 (owner, 2026-08-25): "in play and the stack are active zones (which is relevant for '
      + 'cards that have unstable). When Statweaver, which has Unstable naturally, gets negated '
      + 'from the stack, it should be erased." Report #89 gave printed {Unstable} a carrier and '
      + 'taught E.isUnstable to read it — but only for the IN-PLAY half. The stack had no '
      + 'equivalent reader at all: E.negate and E.dischargeItem each rebuilt the predicate by '
      + 'hand as `(item.augments?.length ?? 0) > 0 || item.unstable === true`, and neither ever '
      + "consulted the printed face, while resolveItem's two virus-fizzle branches called "
      + "`toBin(item.controller, item.card!, 'stack')` RAW and skipped dischargeItem entirely. "
      + 'Four sites, one missing question. Both cards are {Virus} {Unstable} deploy units, and '
      + 'the battle-Virus augment is their ONLY route to the stack (the deploy branch of '
      + "doPlayCard casts with `then: 'resolve'`, so there is no stack window), so a negated or "
      + 'fizzling Statweaver binned. ⚠ The other half of the ruling is a NEGATIVE: hand, deck, '
      + 'bin and cache are INACTIVE zones, so a printed-Unstable card discarded, milled or '
      + 'binned from the cache still bins AND trashes — that closes the question playtest '
      + 'report #89 left explicitly open.',
    evidence:
      'Owner ruling 2026-08-25, plus Caleb rules-questions 2025-09-13 (Spell Excavation: "so '
      + 'they would be erased if you used something like this and it got negated") and its '
      + 'negative control 2025-03-31 ("Negating an augment puts it in the bin or erase?" → '
      + '"Into the bin"). Reproduced at a4ecc5c on both routes: Statweaver played as a battle '
      + 'Virus and negated, and the same item fizzling when its host died.',
    fix:
      'A stack twin of isUnstable — `E.itemIsUnstable(item)` — unioning the three ways in '
      + '(augments; the R96/R105 stamp; the PRINTED face, read only for the NEGATE_BINS kinds, '
      + "because a triggered ability's `card` names its still-in-play SOURCE). negate() and "
      + 'dischargeItem() both read it instead of recomputing it, and the two virus-fizzle sites '
      + 'route through dischargeItem so all three stack exits share one predicate. Plus a static '
      + 'sweep in 90-coverage-census: every `.bin.push(` in src/ must be inside toBin, destroy '
      + 'or the leavePlay mods line — the bin-ENTRY twin of CT-26/R124\'s bin-EXIT sweep. '
      + '⚠ That sweep carries a dated two-line exemption for batch-dark-b.ts:437 and '
      + 'batch-water-b.ts:572, which are owned by a different agent in the same round; when '
      + 'those land the exemption entries must be DELETED (the sweep fails on a stale one). '
      + 'Do not re-file those two as a new todo item — they are already claimed.',
    proof: null,
    verify:
      'node --test test/125-active-zone.test.ts — four positives (Statweaver and Oorblak '
      + 'negated; Statweaver fizzling when its host dies; a modded ordinary spell, the R79 '
      + 'regression pin) and six negatives (a non-Unstable virus negated still bins; discard, '
      + 'mill and cache still bin AND trash; a recall still reaches the hand; a modded unit\'s '
      + 'column-mate does not inherit the erase), plus a whole-pool census that printed '
      + '{Unstable} is exactly {Oorblak, Aberrant Statweaver} and that no non-combat attribute '
      + 'is in any card\'s attrs array. Then test/90-coverage-census.test.ts for the sweep.',
    // DONE 2026-08-25 in the same change that found it. Red-checked: reverting
    // engine.ts wholesale reds tests 1-3 (the two negations land in a bin; the
    // fizzle logs "→ bin") and leaves 4-11 green, which is the point — 4 is the
    // R79 case that already worked. Reverting ONLY the two fizzle sites reds
    // test 3 alone, so each half is independently pinned.
    guards: [
      '125-active-zone.test.ts::Aberrant Statweaver negated off the stack is ERASED, not binned',
      '125-active-zone.test.ts::Oorblak — the other printed {Unstable} card — is erased the same way',
      '125-active-zone.test.ts::a printed-Unstable virus whose HOST DIES fizzles to the erased pile',
      '125-active-zone.test.ts::a NON-Unstable virus negated off the stack still BINS',
      '125-active-zone.test.ts::a printed-Unstable card DISCARDED FROM HAND bins and TRASHES',
      '90-coverage-census.test.ts::every bin ENTRY goes through toBin / destroy / the leavePlay mods line',
    ],
    status: 'done',
  },
  {
    id: 43,
    area: 'engine',
    severity: 'minor',
    cards: ['Hooba-Mon'],
    title: "destroy()'s disposal tail is hand-copied into card code, and the bin sweep can be aliased around",
    detail:
      'Two halves of one problem, both surfaced by R152 landing on top of R145. '
      + '(a) `exchangeInPlace` (batch-dark-b.ts) is a FOURTH hand-copy of the sequence '
      + '`E.destroy` runs when something leaves play for a bin: push the body and its nontoken '
      + 'mods, fire the despawn, trash each one anchored (R70), then sweep highest-index-first '
      + 'if the body is {Unstable} (R137/R145). It is correct today and fully pinned — but it is '
      + 'PROSE COPIED INTO A CARD FILE, and every previous copy of this sequence drifted. It '
      + 'cannot use E.toBin, which is the sanctioned choke point, because toBin takes neither '
      + "R70's `anchor` nor reports the SLOT index R140's sweep needs. "
      + '(b) 90-coverage-census\'s bin-ENTRY sweep matches `<expr>.bin.push(` textually, so '
      + 'aliasing the bin to a local steps around it — `const mb = g.player(m.owner).bin; '
      + 'mb.push(m.card);` is invisible to it, and exchangeInPlace contains exactly that shape '
      + 'for its MOD pushes. Only its body push was caught, which is why the waiver below names '
      + 'one line and not three.',
    evidence:
      'Found 2026-08-25 while cherry-picking R152 onto R145: the sweep R145 introduced went red '
      + 'on R152\'s body push and stayed GREEN on its two mod pushes, which is how the alias hole '
      + 'was noticed at all. A sweep that can be stepped around by a local variable measures its '
      + 'own regex — the same failure as CARD-TODO #9\'s 97-card phantom band.',
    fix:
      "Extract destroy()'s disposal tail into one engine primitive (it needs entity + mods + "
      + "'from' zone, and must return or apply the slot indices) and have both destroy() and "
      + 'exchangeInPlace call it. Then DELETE the BIN_PUSH_EXEMPT waiver — the stale-entry assert '
      + 'makes leaving it a hard failure. Widen the sweep to follow one level of aliasing in the '
      + 'same change, or it will keep certifying code it cannot see.',
    proof: null,
    verify:
      'Reverting the primitive in exchangeInPlace must redden 42-dark-b\'s despawn, mod-trash '
      + 'and erased-pile assertions; adding a NEW aliased bin push anywhere in src/cards/ must '
      + 'redden the census sweep.',
    // DONE 2026-08-25 as R153. (a) `E.disposeToBin(u, mods, announce, opts)`
    // owns the whole tail — push nontoken mods (own owner's bin, slot
    // recorded) -> push body (slot recorded) -> `announce` -> trash body then
    // each mod anchored (R70) -> Unstable sweep DESCENDING / else token sweep
    // -> token-mod bulk 'erased' (R65) -> delete mod entities last. destroy()
    // and exchangeInPlace are each one call now. `announce` is a callback and
    // not two half-primitives on purpose: the event must land after every push
    // and before every trash, and a two-call API lets a caller slip something
    // between them.
    //   leavePlay/afterDespawn were deliberately NOT folded in — they run the
    // mods half only (body goes to a hand or cache: no body push, no body
    // slot, no Unstable sweep, no token-mod line), so a "no body" mode would
    // branch all eight ordering constraints to save four lines. The R137
    // property the split must preserve is asserted directly instead: the same
    // mod driven through a death and through an exchange, deepEqual'd.
    // (b) BOTH bin sweeps follow one level of aliasing now, so
    // `const mb = g.player(m.owner).bin; mb.push(m.card)` is visible; both run
    // through stripCode, so a comment naming `.bin.push(` cannot false-alarm.
    // BIN_PUSH_EXEMPT is `{}` and the stale-entry assert keeps it that way.
    // The R124 exit sweep had NO live bypass hiding behind its alias hole.
    //   ⚠ Verified independently, not taken on report: planting
    // `const aliasProbe = …bin; aliasProbe.push('Bubb')` in batch-water-b.ts
    // reddens the sweep by name (`batch-water-b.ts:390 (not in engine.ts)`) —
    // neither old regex matched that shape. Reverted after.
    guards: [
      '129-disposal-tail.test.ts::R153 conformance: BOTH destroy() and Hooba-Mon',
      '129-disposal-tail.test.ts::R153 conformance: neither call site keeps a second copy of the tail',
      '129-disposal-tail.test.ts::R153 (iii): an Unstable body is swept with its mods',
      '129-disposal-tail.test.ts::a nontoken mod is binned and trashed the same whether its host dies or is exchanged',
      '90-coverage-census.test.ts::every bin ENTRY goes through',
      '42-dark-b.test.ts::R146: Hooba-Mon exchanges a MODDED host',
    ],
    status: 'done',
  },
  {
    id: 44,
    area: 'engine',
    severity: 'minor',
    title: "apply.ts's pending-decision gate is not seat-aware, so hotseat still freezes",
    detail:
      'R150 fixed report #98 (one player\'s triggers freezing the other\'s simultaneous '
      + 'deployment) at the SERVER layer, with `legalForSeat` and a deferral queue in rooms.ts. '
      + 'The cause is one layer down and untouched: `apply.ts`\'s global gate refuses every '
      + 'non-decide action while any decision is pending, from either seat, and `legalActions` '
      + 'opens by handing the non-owning seat an empty list. That gate is CORRECT during battle, '
      + 'where priority is sequential; it is wrong during a hidden simultaneous segment, which is '
      + 'the only place R144 can now raise one seat\'s trigger decision while the other is still '
      + 'deploying. Because the fix lives in the server, anything going through `apply()` '
      + 'directly still freezes — which is hotseat, and the Harness the whole test suite uses.',
    evidence:
      'Reported by the R150 agent 2026-08-25 as out of scope, having diagnosed the real mechanism '
      + 'at apply.ts:196 and apply.ts:2025 and been told not to edit the engine that round. '
      + 'server/test-concurrency.ts §0 asserts BOTH engine lines by name before it asserts any '
      + 'fix, so the diagnosis is recorded as a live test rather than as prose.',
    fix:
      'Make the gate seat-aware during simultaneous phases: a decision belonging to seat A must '
      + 'not empty seat B\'s legal list or refuse B\'s actions while a hidden segment is open. '
      + 'Then the server\'s compensation becomes redundant and should be deleted in the same '
      + 'change rather than left as a second implementation of the same rule — two answers to '
      + 'one question is the drift that BL-19 is the standing example of.',
    proof: null,
    verify:
      'A Harness (hotseat) driven into deployment with one seat suspended on a trigger decision '
      + 'must still offer the other seat its deploy actions. Today it offers none.',
    // DONE 2026-08-25 as R154. `decisionBlocks(state, seat)` in apply.ts is the
    // one rule both named lines now route through: another seat's decision
    // stops you only where the engine cannot PROVE it is none of your business
    // — outside a hidden simultaneous segment, or where answering it would
    // rewind the world past something you did. Battle is unchanged.
    //
    // ⚠ THIS ENTRY'S OWN `fix` TEXT WAS WRONG and is left above unedited as the
    // record. It said the server compensation "becomes redundant and should be
    // deleted in the same change". It is NOT redundant, for a reason neither I
    // nor the entry had: a 'resolve' suspension carries an R85 WHOLE-GameState
    // snapshot, and E.resumeResolve does `this.s = snap`, carrying forward only
    // actionCount, decisionHigh and the seat names. Measured with that case
    // deliberately un-gated:
    //     seat 0 plays a card:  life 30 -> 33, hand 8 -> 7
    //     seat 1 answers:       life 33 -> 30, hand 7, bin 0
    // the life reverts and the card is in NEITHER hand nor bin — gone from the
    // game, after seat 0 watched it happen. So the mid-resolution case keeps
    // the full engine gate and the server's deferral queue is the serialiser
    // that makes that invisible online. Deleting it would have traded a freeze
    // for silent DATA LOSS. `rooms.ts segmentKey` was real duplication and is
    // gone; legalForSeat shrank to that one case; arrivalVerdict now asks the
    // same decisionBlocks.
    //
    // Clobber handling: apply() fingerprints what the other seat's pending
    // question will read when answered, applies to the draft, and throws if the
    // fingerprint moved (apply() is pure over structuredClone — asserted in its
    // own test, since the fix rests on it). That surfaced a SECOND deadlock:
    // 'orderTriggers' reads s.triggerQueue live and demands an exact-length
    // answer, so an action queueing one more trigger made the open question
    // permanently unanswerable. The queue joins the fingerprint for that arm.
    //
    // ⚠ My ANBB steer was WRONG and the agent disproved it: I read 13 replay
    // skips saying 'a decision is pending for Ben' as 13 instances of this bug.
    // They are ONE stuck decision at action [125] ('ordering expects an array
    // of indices') cascading — all in phase=battle, seg=null, where the gate is
    // correct. ANBB is 15 skips before and after, byte-identical; SMVJ 209
    // likewise. Filed as CT-45.
    guards: [
      '130-seat-aware-gate.test.ts::R154 §1: every kind of action seat 0 had is still theirs',
      '130-seat-aware-gate.test.ts::R154 §2: seat 0 may not overwrite seat 1',
      '130-seat-aware-gate.test.ts::R154 §3: a mid-resolution suspension still blocks the other seat',
      '130-seat-aware-gate.test.ts::R154 §4: in BATTLE the gate refuses the non-owning seat',
      '130-seat-aware-gate.test.ts::R154 §5: apply() never mutates its input',
      'server/test-concurrency.ts::seat 0 is still offered actions while seat 1 is mid-question',
    ],
    status: 'done',
  },

  // ── filed 2026-08-25 from the agents' own out-of-scope reports ──────────
  // Every one of these came from an agent's closing "report any real defect
  // that is out of scope for you". That line is the highest-yield input in the
  // whole loop — CT-43 and CT-44 came from it last round, and so did the board
  // crash fixed this round.
  {
    id: 45,
    area: 'coverage',
    severity: 'major',
    title: 'A replay wedges permanently on one stale decision answer, and reports it as N small skips',
    detail:
      "`doDecide`'s orderTriggers arm recomputes `mine` from the LIVE trigger queue and "
      + 'requires an exact-length array (apply.ts ~1902-1907). When a saved log\'s answer no '
      + 'longer matches — an older log whose answer is a scalar, or any drift in what is queued '
      + '— that decision can NEVER be answered. And `forcedAction` returns null whenever a '
      + 'decision is pending (apply.ts ~2081), so from that action on NO action by EITHER seat '
      + 'is ever legal again. One drifted action becomes a total replay loss.',
    evidence:
      'ANBB replays as "141 actions logged, 126 replayed, 15 skipped", which reads like a 89% '
      + 'faithful replay with a few concurrency hiccups. It is not: action [125] is '
      + '`decide (seat 0) -> ordering expects an array of indices`, and all 14 actions after it '
      + 'are cascade from that one stuck decision. Thirteen of them report "a decision is '
      + 'pending for Ben", which is exactly what CT-44\'s bug looks like — I misread them as 13 '
      + 'instances of it and briefed an agent on that. The agent disproved it: every one is in '
      + 'phase=battle, seg=null, where the gate is CORRECT.',
    fix:
      'Two halves. (1) replay-room.ts must report DIVERGENCE, not a skip count: name the first '
      + 'action that failed and say everything after it is cascade. A skip count invites exactly '
      + 'the misreading above, and this repo settles playtest reports by replay. (2) Decide '
      + "whether doDecide's orderTriggers arm should accept a legacy scalar answer, or whether a "
      + 'log that can no longer be answered should fail loudly at that action instead of quietly '
      + 'poisoning the rest of the run.',
    proof: null,
    verify:
      'node server/replay-room.ts <game>.json on ANBB currently prints "126 replayed, 15 '
      + 'skipped" with no indication that 14 of the 15 are one cascade. It closes when the tool '
      + 'names action 125 as the divergence point.',
    closed:
      'R169. Both halves. replay-room.ts leads with the DIVERGENCE POINT (index, type, seat, '
      + 'the engine\'s own reason), says in words that everything after it is cascade, and '
      + 'PROVES the wedge structurally rather than guessing — a run of consecutive refusals '
      + 'whose standing decision is byte-for-byte the one standing at the divergence, so '
      + 'nothing answered it in between. Message-independent, so it catches a wedge from any '
      + 'cause. The engine half chose REFUSE over COERCE: processTriggerQueue only raises the '
      + 'question at 2+ DISTINGUISHABLE triggers, so a scalar cannot name a permutation under '
      + 'this encoding or any past one — there is no legacy scalar to be lenient about, and '
      + 'coercing 0 to the identity order would invent an ordering the player never picked. '
      + 'The arm splits three ways now: not-an-array and wrong-length are unanswerable; '
      + 'right-length-junk stays an ordinary retryable refusal, because a live UI just clicks '
      + 'again. Verified on ANBB: it names [125]. '
      + '⚠ THE BRIEF WAS WRONG about the scalar being a legacy encoding — ANBB is three days '
      + 'old and the current UI only ever sends an array, so the scalar is an answer to a '
      + 'DIFFERENT question than the one the engine now raises there. That is what killed the '
      + '"accept a legacy scalar" option. '
      + '⚠ CAVEAT KEPT: [125] is the first REFUSED action, not provably the first DIVERGED '
      + 'one — [124] succeeds and the silent drift may sit there. A replay can only ever name '
      + 'the first refusal, and the report now says exactly that and no more. '
      + 'The reframing opened CT-51, which is much larger than this ticket was.',
    guards: [
      '143-replay-divergence.test.ts::names the FIRST diverging action, not a skip count',
      '143-replay-divergence.test.ts::the report says the remainder is CASCADE',
      '143-replay-divergence.test.ts::a scalar answer to an orderTriggers question is refused as UNANSWERABLE',
      '143-replay-divergence.test.ts::an ordering answer of the WRONG LENGTH is unanswerable too',
      '143-replay-divergence.test.ts::a right-length ordering answer with junk indices is an ordinary retryable refusal',
    ],
    status: 'done',
  },
  {
    id: 46,
    area: 'client',
    severity: 'major',
    title: "R154 un-froze the engine for hotseat, and the hotseat UI is still gated one layer above it",
    detail:
      'ui/main.ts ~2600 opens `if (s.decision) return decisionBarHtml(s.decision, err);` — the '
      + "PENDING decision's bar is returned whenever ANY decision is open, whoever owns it, and "
      + 'the affordances gate the same way (~1495). So after R154 the engine permits the other '
      + "seat's deployment in hotseat and the screen still will not offer it.",
    evidence:
      'Reported by the R154 agent as out of scope. R154\'s reach deliberately stops at apply(); '
      + 'online this is invisible because the server publishes legalForSeat and parks arrivals, '
      + 'and hotseat has no server between the player and apply().',
    fix:
      'Gate the decision bar on `s.decision.seat === viewingSeat` in the hotseat path, and take '
      + 'the affordances with it. ⚠ Check it against the redaction properties first: viewFor '
      + 'nulls a decision that is not yours ONLINE, so the online client never had to make this '
      + 'distinction — hotseat is the only caller that can see both seats at once.',
    proof: null,
    verify:
      'A hotseat game with one seat suspended on a trigger decision must offer the other seat '
      + 'its deployment affordances on screen, not merely accept them from apply().',
    closed:
      'R170. FOUR independent gates in ui/main.ts all read a bare !!s.decision — the pre-R154 '
      + 'reading — and all four now ask one predicate, decisionFreezes(seat). promptHtml split '
      + 'into promptHtml + phaseBarHtml so hotseat shows the question on top and the free '
      + 'seat\'s own bar under it. Online is a no-op BY CONSTRUCTION: server/view.ts nulls a '
      + 'decision that is not yours, so a net client\'s s.decision is always its own and the '
      + 'guard short-circuits to the old expression. '
      + '⚠ THE BRIEF WAS WRONG THREE TIMES and the agent measured before complying. (1) It '
      + 'said to suspect legalActions; the agent proved legalActions(state, 1) really does '
      + 'offer the free seat its actions and apply() really accepts them, BEFORE un-gating — '
      + 'the opposite mistake to CT-32, where un-gating would have opened a screen full of '
      + 'refusals. (2) "The affordances gate the same way at ~1495" — that is '
      + 'tokenToggleMode, battle-only, where both readings coincide; the real gates were '
      + 'elsewhere. (3) "Gate on s.decision.seat === viewingSeat" is NOT IMPLEMENTABLE — '
      + 'hotseat has no viewing seat, it is one screen showing both. Hence two bars. '
      + '⚠ WORSE THAN REPORTED: the free seat\'s hand card was drawn with its green playable '
      + 'ring the whole time (handHtml reads legalFor, which was never gated) and then '
      + 'silently ate the click. Not a dead board — a LYING one.',
    guards: [
      '144-hotseat-decision-gate.test.ts::the rules layer really does offer AND accept what the client is about to draw',
      '144-hotseat-decision-gate.test.ts::in hotseat the seat NOT being asked is offered its deployment affordances on screen',
      '144-hotseat-decision-gate.test.ts::the seat being asked still gets its own decision bar',
      '144-hotseat-decision-gate.test.ts::ONLINE the state that drives this branch cannot even reach the client',
      '144-hotseat-decision-gate.test.ts::both seats can never have a question open',
    ],
    status: 'done',
  },
  {
    id: 47,
    area: 'engine',
    severity: 'minor',
    title: "legalActions can now offer an action apply() refuses, and the fuzzer assumes it cannot",
    detail:
      'R154\'s disturbance check throws IllegalAction when an action turns out to have moved '
      + "state the other seat's open question will read. Whether a play suspends is not "
      + 'predictable in advance, so `legalActions` cannot exclude it up front. That is a real, '
      + 'deliberate crack in its documented contract — "Every action returned is legal" '
      + '(apply.ts ~2010) — which the fuzzer relies on.',
    evidence:
      'Stated by the R154 agent as a knowing trade: widening legalActions to match would break '
      + 'the contract in the other direction and mislead the fuzzer worse. Online it is '
      + 'invisible (the room parks the action); in hotseat the player is told it lands once the '
      + 'other seat has answered.',
    fix:
      'Decide which way the contract should read and write it down: either narrow the comment to '
      + '"legal unless it disturbs an open question of another seat" and teach the fuzzer that '
      + "exception by name, or have legalActions speculatively apply and filter. The second is "
      + 'correct and probably too expensive; the first is honest. Do not leave the comment '
      + 'claiming something the code no longer does.',
    proof: null,
    verify:
      'The contract comment at the head of legalActions matches what apply() will actually '
      + 'accept, and the fuzzer names this exception rather than tripping over it.',
    closed:
      'R169. The contract comment now names the R154 disturbance exception instead of claiming '
      + 'something the code no longer does, and test/fuzz.ts names it too via an exported '
      + 'isContractException() — recognised by the `disturbs` FLAG, never by a message; CHECKED '
      + '(a disturbs refusal with no question standing, or on the asking seat\'s own action, '
      + 'throws louder than an unflagged one); and COUNTED via FuzzResult.disturbed, so its use '
      + 'stays visible rather than being swallowed. '
      + '⚠ HONEST LIMIT, stated rather than papered over: disturbed is 0 across 180 fuzz games. '
      + 'Random play enters R154\'s window only 39 times in 60 games and is offered 16 '
      + 'free-seat actions there, disturbing none. The exception is REAL — a hand-built test '
      + 'shows legalActions offering an action apply() refuses — but the fuzzer does not '
      + 'currently explore it, so the guard pins the counter at zero rather than asserting it '
      + 'fires. A fuzzer that tolerates a whole class of refusal silently is a fuzzer that '
      + 'will hide the next real one; this at least makes the class countable.',
    guards: [
      '143-replay-divergence.test.ts::legalActions offers an action apply() refuses — the ONE exception its contract now names',
      '143-replay-divergence.test.ts::the fuzzer refuses to widen that exception past what R154 actually promises',
      '143-replay-divergence.test.ts::the fuzzer counts the exception rather than swallowing it',
    ],
    status: 'done',
  },
  {
    id: 48,
    area: 'coverage',
    severity: 'major',
    title: 'R104 has a conformance sweep for its replacement half and none for its STATIC half',
    detail:
      '88-replacement-conformance.test.ts classifies cards printing "would … instead" and is the '
      + 'class guard that closed reports #60/#75. R104\'s own text also covers "and static '
      + 'effects" — and 88 never checks a static. So the class guard people believe exists for '
      + 'the static half does not.',
    evidence:
      'Found 2026-08-25 when I asked an agent to back-fill 88 onto report #46 (Tenebrous '
      + 'Bulborb, "the I get -2/-2 isn\'t a trigger that should go on the stack, it\'s a static '
      + 'effect"). The agent REFUSED and was right: Bulborb prints "[Augment] I gain -2/-2" — '
      + 'neither "would" nor "instead" — so 88 can never go red on that card however the -2/-2 '
      + 'is built. Back-filling it would have added a second guard that cannot fail, to an entry '
      + 'whose whole history is a one-card fix for a class of bug.',
    fix:
      'A statics conformance sweep of 88\'s shape: enumerate the cards whose printed text is '
      + 'continuous-shaped (~41 by the agent\'s count) and assert each is built as a static '
      + 'rather than as a triggered ability that goes on the stack. This is a project, not a '
      + 'citation fix, which is why it is filed rather than done.',
    proof: null,
    verify:
      'A card printing continuous text but implemented as a triggered ability must fail a named '
      + 'sweep. Today only the "would…instead" family is swept.',
    closed:
      'R168. 142-static-conformance.test.ts, built in 88\'s shape and derived from '
      + 'printed.json rather than a hardcoded list: 45 of 494 cards print a continuous-shaped '
      + 'clause (46 clauses; the inventory guessed ~41), and 36 of those print nothing else, '
      + 'so they may declare no stack-reaching channel at all. Every exemption carries its '
      + 'reason and a third test fails when one outlives its cause. '
      + 'IT FOUND A LIVE ONE ON ITS FIRST RUN: Aetherflux Golem printed "[Augment] I gain '
      + '+2/+2" — report #46\'s own sentence, sign flipped — and was implemented as a '
      + 'triggered ability adding two +1/+1 counters, while the two cards printing the '
      + 'IDENTICAL sentence (Tenebrous Bulborb, Malformed Monstrosity) were statics. So the '
      + 'class was still live in the pool while reports #46 and #75 both sat at "fixed". '
      + 'Now a static, and both ledger entries are repointed here. '
      + 'BLINDNESS MEASURED, not assumed: the sweep names 45 cards and can SEE all 45. '
      + 'Red-checked by the orchestrator independently, by planting report #46\'s ORIGINAL '
      + 'bug back onto Bulborb — the sweep reddens, which is exactly what '
      + '88-replacement-conformance structurally could never do on that card. '
      + 'On the allowlist rule: it applies to the DECLARATION side. On the TEXT side a '
      + 'denylist is the loud-failing direction, so the classifier uses eight positively '
      + 'matched buckets plus an UNCLASSIFIED bucket that fails — all 570 printed sentences '
      + 'are accounted for.',
    guards: [
      '142-static-conformance.test.ts::a card printing a standing statement of fact declares a CONTINUOUS layer',
      '142-static-conformance.test.ts::a card whose whole printed text is continuous declares NOTHING that reaches the stack',
      '142-static-conformance.test.ts::the classifier accounts for every sentence in the pool',
      '142-static-conformance.test.ts::every behaviour key in the pool is classified',
      '142-static-conformance.test.ts::every exemption is still needed',
      '142-static-conformance.test.ts::R168: Aetherflux Golem is a STATIC',
    ],
    status: 'done',
  },

  // ── filed 2026-08-25 as the NEXT ROUND'S WORK ───────────────────────────
  // Full detail for both lives in `digital-client/docs/16-divergence-inventory.md`
  // — a three-agent sweep of all 30 card files. Read that before starting.
  {
    id: 49,
    area: 'coverage',
    severity: 'blocker',
    title: '316 of 439 printed promises have never been observed being delivered',
    detail:
      '84-card-semantics prints it on every run: "347 cards carry 439 printed promises '
      + '(123 unconditional, 316 behind a trigger/condition/activation)". Only the '
      + 'UNCONDITIONAL ones are required — a clause behind "When…", "if…", an activated '
      + "ability's colon or an [Augment] box may legitimately not fire on the drill's board, "
      + 'and demanding them would produce a wall of false failures. So 72% of what the cards '
      + 'promise is counted out loud and never checked. '
      + '⚠ The floor is lower than it looks even where it passes: the file states its own '
      + 'limit — a card printing "deal 3 damage to target unit" that deals 3 to the WRONG '
      + 'unit passes. It catches "promises something countable, delivers nothing of the '
      + 'kind"; it does not check correctness.',
    evidence:
      'The tally in 84-card-semantics.test.ts, printed on every run. Unchanged by the R157 '
      + 'ruling round (2026-08-25) — those 27 answers fixed CORRECTNESS, not COVERAGE, and '
      + 'the number moved not at all. Drill reach is 490/491 and has been for weeks; reach is '
      + 'not the problem, delivery is.',
    fix:
      'Staged, re-measuring after each stage. (1) Extend `claims.ts` to tag each conditional '
      + 'claim with WHY it is conditional (trigger event / activated cost / augment box / '
      + 'conditional clause) — that partition says how many need a board and how many need '
      + 'only an activation. (2) ACTIVATED abilities are the cheap third: the drill can pay a '
      + 'cost and activate with no new machinery. (3) Trigger-gated promises need a per-EVENT '
      + 'fixture library (a unit dies / a card is trashed / a spell is played / a player loses '
      + 'life / a counter is placed), then every card whose claim is gated on that event is '
      + 'driven through the matching fixture. (4) [Augment] boxes need a host; the drill '
      + 'already grafts. '
      + '⚠ Do NOT close this by loosening what counts as a promise. Tightening the '
      + 'conditional test moved 316 claims out of the required set once already, and every '
      + 'one of those moves removed a FALSE FAILURE rather than weakening a check. Add a '
      + 'floor to the conditional count the way `req >= 115` floors the unconditional one, so '
      + 'the number cannot fall because the extractor got weaker.',
    proof: null,
    verify:
      'node --test test/84-card-semantics.test.ts prints the tally. It was 114/123 '
      + 'unconditional with 316 unchecked when this was filed. This closes when the '
      + 'unchecked count is small AND the remainder are clauses no fixture can reach, named '
      + 'individually rather than counted.',
    progress:
      'STAGES 1-4 ALL DONE (R171 stages 1-2, R180 stages 3-4). The printed number moved from '
      + '98/316 gated promises observed to 264/316 — 218 never-observed down to 52. '
      + 'augment 152 needs an [Augment] HOST: 129 observed, was 0. '
      + 'trigger 110 needs a fixture firing the EVENT: 86 observed, was 56 — and the window is '
      + 'STRICTLY NARROWER now, so this is a bigger gain than the delta looks. '
      + 'activated 35: 35 observed. condition 19 needs a BOARD meeting the clause: 14, was 7. '
      + 'BROKEN CARDS FOUND: ZERO, and it is a MEASURED null result. Every card that read dead '
      + 'was chased to its cause and was board-limited (Towering Colossus, Malformed Monstrosity, '
      + 'Dreadspawn Horror, Bloated Manablub, Colony of the Interworld, Galerider Eel). Guarded '
      + 'by positive controls, and the orchestrator verified it independently by breaking '
      + 'Aetherflux Golem\'s static: the suite names the card AND its printed clause. Before this '
      + 'round all 152 augment claims had zero observation, so that break was invisible. '
      + '⚠ THE BRIEF WAS WRONG that "drill.ts already knows how to graft" — drill.ts contained no '
      + 'graft at all, AND grafting is not what these cards need: all 117 cards carrying an '
      + 'augment-gated promise are isAugment and NONE is isGraftable. The action is `augment`. '
      + '⚠⚠ FOUR BLINDNESSES IN THE CHECKER ITSELF, every one of which had made the numbers go '
      + 'UP — the direction that flatters. (1) the stat comparison joined ALL entities into one '
      + 'string, and the mod IS an entity, so removing it always changed the string and every '
      + 'augment in the pool "changed somebody\'s stats"; (2) the evidence window persisted '
      + 'across fixture beats, so one card\'s "when I die" collected four later beats; (3) a '
      + 'state DELTA cannot be attributed the way an event stream can; (4) attaching any mod '
      + 'makes the host {Unstable} and lengthens its counters array, so a coarse diff evidenced a '
      + 'pump and a counter for all 117 cards. A COVERAGE NUMBER THAT GOES UP IS NOT '
      + 'SELF-EVIDENTLY GOOD NEWS — ask what a blind checker would report, every time. '
      + 'ROUND 27 (2026-08-26): 264/316 -> **278/316**; never-observed **52 -> 38** (45 cards -> 37). '
      + 'augment 129->137, trigger 86->92, activated 35 unchanged, condition 14 unchanged. '
      + '⚠⚠ MY BRIEF NAMED THE WRONG NEXT STEP, AND THE CORRECTION IS THE FINDING: the '
      + 'attacking position with the card actually IN the battle ALREADY EXISTED. progressAction has '
      + 'declared the fullest attack on offer since the drill was written, and doDeclareAttack moves '
      + 'every attacker into the defender’s region — the card marches every game. What was '
      + 'missing was A BEAT THAT WAITS FOR IT: all seven @battle repeats fired at steps 29-35, every '
      + 'one in the DECLARE step with the card still at home, so the world acted at home too. '
      + 'Fixture.phase gained inBattle (fires only while subject.region === battle.region) with nine '
      + 'region-aware beats aiming at subject.region. '
      + '⚠ THE REGION FAMILY WAS 6 AND FIVE FELL. The sixth, Bloated Manablub, is NOT a '
      + 'region-scope problem: it is a 2/2 the counters/damage beats kill before the declare step, and '
      + 'the drill’s respawn puts it back AT HOME mid-battle, too late to join. '
      + '⚠ SIX OF THE BOARD 26 FELL OUT OF SOMETHING UNRELATED, and it is PROVEN unrelated: '
      + 'disabling the position pin entirely leaves those six green. What unlocked them was the LIFE '
      + 'TOP-UP — nextBeat holds die/despawn until two battles finish, the top-up ran once per '
      + 'WINDOW while a whole combat damage step happens inside one apply, and a traced game hit '
      + 'gameover at step 55 with battlesSeen=1, one short of the gate, 29 of 31 fixtures fired. '
      + '⚠ A CARD TAUGHT THE AGENT A RULE: a bounded [Switch1] spends its one use per turn (R9) '
      + 'when the trigger is QUEUED, not when the payload finds work. Boreal Wanderer heard a home '
      + 'spawn while at home, queued into a region holding only itself, said no opponent is present, '
      + 'and was spent. Pinning ALL SEVEN beats that way was MEASURED AND WAS A NET LOSS — it '
      + 'gained two cards and lost three, 276 vs 278, at twice the runtime. '
      + 'WHAT A BLIND CHECKER WOULD PRINT, measured BOTH ways: pin always TRUE -> beats act at '
      + 'subject.region, which at home IS home, and every clause in the family tests the battle region '
      + 'explicitly, so coverage FALLS; pin always FALSE -> the six go dark and the per-gate floors '
      + 'catch it. R199 ADDS NO EVIDENCE CHANNEL AT ALL — attribution is still ownResolution and '
      + 'the continuous-layer read is still staticBite, both R180’s, both untouched. Only WHEN and '
      + 'WHERE the world acts changed. And the first number measured WENT DOWN (227/316) before the '
      + 'life top-up was raised. Every beat now records home=/at=/battle=: at === battle is the pin '
      + 'and proves nothing; **at !== home is the fact that cannot be faked.** '
      + '15 tests, 15 individual breaks, each reddening EXACTLY its own named card and nothing else. '
      + 'THE 38 THAT REMAIN are named individually in 84-card-semantics UNREACHED with the '
      + 'precondition each lacks: BOARD 25, CHOICE 6, VOCAB 3, REGION 1 (Bloated Manablub), and a NEW '
      + 'opener EVENTLESS 1 — implemented, really happens, but nothing in the game can see it '
      + 'happen (Slag Spewer, CT-86). Next cheap wins: CHOICE (progressAction always answers option 0) '
      + 'and the resource-activation and expended-resource boards, which fundSeat’s bulk open makes '
      + 'unreachable. '
      + 'PRIOR ROUND (26): '
      + 'THE 52 THAT REMAIN are named individually with their missing precondition, which is what '
      + 'this entry says closes it. Biggest family is REGION (R12, 6 cards): a clause scoped to '
      + 'its event\'s region cannot be reached by a fixture fired at a battle window while the '
      + 'card stands at home. AN ATTACKING POSITION WITH THE CARD ACTUALLY IN THE BATTLE is the '
      + 'next thing worth building. Then BOARD 26, CHOICE 5, VOCAB 3, EXTRACT 2.',
    guards: [
      '84-card-semantics.test.ts::every gated promise the fixtures cannot reach is NAMED, with the precondition that is missing',
      '84-card-semantics.test.ts::no card silently fails to deliver an unconditional printed promise',
      '84-card-semantics.test.ts::every activation-gated promise is delivered when the drill pays and activates',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29). ALL FOUR PRESCRIBED STAGES ARE DONE, AND THE HEADLINE '
      + 'NUMBER IN THE TITLE IS OFF BY A FACTOR OF SEVEN. Live from the suite on 2026-08-28: **393 '
      + 'of 439 promises observed** — 114/123 unconditional and 279/316 gated. The title says 316 '
      + 'unobserved; it is 46 (9 unconditional + 37 gated). Stage (1) the WHY-conditional '
      + 'partition, (2) activated abilities, (3) the per-EVENT fixture library and (4) the '
      + '[Augment] graft host were all built across rounds 25-27, and 84-card-semantics prints the '
      + 'partition derived on every run. THE RESIDUAL 37 GATED CLAIMS SPREAD OVER 36 CARDS are '
      + 'named individually in UNREACHED with the precondition each lacks: BOARD 25 · CHOICE 5 · '
      + 'VOCAB 3 · EXTRACT 2 · REGION 1. **BOARD 25 is not engineering work** — it means the drill '
      + 'cannot construct the situation, which is exactly what the scenario tester (docs/14, R217\'s '
      + 'queue) exists to hand to a human. So the residual is not parked, it is QUEUED SOMEWHERE '
      + 'ELSE, and keeping this ticket open would double-count it. ⚠ WHY THIS IS CLOSED AND NOT '
      + 'WORKED FURTHER, which is the honest part. docs/13 §3 already reached the conclusion: the '
      + 'round-27 gain was +14 claims for eighteen agents, and "we are getting expensive gains on a '
      + 'number that was never the point". §2 says why the metric is weak — 84-card-semantics '
      + 'states in its own header that a card printing "deal 3 damage to target unit" which deals 3 '
      + 'to the WRONG unit PASSES here. This is a FLOOR, and the floor is built. The successor is '
      + 'CORRECTNESS, not coverage: 182-correctness-sample (docs/13 §7.1), which asserts right '
      + 'target, right amount, right timing, right duration. Closing this is choosing the better '
      + 'metric, not declaring victory on this one. ⚠ THE TICKET\'S OWN WARNING WAS HONOURED: "Do '
      + 'NOT close this by loosening what counts as a promise." The denominator is UNCHANGED at 439 '
      + 'across 347 cards — the same population it was filed against. The number moved because '
      + 'claims were observed, not because the extractor got weaker, and `req >= 115` still floors '
      + 'the unconditional side. ⚠ ALSO FOUND WHILE CLOSING THIS, AND FILED AS CT-102: three '
      + 'sources quoted this tally and **docs/13-assessment.md itself was one of them**, reading '
      + '278/316 and "38 across 37" and an EVENTLESS bucket that no longer exists — inside the very '
      + 'section whose warning box says "the tally the suite prints has been right every single '
      + 'time. Quote it; do not re-derive it." Nobody re-derived it. It was copied once and never '
      + 're-read, and R219 moved a claim underneath it. That is a failure mode docs/13 §5 does not '
      + 'yet list: a CORRECT instrument, printing CORRECTLY, into a document nobody re-read.',
    status: 'done',
  },
  {
    id: 50,
    area: 'card',
    severity: 'major',
    title: 'The open approximations from the 30-file divergence sweep',
    detail:
      'A three-agent sweep of all 30 files in src/cards/sets/ (457 cards) on 2026-08-25 '
      + 'inventoried every place the engine knowingly diverges from printed text. The '
      + 'R157 ruling round fixed some; the rest are catalogued in '
      + 'docs/16-divergence-inventory.md §2, grouped by what a fix needs. '
      + 'Biggest single item: SPELL COPY never touches the stack — Earthbound Replicator and '
      + "Maelstrom Charger call the copied spell's `run` in place, so the copy is "
      + 'unrespondable, un-negatable by four cards that sweep the stack, fires no play event '
      + 'for eight cards that watch one, and cannot erase itself. '
      + 'Others needing an engine primitive: no `E.toHand`/"handEntered" (three cards); '
      + 'face damage aggregated per seat so "a unit deals combat damage to a player" cannot '
      + 'be attributed (six cards); no response window mid-resolution (four cards); '
      + '`AbilityCost` has no variable-N atom (six cards pay at resolution); {Reaping} is '
      + 'damage-only so a kill by stat swap or counter never sees it (two cards). '
      + 'Card-local ones are cheaper: spawn counters landing AFTER the spawn event so every '
      + 'watcher reads the wrong body; two cards printing "play" that call spawnUnit; '
      + '"double" applied at layer 3 under a layer-4 multiplier; donated "[Augment] when I '
      + 'despawn" text that is dead on a RECALL and works on a DEATH.',
    evidence:
      'docs/16-divergence-inventory.md, built from the sweep. Each entry names its cards, '
      + 'its file, what diverges and what makes a fix non-trivial.',
    fix:
      'Work §2 of the inventory. Take 2b (card-local, no new primitive) first — those are '
      + 'individually small and each one is a card that stops lying. Then 2a, biggest first: '
      + 'SPELL-COPY unblocks the most cards. 2c is drift risk rather than live defect and can '
      + 'wait, EXCEPT Origon, which uses `.find()` where it needs `.reverse().find()` and so '
      + 'negates the WRONG stack item when two copies of a card are on the stack — that one '
      + 'is a live bug hiding in a tidy-up bucket. '
      + 'Inventory §3 lists ~20 STALE comments; each makes a live card look parked or an '
      + 'approximation look present, and clearing them is nearly free.',
    proof: null,
    verify:
      'An inventory entry closes when its cards have a named test that reddens on the old '
      + 'behaviour. The inventory itself closes when §2 is empty.',
    guards: [
      '166-face-damage-attribution.test.ts::a combat \'lifeLost\' names the columns that dealt it',
      '167-variable-ability-costs.test.ts::R196',
      '169-mid-resolution-window.test.ts::the deferral gate: only a live battle priority window defers a mid-resolution play',
      '168-three-card-divergences.test.ts::Prediction Prophet: "predict your life total" is UNCAPPED',
      '168-three-card-divergences.test.ts::Spell Excavation: the window SURVIVES to regroup',
      '168-three-card-divergences.test.ts::Cinder Scuttler: the MULTIPLAYER premise is UNREACHABLE',
    ],
    closed:
      '**§2 IS EMPTY** (2026-08-26). The last five rows closed in one round: PER-COLUMN FACE '
      + 'DAMAGE (R195), VARIABLE-COST ACTIVATED ABILITIES (R196), RESPONSE WINDOW '
      + 'MID-RESOLUTION (R198), PREDICTION CAP + UNTIL-REGROUP PLAY WINDOW (R197), and '
      + 'MULTIPLAYER ATTRIBUTION — which was **measured UNREACHABLE and nothing was built**: '
      + 'createGame makes exactly 2 players, other(seat) is the literal 1 - seat, and combat '
      + 'iterates [initiative, nit]. No third seat is representable. '
      + '⚠⚠ EVERY ONE OF THE FIVE CORRECTED ITS OWN ROW, and the pattern is worth more than the '
      + 'fixes: face damage said 6 cards and is 9 (**Flowstone Arcanite\'s own comment named all '
      + 'three missing ones** while the row did not) and cited an R159 that DOES NOT EXIST; '
      + 'variable-cost was half wrong about when two of six are paid AND its prescribed fix was '
      + 'wrong (the engine already had the machinery, so two cards closed with no new engine code '
      + 'at all); the response window was called "structurally the hardest item here" and was '
      + 'buildable safely, because the safe shape is the R164 one (defer the play to the stack) '
      + 'not the row\'s implied one (suspend mid-resolution) — apply.ts was never touched; and '
      + 'Spell Excavation was worse than described, a silent TIMING WAIVER that R157 §12 forbids. '
      + '⚠ FOUR ROWS OF §2a WERE ALREADY FIXED IN ROUND 26 AND STILL READ AS OPEN in the table '
      + '(REAPING, MOVE-A-MOD, ROT/DEBT REMOVAL, FORMATION AS A TARGET, plus HAND-ENTRY). A '
      + 'closure recorded only in a header block is a closure the table still contradicts — the '
      + 'stale-PARKED-note failure one level up. Recorded in the inventory\'s round-27 block. '
      + '⚠ R198 AND R197 COLLIDED ON SPELL EXCAVATION and the later one wins: R198 taught the '
      + 'inline play to push a StackItem; R197 removed the call site, because "you MAY play it '
      + 'until regroup" is a GRANT. R198\'s test was REWRITTEN rather than deleted — every claim '
      + 'it made is still true, only the route to the window changed. '
      + '⚠ WHAT THIS TICKET COULD NOT SEE: two hidden-information leaks (R202, R197b), neither a '
      + 'divergence from PRINTED TEXT and so outside this inventory\'s whole question. The sweep '
      + 'that built this file could not have found them.',
    status: 'done',
    progress:
      'ROUND 26 (2026-08-25) closed twelve rows. §2a SPELL-COPY (R164 — the biggest single '
      + 'item). §2b SPAWN-COUNTERS and PLAY-VS-PUT-INTO-PLAY (R165), DOUBLING OVERSHOOTS, '
      + 'ORIGON both halves, SURVIVE-DAMAGE, KEEP-THIS-TARGET (R166), DESPAWN ON RECALL (R167), '
      + 'STATIC-VS-TRIGGER (R168), MODULE-LEVEL LATCH and MID-BATTLE FORMATION JOIN (R172). '
      + '§2c: both erase copies routed through the choke point (R172) and both stack lookups '
      + 'reversed (R166). §3 cleared — 18 comments, plus 147-comment-conformance so the shapes '
      + 'cannot rot again. '
      + 'STILL OPEN in §2a: HAND-ENTRY (⚠ the site count is wrong in BOTH the inventory and the '
      + 'card comment — it is 18 sites across 11 files, not 14 and not ~9; a fix scoped to '
      + 'either number leaves the primitive half-wired), PER-COLUMN FACE DAMAGE, RESPONSE WINDOW '
      + 'MID-RESOLUTION, VARIABLE-COST ACTIVATED ABILITIES, REAPING AS A GENERAL HOOK, '
      + 'MOVE-A-MOD, ROT/DEBT REMOVAL, FORMATION AS A TARGET. In §2b: PREDICTION CAP, '
      + 'UNTIL-REGROUP PLAY WINDOW, MULTIPLAYER ATTRIBUTION. '
      + 'THREE OF THOSE ARE NOW UNBLOCKED BY OWNER RULINGS (2026-08-25): "target formation" is '
      + 'the WHOLE SIDE, so the count is right and only the TargetRef arm is missing; a mod that '
      + 'moves takes everything with it INCLUDING {Unstable} ("Unstable is just an attribute '
      + 'granted to all entities that are modded. Of course it moves with the mods.") — check '
      + 'whether the derivation is computed or stored before building E.moveMod; and a counter '
      + 'REMOVAL is NOT scaled by the amount layer ("Resonater says put on so this question is '
      + 'irrelevant"), which settles the open question in ROT/DEBT REMOVAL. '
      + 'Read docs/16-divergence-inventory.md — its header block now carries the corrections '
      + 'this round cost, including that SPELL-COPY\'s consequence list was BACKWARDS and that '
      + '§3 was wrong about Counter Theif in a way that would have destroyed a real fact.',
  },

  // ── filed 2026-08-25 (round 26) ─────────────────────────────────────────
  // #51 and #54..#56 all come from the same place: a read-only audit that
  // resolved all 295 guard references in playtest-ledger.ts and asked of each
  // one "could this test have gone RED on the behaviour in the report?".
  // Four fixed reports could not. That question is not the one
  // 83-card-todo.test.ts asks, and it is the one that matters.
  {
    id: 51,
    area: 'coverage',
    severity: 'blocker',
    title: 'Only the first ~15% of most saved games replays at all, and the tail is not evidence',
    detail:
      'This repo settles playtest reports by replaying saved games. R169 rewrote '
      + 'replay-room.ts to report a DIVERGENCE POINT instead of a skip count, and the '
      + 'reframing is alarming: a log that read as "375 actions, 166 replayed, 209 refused" '
      + 'is not 209 problems, it is ONE divergence at action [121] and 208 lines of cascade — '
      + 'and everything after [121] is a board the logged game never had. Measured at HEAD: '
      + 'WEHH diverges at [56] of 385 · XVUR [51] of 352 · VEAV [113] of 371 · SMVJ [121] of '
      + '375 · UZRG [154] of 276 · ANBB [125] of 141.',
    evidence:
      'Found by the R169 agent and re-measured by the orchestrator on freshly fetched copies '
      + '(SMVJ: 375 actions on the server, 375 in the file, 209 refused). '
      + '⚠ THE NUMBERS ARE NOT NEW — rounds 24 and 25 both recorded "pre-existing divergence: '
      + 'ANBB 15, SMVJ 209, unchanged" and treated the MATCHING COUNT as reassurance that a '
      + 'round had added no drift. It was a true statement about drift and a false sense of the '
      + 'corpus: those logs were already unreplayable past their first sixth. '
      + 'The distinct first-refusal causes across the corpus — "no decision is pending", "not '
      + 'your attack step", "not your draw phase", "you do not have priority" — each look like '
      + 'their own rules drift and none has been chased.',
    fix:
      'Two halves, and the first is cheap. (1) Take the six divergence points one at a time and '
      + 'find what changed under each; each is a candidate regression or a deliberate rules '
      + 'change nobody recorded. Bisecting is cheap and known to work: git checkout per '
      + 'candidate commit, re-run replay-room.ts on the SAME file. (2) Decide what the corpus '
      + 'is FOR. If a saved game stops being replayable the moment the rules move, then either '
      + 'logs need versioning against the engine that produced them, or forensics needs to stop '
      + 'being the primary evidence route and unit tests need to take over at the point of '
      + 'divergence. Today the repo believes it can replay these games and it cannot. '
      + '⚠ A replay can only ever name the first REFUSED action, not the first DIVERGED one — '
      + 'ANBB [124] succeeds and the silent drift may sit there. Do not overstate what the '
      + 'divergence point proves.',
    proof: null,
    verify:
      'node server/replay-room.ts <game>.json on each of the six games names its divergence '
      + 'point. This closes when each of those points has been explained — either as a known '
      + 'rules change or as a fixed regression — rather than when the counts change.',
    closed:
      'DIAGNOSED IN FULL (2026-08-25). This entry asked for each divergence to be explained, and '
      + 'all six now are. ALL SIX ARE DELIBERATE, RECORDED RULES CHANGES. **No regressions. No '
      + 'restart corruption.** The logs are TRUE RECORDS; only the reader moved. '
      + 'WEHH [56] <- R97/report #74, a granted-haste play now opens the haste step · '
      + 'XVUR [51] <- report #87, Worldbender replaces the draw step · '
      + 'VEAV [113] <- report #81/R57, modal modes moved from resolution to the cast seam · '
      + 'SMVJ [121] <- R143, Hush Mush enters as the OPPONENT\'s unit so the handover trigger is '
      + 'gone · UZRG [154] <- negation leaves the stack, so two logged passes are superfluous · '
      + 'ANBB [125] <- R137, an Unstable death bins first, so Dropslime\'s trashed-trigger now '
      + 'exists and must be ORDERED against Thoughtripper\'s. '
      + '⚠ THE REPORTED DIVERGENCE POINT IS WRONG IN ALL SIX CASES — late by 1, 1, 1, 1, 3 and '
      + 'SIX actions. XVUR\'s advertised [51] is six actions and a whole turn boundary after the '
      + 'real event at [45], where Ben silently loses 3 life and draws one card fewer. **A '
      + 'refusal index is never the finding; it is only ever an upper bound.** Only diffing a '
      + 'per-action state signature against a reference engine finds the true point. '
      + '⚠ THE CORPUS IS 20 GAMES, NOT 6, and 20 of 22 diverge. Median replayable prefix ~30%; '
      + 'the oldest half is effectively dead (GAXG 6%, ZQPC 7%, BRDM 13%). Only SAAY (the '
      + 'shortest real game) and an empty stub replay clean. '
      + '⚠ AND THE DECISIVE NUMBER: a saved game survives about THREE HOURS of rules work. UZRG '
      + 'stayed clean 2 commits/~3h; XVUR 3 commits/~1.5h; SMVJ 59 commits/~4.5h. The corpus is '
      + 'not decaying slowly, it is a wasting asset with a half-life shorter than one working '
      + 'session, and every round from here adds another dead prefix. '
      + 'Two things were fixed on the way: replay-room.ts no longer SUBSTITUTES one seat\'s deck '
      + 'for the other\'s when a deck fails validation, and no longer guesses a draft trio when '
      + '`els` is absent (R186). GAXG and HDGG have no recorded trio at all and are permanently '
      + 'unreplayable — they are not evidence about anything. '
      + 'THE REMAINING WORK IS CT-66: version the logs.',
    guards: [
      'server/test-forensics.ts::a constructed file with one unusable deck is REFUSED, not substituted',
      'server/test-forensics.ts::a draft file with no recorded element trio is REFUSED, not guessed',
      '143-replay-divergence.test.ts::names the FIRST diverging action, not a skip count',
    ],
    status: 'done',
  },
  {
    id: 54,
    area: 'client',
    severity: 'major',
    // NOT `reportId: 80`, deliberately. Report #80 is `by-design` and was
    // WITHDRAWN BY ITS AUTHOR; this item is a defect found while auditing it,
    // not an answer to it. Claiming the link makes the ledger cross-check fail,
    // and it should: an open todo pointing at a settled report would say the
    // report is unanswered when it is not.
    title: "The hand's playable outline OR-folds five different actions into one glow",
    detail:
      'A card in hand gets a single undifferentiated `.card.playable` outline that is the OR of '
      + 'playCard / augment / graft / prophesy / recycleForResource. So a BATTLE spell during '
      + 'deployment — which can only be GRAFTED — looks exactly like a castable card, and the '
      + 'disambiguation only exists after a click.',
    evidence:
      'This is the one real finding that survived report #80\'s audit. #80 is `by-design` '
      + '(the author withdrew it himself: "It was offering me to GRAFT the ability from hand, '
      + 'which is legal") — but the reason he misread the board in the first place is this '
      + 'outline. '
      + '⚠ THE ENTRY CLAIMED IT WAS ALREADY FILED. #80\'s note read "filed as a separate UI item '
      + '(not a playtest report id)", and a 2026-08-25 guard audit found no such item anywhere — '
      + 'not in backlog/backlog.ts (BL-01..BL-25), not here. It existed only inside that '
      + 'sentence. A finding recorded only in prose inside a closed entry is a finding that has '
      + 'stopped being work; that is the same shape as the two items round 17 lost to a commit '
      + 'message with no PARKED note and no test.',
    fix:
      'Differentiate the affordance before the click. The information is already computed — '
      + '`legalFor` knows which of the five kinds is on offer — so this is a rendering change, '
      + 'not a rules one. Decide what a card offering two kinds at once looks like. '
      + '⚠ Check it against BL-20 first, which asks for the right-click card menu to be '
      + 'NARROWED; these two want the same surface to say different amounts.',
    proof: null,
    verify:
      'A battle-timed spell in hand during deployment must not be drawn the same way as a '
      + 'castable deploy card. Drive it through test/ui-driver.ts.',
    closed:
      'R183. The ring now answers THREE questions instead of one: does anything work (the ring '
      + 'exists — unchanged, nothing that used to glow stopped), can I CAST it (plain green '
      + 'yes · amber dashed = only the named verbs · doubled edge = more than one, the click '
      + 'will ask), and WHICH verbs (a chip: graft / augment / recycle / cast+augment). '
      + 'CASTING IS THE UNMARKED CASE on purpose — a "cast" chip would be noise on every card '
      + 'in every hand, and the common case must not pay for the ambiguous ones. Entirely a '
      + 'rendering change: legalActions always knew which kind was on offer, only the renderer '
      + 'threw the discriminant away. '
      + 'Done TOGETHER with CT-63 deliberately: adding a second CLASS of card to a strip whose '
      + 'outline already OR-folds five action kinds makes the ambiguity worse unless the '
      + 'vocabulary is designed once.',
    guards: [
      '155-hand-affordances.test.ts::a {Battle} spell in deployment is NOT drawn like a castable deployment card',
      '155-hand-affordances.test.ts::a card offering two kinds at once says which two',
      '155-hand-affordances.test.ts::the offer chip is the pure judgement',
      '155-hand-affordances.test.ts::a plainly castable card in hand is drawn exactly as it always was',
    ],
    status: 'done',
  },
  {
    id: 55,
    area: 'client',
    severity: 'minor',
    reportId: 66,
    title: 'A round-2 attacker who declines strands the defender with no token warning',
    detail:
      'Report #66 asked for the unused-spell-token warning to fire only right before Regroup, '
      + 'and R-whatever built exactly that as a pure predicate in ui/battle.ts, asserted against '
      + "the engine's own chain at every priority window of a real battle. One case has no "
      + 'window to hang it on: if the round-2 attacker DECLINES, `doDeclareAttack` calls '
      + '`endBattleRound` directly, so a defender holding castable tokens gets no pass to be '
      + 'warned on and loses them silently.',
    evidence:
      'The gap is recorded in #66\'s own note, which called it "a known gap that cannot be '
      + 'closed client-side". A 2026-08-25 guard audit downgraded the entry from `fixed` to '
      + '`partial` on the strength of that sentence: **a report whose note admits a reachable '
      + 'case it does not cover is not fixed**, and calling it fixed is how the case stops being '
      + 'tracked. Filing it here is what the `partial` status now requires.',
    fix:
      '"Cannot be closed CLIENT-side" is true and is not the same as cannot be closed. The '
      + 'warning is missing because the ENGINE takes a path with no priority window on it, so '
      + 'the fix is engine-side: either `doDeclareAttack`\'s decline route opens the window it '
      + 'skips, or the token loss is announced as part of Regroup so it is never silent. '
      + 'Prefer the second if the first changes battle timing — a warning is not worth a rules '
      + 'change.',
    proof: null,
    verify:
      'A defender holding a castable spell token whose opponent declines the round-2 attack is '
      + 'told the tokens are about to be removed.',
    guards: [
      '165-token-loss-warning.test.ts::the premise: a round-2 defender really is holding castable tokens',
      '165-token-loss-warning.test.ts::a round-2 attacker who declines no longer erases',
      '165-token-loss-warning.test.ts::a battle both players decline opens no priority window at all',
      '165-token-loss-warning.test.ts::the announcement is per seat, in a fixed order',
      '165-token-loss-warning.test.ts::the client puts the announcement in front of the player who lost the tokens',
      '77-playtest-round17.test.ts::[66] the Pass button asks before the pass that reaches Regroup',
    ],
    closed:
      'R194 (2026-08-26). ROUTE (2) — announce at Regroup — and the entry\'s steer to prefer it '
      + '"if route (1) changes battle timing" turned out to be decidable by MEASUREMENT rather '
      + 'than judgement. Route (1) is not timing-neutral on two independent grounds: a declined '
      + 'attack fights no combat, so there is no after-combat step for a window to belong to; '
      + 'and 47,247 empty declareAttacks across 4,841 saved games are followed immediately by '
      + 'declareAttack (23,629) or doneDeploying (22,704) and NEVER by a pass — the corpus holds '
      + 'only 579 passPriority actions in total. Every decline would replay into "you do not '
      + 'have priority". (Orchestrator re-counted independently: same 47,247.) '
      + 'E.startRegroup now emits one erased event per seat, before the erase loop, naming that '
      + 'seat\'s own doomed tokens; ordered seat-then-id; SILENT when nothing is lost, because '
      + 'report #66 is a complaint about being told the same thing too often and a line in every '
      + 'regroup forever is that same mistake moved into the log. '
      + '⚠ THE REACHABLE CASE IS WIDER THAN THIS ENTRY SAID — there are TWO shapes, not one. A '
      + 'battle whose ROUND 1 is also declined opens ZERO priority windows in the whole battle '
      + 'phase, so the defender can never be warned by any mechanism at all. Both are pinned. '
      + '⚠ AND THE PREMISE NEEDED A QUALIFICATION THE ENTRY DID NOT MAKE: at the round-2 DECLARE '
      + 'step legalActions offers the defender nothing, so castableTokens is 0 THERE. The tokens '
      + 'are castable in the round-2 WINDOWS the decline destroys, so the test asserts the '
      + 'counterfactual rather than the declare step. Sharper still: round 2\'s attacker is the '
      + 'NIT, so its defender is the INITIATIVE player and the battle sits in the defender\'s '
      + 'region — a token in IT\'s home is castable in round 2 and in NO round-1 window at all. '
      + 'THE TEXT-COUPLED GUARD IS GONE (the audit\'s second finding): #66\'s old second guard '
      + 'was an assert.match over ui/main.ts source. Measured — switching promptHtml\'s confirm '
      + 'branch off so the bar STOPS RENDERING ENTIRELY leaves all four old text assertions GREEN '
      + 'and reddens only the driven replacement. Orchestrator reproduced that. '
      + 'The rename broke ledger #66\'s citation in a file the change never touched, for the '
      + 'FOURTH time — see CT-42.',
    status: 'done',
  },
  {
    id: 56,
    area: 'coverage',
    severity: 'major',
    title: 'A guard built from a hand-made fixture cannot answer a report about a whole chain',
    detail:
      'playtest-ledger.ts requires a `fixed` entry to cite guards, and 83-card-todo.test.ts '
      + 'checks the named test EXISTS and can fail. Neither asks the question that matters: '
      + '**could this test have gone red on the behaviour in the report?** A 2026-08-25 audit '
      + 'resolved all 295 guard references and read ~30 bodies. Four fixed reports were blind, '
      + 'all the same shape — a guard that unit-tests the LAST HOP with a hand-built input, for '
      + 'a report about the whole chain. #45 and #43 both assert a pure function reads an X off '
      + 'a StackItem the test constructed itself, while the reported failure is whether the '
      + 'ENGINE ever puts the event on the item. #18 answers a presentation bug with two '
      + 'rules-layer asserts. #53 proves the stager can stage, on hand-written event arrays.',
    evidence:
      'The audit. Its own structural point: a cheap mechanical screen exists — flag a guard '
      + 'whose body constructs its own fixture (no `Harness`, no `ui.join`, no pool read). That '
      + 'is not automatically wrong (#22, #26, #77, #82, #94, #100 are all correctly pure, '
      + 'because the root cause WAS a pure function), but for a report whose symptom is "I could '
      + 'not see" / "I was offered" / "it happened instantly", a fixture-built guard is the '
      + 'tell — and in four of four cases chased down, it was blind.',
    fix:
      'Add the screen as a test over playtest-ledger.ts: classify each guard body by what it '
      + 'drives, and require a report whose text describes a SYMPTOM the player saw to cite at '
      + 'least one guard that drives the real thing (Harness / ui-driver / pool sweep). '
      + 'Exemptions carry their reason inline and are asserted to be still needed, the way '
      + '68-target-conformance and 142-static-conformance do it. '
      + '⚠ Do not make this a denylist of "bad" test shapes — a pure test of the function that '
      + 'WAS the root cause is correct, and six entries prove it.',
    proof: null,
    verify:
      'A `fixed` entry whose report describes a visible symptom, cited only to a guard that '
      + 'builds its own fixture, fails a named test.',
    closed:
      'R182 BUILT THE CLASSIFIER, MEASURED IT, AND REFUSED TO SHIP THE SCREEN — and the refusal '
      + 'is the finding. Applied to the ten entries this ticket rests on, the shape rule does not '
      + 'separate them: the four KNOWN-BLIND classify #43 pure, #45 pure, #53 pure, #18 harness; '
      + 'the six KNOWN-GOOD classify #22 pure, #26 pure, #82 pure, #94 pure, #100 pure, #77 '
      + 'harness. **Three of the blind four are pure-only and so are five of the correct six.** '
      + 'Same shape, opposite verdicts. And #18 breaks it from the other side: its blind guard '
      + 'DOES drive a real Harness and then asserts `legalActions(state, D) === []`, a rules fact '
      + 'that was already true before the fix. So any "a symptom report must cite a guard that '
      + 'drives the real thing" rule flags five honest entries AND still misses one of the four. '
      + 'THE SEPARATING FACT IS "was the tested function the ROOT CAUSE?" — #22\'s publishCols '
      + 'test IS the fix; #45\'s stackItemX test is a correct test of a reader that was never the '
      + 'bug — and that fact exists nowhere in this repo in machine-readable form. '
      + 'WHAT SHIPPED INSTEAD, in 154-guard-shape.test.ts: the instrument, proof it is not blind, '
      + 'the reach measurement, the negative result as a FALSIFIABLE assertion (if the four ever '
      + 'do become distinguishable by shape, that test fails and this can be reopened), and one '
      + 'much weaker rule that IS sound — an entry closed against nothing but pure tests must at '
      + 'least carry a `note`. That catches 2 of the 4, flags #36 and #38, and both are REAL '
      + 'gaps in the record rather than false positives. The pure-only population is 7 of 96. '
      + '⚠ THE CLASSIFIER WENT BLIND TWICE WHILE BEING BUILT, in exactly R176\'s two ways: '
      + 'brace-matching RAW source ran one small test\'s body 24,660 characters past its closing '
      + 'brace (an apostrophe in a comment), crediting a pure test with driving a Harness; and '
      + '`function f(x): { a: T } { … }` handed back the RETURN TYPE as the body. Both are pinned '
      + 'as tests against the real files that exposed them. That is the third and fourth time a '
      + 'source-reading checker in this repo has been caught lying about what it can see.',
    guards: [
      '154-guard-shape.test.ts::the four blind entries are not distinguishable by SHAPE',
      '154-guard-shape.test.ts::an entry closed against nothing but pure tests leaves something behind',
      '154-guard-shape.test.ts::a comment apostrophe does not run a test body away',
      '154-guard-shape.test.ts::every guard reference in the ledger resolves to something this classifier can read',
    ],
    status: 'done',
  },

  // ── filed 2026-08-25 (round 26), from agents' closing "report any real
  // defect that is out of scope for you". That line remains the highest-yield
  // input in the loop: nine of this round's fourteen findings came from it.
  {
    id: 57,
    area: 'card',
    severity: 'major',
    cards: ['Earthbound Replicator', 'Maelstrom Charger'],
    title: 'Two RAQ-settled facts about the copy cards that R164 did not reach',
    detail:
      'R164 made a spell copy a real StackItem. Two things the designer RAQ states plainly are '
      + 'still wrong, and both are now easier to fix than before. '
      + '(a) **Earthbound Replicator checks "targeting me" at RESOLUTION, not at event time.** '
      + 'Its `when` does not test targeting at all — it fires on every nontoken spellPlayed and '
      + "reads the item's CURRENT targets in `run`. So a Divine Intervention or Gravitational "
      + 'Correction retarget resolving in between WRONGLY PRODUCES A COPY, and retargeting away '
      + 'wrongly cancels one that was owed. '
      + '(b) **Maelstrom Charger is built as an ordinary triggered ability**, so it reaches the '
      + 'stack, can be negated BEFORE the copy is ever made, and R121\'s pay-to-trigger gate '
      + '(Crevice Lurker) can tax it.',
    evidence:
      'Both from `[Solved]` threads in `data/rulings/exports/`, quoted verbatim and verified in place '
      + 'by the orchestrator: *"He must be targeted while playing the spell. If the spell is '
      + 'played and target is changed later to him (through Gravitational Correction or '
      + 'Enigmatic Warder mod), you don\'t get a copy"* — and *"Maelstrom Ability is neither '
      + 'Triggered nor Activated, so Crevice Lurker doesn\'t affect it"*, *"Meal copying is not '
      + 'an effect on the stack so enemy cannot interact with it. Opponent can only interact '
      + 'with copy of a spell effect."* '
      + '(a) was found by the R166 agent while working on Origon; (b) by the R164 agent as it '
      + 'landed the copy primitive.',
    fix:
      '(a) is small: move the `targetsMe` test into `when` (R1), so the question is asked at the '
      + 'moment the spell is played. (b) needs a seam that does not exist — a cost-shaped, '
      + 'non-stack, as-you-play decision. The RAQ says it works "kinda like cost (but is still '
      + 'optional due to *may*)". Do (a) first; it is a live wrong answer, and (b) is a shape '
      + 'question worth its own design pass.',
    proof: null,
    verify:
      'Play a spell targeting something else, retarget it onto Earthbound Replicator with '
      + 'Gravitational Correction, let it resolve: no copy. And a negate aimed at Maelstrom '
      + "Charger's ability finds nothing on the stack to hit.",
    closed:
      'R178, both halves, and the owner chose the full seam over the narrow fix. '
      + '(a) Earthbound Replicator now asks the targeting question in `when` (R1). '
      + '⚠ THE BRIEF SAID "move the targetsMe test into when" and that was not achievable as '
      + 'stated — and the reason is load-bearing: **commitItem fires spellPlayed BEFORE '
      + 'pushItem**, so a `when` has no stack to consult. That is exactly why the card was '
      + 'written to read current targets at resolution in the first place. The fix was to put '
      + 'the declared targets and the item id ON THE EVENT, the same argument already made for '
      + '`x`. That also turned CT-58 into an IDENTITY lookup rather than the reverse-scan the '
      + 'brief asked for — reverse-find is a heuristic that happens to be right under today\'s '
      + 'push order; an id is right under any of them. '
      + '(b) Maelstrom Charger: `CardBehavior.asYouPlay` + `E.collectAsYouPlay`, the last '
      + 'stage of the cast window, riding the ordinary cast suspension. All three RAQ facts '
      + 'are now TRUE and each is asserted: it is neither triggered nor activated (Crevice '
      + 'Lurker cannot tax it, guarded on a board where the Lurker DOES stop a real trigger); '
      + 'it is not on the stack (the stack is literally empty while the question is open); and '
      + 'the copy lands above the original. Multi-Charger none/one/two works, and Ancient One '
      + 'projecting the face works because it is a BEHAVIOR_CHANNELS member. '
      + '⚠ WHY NOT pendingCosts/CostMod.sacrifice (R122), which I suggested: R122\'s own doc '
      + 'says an unpayable count gates castability exactly as unaffordable mana does — a cost '
      + 'is MANDATORY once declared, and this is a *may*. Making that collector opt-out-able '
      + 'would give every real cost a door it must not have. '
      + 'It does NOT generalise, and that was measured rather than assumed: "as you play" is '
      + 'on exactly one card in printed.json. Spellbind\'s "as it is played" is {Modular}; '
      + 'Writhing Host\'s is an additional cost. So the seam stays small deliberately.',
    guards: [
      '151-copy-and-moved-mods.test.ts::a spell played at something ELSE and retargeted onto me makes NO copy',
      '151-copy-and-moved-mods.test.ts::a spell played AT ME and retargeted away still makes its copy',
      '151-copy-and-moved-mods.test.ts::the option is asked in the cast window and never reaches the stack',
      '151-copy-and-moved-mods.test.ts::Crevice Lurker cannot tax it',
      '151-copy-and-moved-mods.test.ts::two Chargers are two questions and two copies',
    ],
    status: 'done',
  },
  {
    id: 58,
    area: 'engine',
    severity: 'minor',
    cards: ['Earthbound Replicator'],
    title: 'A third bottom-up `.find()` on the stack survives R166',
    detail:
      'R166 fixed Origon and Hexbane Shiitake, which located a spell on the stack with '
      + '`.find()` — a BOTTOM-UP scan, so with two same-card same-seat items they acted on the '
      + 'older one. Earthbound Replicator (`batch-hybrids-wm-a.ts`) still does it. R164 made the '
      + 'case commoner rather than rarer: a copy and its original are two items with the same '
      + 'card and the same controller by construction.',
    evidence:
      'Reported by the R166 agent, which fixed the two sites it owned and could not touch the '
      + 'third. R164 had already added `!i.copy` to that lookup but not the reverse scan. The '
      + 'correct precedent is in the repo: `[...g.s.stack].reverse().find(...)`. '
      + '⚠ NOT `g.s.stack.reverse()` — that reverses in place.',
    fix:
      'One line, plus a test with two genuine same-card spells on the stack (not a copy — R164 '
      + "already excludes those, so a copy fixture cannot prove the ordering).",
    proof: null,
    verify: 'With two copies of one card on the stack from the same seat, the card acts on the TOP one.',
    closed:
      'R178, and better than the ticket asked. With the item id on the spellPlayed payload the '
      + 'lookup is an IDENTITY match, not `[...stack].reverse().find(...)`. '
      + '⚠ STILL OPEN ELSEWHERE, and now cheaply: Origon (batch-hybrids-fwe.ts) and Hexbane '
      + 'Shiitake (batch-wood-a.ts) both listen to spellPlayed and still carry R166\'s reverse '
      + 'scan plus a paragraph of comment explaining why it happens to work. Both can become '
      + 'identity lookups and lose the paragraph. Carried as CT-69.',
    guards: [
      '151-copy-and-moved-mods.test.ts::with two identical spells on the stack it copies the TOP one',
    ],
    status: 'done',
  },
  {
    id: 59,
    area: 'coverage',
    severity: 'major',
    title: 'The server typechecks nothing, and two of its errors look real',
    detail:
      '`digital-client/server/` has NO `tsconfig.json`, so nothing typechecks it — `npm run '
      + 'check` covers engine and backlog only. `rooms.ts` carries at least 7 pre-existing type '
      + "errors, including two `Object is possibly 'undefined'` at lines 958 and 1084 that read "
      + 'like real defects rather than strictness noise.',
    evidence:
      'Found by the R169 agent while working in replay-room.ts. Related symptom from the same '
      + 'agent: `replay-room.ts` cannot import even a TYPE from `rooms.ts` without dragging `ws` '
      + "and the whole socket layer into any project checking the analysis — the engine's tsc "
      + 'went from clean to 7 errors — so it restates `Fork`/`LostAction` structurally instead, '
      + 'which will silently rot on a rename.',
    fix:
      'Add `server/tsconfig.json`, fix what it finds, and wire it into `npm run check`. Then '
      + 'give the on-disk shapes a shared `server/types.ts` so the analysis tools can import '
      + 'them without importing the socket layer. '
      + '⚠ Expect the two undefined accesses to be real; check them before relaxing anything.',
    proof: null,
    verify: '`npm run check` typechecks the server, and passes.',
    closed:
      'R181. `server/` had no tsconfig AT ALL, and the root `check` line READ as three projects '
      + 'being checked while its middle leg ran `node --test` — and node TYPE-STRIPS, it does '
      + 'not type-check. The compiler had never been pointed at the server. '
      + '⚠ THE DEFECT IT WAS HIDING is the reason this was worth doing. `ActivateVia` has '
      + 'three shapes and three sites in rooms.ts tested `typeof via === \'object\'` then read '
      + '`.mod`. On a `{ face }` activation that is undefined, `undefined - shift` is NaN, and '
      + 'renumberAction wrote NaN back over the face. Undoing an earlier action DESTROYED the '
      + 'payload of any later face-granted activation — it stopped saying which ability it was '
      + 'for, the rebuild refused it, and the undo was declined untraceably. The existing '
      + "undo test could not see it: the payload was destroyed BEFORE it was measured. "
      + '⚠ MY BRIEF WAS WRONG twice: rooms.ts had 5 errors not 7 (the others are in main.ts '
      + 'and two test scripts), and the two `Object is possibly undefined` are STRICTNESS '
      + 'NOISE, not defects — both are `heldEvents[other(seat)]` on a declared 2-tuple, and '
      + '`Seat = number` is what defeats the checker. The agent added a narrowing rather than '
      + 'a `!`, so a hypothetical third seat is a visibly wrong line and not a false assertion. '
      + 'Deploy note: `npm --prefix server install` is needed once for @types/ws; `npm start` '
      + 'and `npm test` are unaffected, so git-pull-and-restart is unchanged.',
    guards: [
      '153-typecheck-reach.test.ts::every .ts file in the client is covered by some tsconfig project',
      '153-typecheck-reach.test.ts::the root `check` script invokes every tsconfig project',
      '153-typecheck-reach.test.ts::every tsconfig has the load-bearing compiler flags on',
      'server/test-forensics.ts::a constructed file with one unusable deck is REFUSED, not substituted',
    ],
    status: 'done',
  },
  {
    id: 60,
    area: 'coverage',
    severity: 'minor',
    title: 'Dead helpers in card files survive because tsconfig has no noUnusedLocals',
    detail:
      'Four zero-call-site helpers were found in `src/cards/sets/`: `batch-light-a::payLife` and '
      + '`batch-dark-c::formationSlot` (both deleted by R174), plus `batch-metal-a::tokensInRegion` '
      + 'and `helpers.ts::lifeGainedIn`, which the R174 agent did not own. `payLife` additionally '
      + 'carried a doc comment asserting a behaviour ("pay n life as a COST at resolution") that '
      + 'all three life-cost cards had moved away from — so a dead function was also the file\'s '
      + 'most confident wrong statement about how those cards work.',
    evidence:
      '`tsconfig` has `strict` but no `noUnusedLocals`, which is why they survived. Found by a '
      + 'zero-call-site scan the R174 agent generalised from the one dead helper it was told '
      + 'about — a good illustration of "if the worklist names one, sweep for the class".',
    fix:
      'Delete the two remaining helpers, then turn on `noUnusedLocals` so the class cannot come '
      + 'back. `147-comment-conformance.test.ts` already guards it from the test side; the '
      + 'compiler flag is the cheaper enforcement. Expect the flag to surface others.',
    proof: null,
    verify: '`npx tsc --noEmit` with noUnusedLocals is clean.',
    closed:
      '`noUnusedLocals` is ON in engine/, server/ and backlog/, and the 46 dead bindings it '
      + 'found in the engine are cleared — so `npm run check` is green end to end rather than '
      + 'red on the engine leg. Both deferred helpers deleted. '
      + '⚠ THE FLAG COVERS ONLY HALF THE CLASS, and this is the part worth remembering: **tsc '
      + 'ignores EXPORTED declarations**, so `noUnusedLocals` would NEVER have caught '
      + '`helpers.ts::lifeGainedIn`, which was exported. 147-comment-conformance §4\'s '
      + 'call-site sweep is what catches exported dead code. Neither mechanism subsumes the '
      + 'other and both are needed. '
      + '⚠ The `_`-prefix escape hatch is narrower than it looks — measured: `_` exempts an '
      + 'unused binding only inside a DESTRUCTURING PATTERN; a plain `const _x = …` and an '
      + 'unused import still error. So plain `noUnusedLocals` with no convention. '
      + 'Three of the 46 were more than tidying: an unused `ResourceKind[]` constant in '
      + 'apply.ts; a `const A = initiative === deployPlayer ? deployPlayer! : deployPlayer!` in '
      + '04-mods with BOTH BRANCHES IDENTICAL and then never read; and two dead helper '
      + 'FUNCTIONS in test/ (28-metal-c::constructedTurn, 36-cache-prophecy::cacheIdx) that '
      + 'sit outside 147 §4\'s sweep, which walks only src/cards/sets. That gap is CT-68.',
    guards: [
      '153-typecheck-reach.test.ts::every tsconfig has the load-bearing compiler flags on',
      '147-comment-conformance.test.ts::no card-file helper has zero call sites',
    ],
    status: 'done',
  },
  {
    id: 61,
    area: 'coverage',
    severity: 'major',
    title: '65-effect-conformance is a knife edge that any behaviour change trips',
    detail:
      'The R166 agent had to edit three card files it did not own — Adversary of the Deep, '
      + 'Aethercap Siphoner, Flux Constructor — because its behaviour changes moved '
      + "`65-effect-conformance`'s 140-game FUZZ DRIVE onto three pre-existing bare `return`s "
      + 'that nothing had reached before. It reported: **"this will recur every round".** It is '
      + 'right, and it already recurred once — Earthbound Replicator\'s own comment records the '
      + 'same thing happening under R84.',
    evidence:
      'The assertion is correct and worth keeping (a silent `return` is the single most '
      + 'productive bug shape this repo has found). The problem is the DRIVE: which branches a '
      + 'fuzz reaches is a function of unrelated behaviour, so the test fails in files the '
      + 'change never touched, and the fix is always "add a g.ev(\'info\') to a card you do not '
      + 'own" — which is how an agent ends up editing outside its file set, twice in one round.',
    fix:
      'Two candidates, and the choice is the ticket. (1) Replace the fuzz drive with a '
      + 'deterministic pass over every effect branch, so reach stops depending on unrelated '
      + 'behaviour — the same argument that made 81-card-drill walk every card instead of '
      + 'sampling. (2) Or keep the fuzz and pre-emptively sweep every bare `return` in the card '
      + 'files NOW, so there is nothing left for a future change to uncover. '
      + '(2) is cheaper today and (1) is the actual fix.',
    proof: null,
    verify:
      'A behaviour change in one card file does not redden 65-effect-conformance in another.',
    closed:
      'R182 took option (1): the 140-game FUZZ drive is replaced by a DETERMINISTIC pass over '
      + 'every EffectDef in the registry, in two fixed board states, with the context built '
      + "from the engine's own machinery (targets from targetCandidates + specForSlot + "
      + 'resolveTargetRef; a triggered ability\'s event accepted only if that ability\'s own '
      + '`when` returns true, asked on a CLONE because R172\'s Ancient One mutates in `when`). '
      + 'Reach is an EQUALITY now, not a floor, so the test can no longer be satisfied by a '
      + 'drive that quietly stops reaching things. '
      + 'REACH MEASURED BOTH WAYS, which is what the ticket demanded: fuzz 280/431 defs, '
      + '272/413 cards, 49 token-makers, ~45s -> deterministic 430/430 defs, 413/413 cards, '
      + '76/84 token-makers, ~2s. Strictly better on every axis, so no bad trade was made '
      + 'silently. '
      + 'AND IT FOUND SIXTEEN SILENT BRANCHES the fuzz never reached, FIFTEEN OF ONE SHAPE: '
      + 'R25\'s "each opponent" loop over a region that holds nobody else runs zero times and '
      + 'says nothing (Bloated Manablub, Blightmound, Linked Extinction, Void Memory — whose '
      + 'own comment CITES R25 and still does not announce it — Growing Plague, Malicious '
      + 'Hardware, Pestilent Mycelion, Rotwall, Verdant Necrophage, and their graft halves). '
      + 'All are in SILENT_KNOWN with reasons and a self-invalidating test, so a fix cannot '
      + 'land without the entry coming off. Carried as CT-70. '
      + 'Three effects are named residue the rig cannot furnish (Ancient One needs a formation '
      + 'column, Riftwalker a battle grid holding both, Roving Quillback a blocked column), '
      + 'and the R104 replacement path is stated as a coverage loss the fuzz occasionally had '
      + '— named individually rather than counted, which is what the ticket asked for.',
    guards: [
      '65-effect-conformance.test.ts::drive every effect in the registry',
      '65-effect-conformance.test.ts::no effect resolves into silence',
      '65-effect-conformance.test.ts::the drive actually covers the pool',
      '65-effect-conformance.test.ts::the residue is named individually',
    ],
    status: 'done',
  },
  {
    id: 62,
    // 'engine' rather than a new 'rules' area: what is wrong here is an ENGINE
    // DEFAULT that nobody ever decided, which is exactly the shape this area
    // describes. The ruling is the fix, not a separate kind of work.
    area: 'engine',
    severity: 'major',
    title: 'A blocked column whose blockers have all left deals no damage — engine default, never ruled',
    detail:
      'If every blocker on a column is removed mid-combat, the attacking column still connects '
      + 'with nothing: *"Column 1 is blocked (blockers gone) — no damage through."* Reachable '
      + "today by Download's mid-battle steal, and by every other mid-combat removal.",
    evidence:
      'Found by the R172 agent while pinning Download. It is plausibly the correct reading of '
      + "R72's after-blocks lock — but **nothing in `docs/digital-rules.md` or the Manual says "
      + 'so**, whereas the Manual IS explicit about the mirror case (a blocker whose attackers '
      + 'all died "stays, but has nothing to deal damage to"). So one direction is ruled and the '
      + 'other is an accident of implementation.',
    fix:
      'ASK THE OWNER. Given the standing steer — take the permissive reading, more things happen '
      + '— "the column connects" is at least as defensible and makes every mid-combat removal '
      + 'considerably stronger. The current behaviour is pinned in `145-erase-routes.test.ts` '
      + 'test (viii) with a comment saying explicitly that it is the pre-existing rule and not '
      + "R172's doing, so flipping it later touches one assertion.",
    proof: null,
    verify: 'The answer is written down as a ruling, whichever way it goes.',
    closed:
      'R185 — the owner ruled it and NO BEHAVIOUR CHANGED: the column stays blocked. Removing a '
      + 'blocker mid-combat does not un-declare the block; in his framing removal "protected '
      + 'nothing but still cost them a card". The alternative was put to him explicitly (killing '
      + 'or stealing a blocker becomes a way to push damage through, making every mid-combat '
      + 'removal much stronger) and declined. '
      + 'What changed is that it is a RULE with a test under it, on all FOUR routes a blocker '
      + 'can leave — dies, recalled, erased, stolen (Download, R172) — where only the death '
      + 'route had ever been tested. '
      + '⚠ AND THE DEATH-ROUTE TEST DID NOT GUARD THIS RULE. 02-combat\'s "blocked column stays '
      + 'blocked" uses Good Whale, which is {Piercing}, and Piercing carries through a '
      + 'blocked-but-empty column BY DESIGN. Measured: inverting the rule reddens all four cases '
      + 'in 157 and leaves 02-combat at 5/5 GREEN. It measures the piercing rule, not the '
      + 'blocking rule — the same "a guard that cannot fail on the behaviour it names" shape as '
      + 'CT-56, found here by mutation rather than by reading. The attacker in 157 is '
      + 'deliberately vanilla, and a negative control leads the file so the four assertions '
      + 'cannot pass on a board where nothing was going to connect anyway.',
    guards: [
      '157-blocked-stays-blocked.test.ts::an UNBLOCKED column really does connect',
      '157-blocked-stays-blocked.test.ts::a blocker that DIES leaves the column blocked',
      '157-blocked-stays-blocked.test.ts::a blocker that is RECALLED leaves the column blocked',
      '157-blocked-stays-blocked.test.ts::a blocker that is ERASED leaves the column blocked',
      '157-blocked-stays-blocked.test.ts::a blocker STOLEN mid-combat (Download) leaves the column blocked',
    ],
    status: 'done',
  },
  {
    id: 63,
    area: 'client',
    severity: 'minor',
    reportId: 103,
    title: 'Playable cached cards should sit at the RIGHT of the hand, as well as in the cache',
    detail:
      'Owner, GYSR 2026-08-25: cached cards (from a glimpse or a prophecy) that CAN BE PLAYED '
      + 'should appear on the right-hand side of the hand area — "it feels like they are in your '
      + 'hand (which they should), is clearly different from cards in hand (they are on the '
      + 'left) and they are harder to just forget about." '
      + '⚠ It is explicitly ADDITIVE: "They should also be in the cache area as they are now, '
      + 'this is just an easier way to see and play them." So this is not a defect in the cache '
      + 'UI and the cache row must not be moved or emptied — it is a SECOND, closer surface for '
      + 'the same cards, and only for the ones that are actually playable right now.',
    evidence:
      'Playtest report #103, filed mid-round. The "harder to forget" half is the substance: a '
      + 'cached card expires (playableUntilTurn), so forgetting it is a real, silent loss, and '
      + 'the cache row sits away from where a player is looking when they decide what to play. '
      + 'Same family as BL-16 and BL-21, which are both about a surface being present but '
      + 'unreadable at the moment it matters.',
    fix:
      'Render the playable subset of the cache into the right of the hand strip, keeping the '
      + 'cache row unchanged. `ui/inspect.ts::playableCachedNames(cache, legal)` already answers '
      + 'exactly "which cached cards are playable right now" and is tested — so this is a '
      + 'rendering change with the judgement already lifted out, not new logic. '
      + '⚠ Check it against CT-54 first: the hand\'s `.card.playable` outline OR-folds five '
      + 'different actions into one glow, so adding a second CLASS of card to that strip without '
      + 'fixing the outline makes the ambiguity worse, not better. Do CT-54 with it or before it.',
    proof: null,
    verify:
      'With a playable cached card, it appears at the right of the hand AND in the cache row, '
      + 'and clicking either plays it. With an unplayable one, it appears only in the cache.',
    closed:
      'R183, additive exactly as the owner asked — `regionCacheHtml` and the cache dialog are '
      + 'untouched. The group carries the EXPIRY chip (this turn / free), not the price, '
      + 'because a glimpse stamp dies silently at end of turn and forgetting it is the actual '
      + 'loss he described. It reuses the cache row\'s own data-act/data-p/data-i so '
      + '`handleCacheClick` stays the single handler and the two surfaces can never come to '
      + 'play different cards, and it deliberately carries NO anim key, since the cache row '
      + 'already draws these entries and a duplicate motion key would give one flight two '
      + 'landing spots. '
      + '⚠ MY BRIEF WAS WRONG that "clicking either plays it": the cache row\'s THUMBS carry '
      + 'no handler at all — the click is caught one level up by the panel, which opens the '
      + 'dialog. So playing a cached card was a two-click path whose first click looked like '
      + 'the last. That is CT-64, and it is plausibly part of why this was reported.',
    guards: [
      '155-hand-affordances.test.ts::a playable cached card is drawn at the right of the hand AND left in the cache row',
      '155-hand-affordances.test.ts::clicking the copy beside the hand plays the cached card',
      '155-hand-affordances.test.ts::a cached card that is NOT playable now stays in the cache row and out of the hand',
    ],
    status: 'done',
  },
  {
    id: 64,
    area: 'client',
    severity: 'minor',
    title: 'A cached card takes two clicks to play, and the first one looks like the second',
    detail:
      "`regionCacheHtml` renders its thumbs as `cardHtml(card, { anim })` with **no `data-act`**, "
      + 'while the entries in the full dialog (`cacheCardHtml`) carry `data-act="cache" data-p '
      + 'data-i`. The whole panel is `data-btn="cacheopen"`, so clicking a thumb bubbles up and '
      + 'OPENS THE DIALOG. It is therefore not a dead control — it is a two-click path where the '
      + 'first click looks like it should have been the last one.',
    evidence:
      'Found by the R183 agent while building the hand-side surface for report #103. ⚠ It '
      + 'characterised these thumbs as taking no card clicks, which is true of the thumbs '
      + 'themselves; I checked the panel and the click is caught one level up, so nothing is '
      + 'unreachable. That is exactly why it never read as broken. '
      + 'It is plausibly part of why report #103 was filed at all — "harder to just forget '
      + 'about" is partly "harder to actually reach".',
    fix:
      'Give the thumbs the same `data-act="cache" data-p data-i` the dialog entries use. '
      + '⚠ THERE IS A REAL TRADE-OFF, so decide it rather than defaulting: if a thumb plays the '
      + 'card directly, the one-click route to INSPECTING a cached card goes away, and the cache '
      + 'is public (R41) precisely so both players can look at it. A middle answer — thumb plays '
      + 'only when the card is playable right now, and opens the dialog otherwise — matches what '
      + 'R183 just did in the hand strip and is probably right. '
      + 'Much of the pressure is already off: R183 put the playable subset beside the hand with '
      + 'a real one-click handler, so this is now a consistency fix rather than a reachability '
      + 'one.',
    proof: null,
    verify:
      'Clicking a playable cached card in the region cache panel plays it, or opens the dialog, '
      + 'according to whatever is decided — and the decision is written down.',
    guards: [
      '163-cache-affordance-and-badges.test.ts::a playable cached card plays on the FIRST click',
      '163-cache-affordance-and-badges.test.ts::an unplayable cache thumb carries no affordance',
      '163-cache-affordance-and-badges.test.ts::with two live entries the thumb plays the one it was drawn for',
    ],
    closed:
      'R192 (2026-08-26). THE DECISION, as this entry\'s verify line required it to be written '
      + 'down: a thumb plays on the first click WHEN AND ONLY WHEN the entry is playable right '
      + 'now; every other thumb, and every other pixel of the panel, still opens the dialog. '
      + 'It uses literally the same predicate as the hand-side strip '
      + '(playableCachedIndexes(legalFor(p))), so the two surfaces cannot disagree about which '
      + 'entry is live. R41 inspection is barely touched — the label, the summary line and every '
      + 'unplayable thumb still open the zone in one click, and right-click still inspects any '
      + 'thumb. Augment/graft-only entries and decision-target candidates deliberately keep the '
      + 'dialog route. '
      + '⚠⚠ THIS ENTRY\'S OWN PRESCRIBED FIX WAS WRONG, AND WOULD HAVE PASSED THE TEST ANYWAY. '
      + 'It said "give the thumbs the same data-act=\"cache\" the dialog entries use". The '
      + 'document click listener asks closest(\'[data-btn]\') FIRST and only then '
      + 'closest(\'[data-act]\'), and the panel IS a data-btn="cacheopen" ANCESTOR — so a '
      + 'data-act on a thumb loses to it at any depth in a real browser. The attribute that wins '
      + 'is a data-btn ON THE THUMB ITSELF (closest matches the element before any ancestor). '
      + 'And it would have gone GREEN in ui-driver.ts, whose fake closest() has no ancestors and '
      + 'so has no panel to lose to. That driver blindness is now CT-75. '
      + 'Orchestrator verified independently: applying the NAIVE version (every thumb gets the '
      + 'affordance) reddens §2 and §3; restored, 5/5 green.',
    status: 'done',
  },
  {
    id: 65,
    area: 'client',
    severity: 'minor',
    title: 'cardHtml emits runs of spaces in a badge class, and it made a test unfalsifiable',
    detail:
      "`cardHtml` builds a chip's class as `` `badge ${b.mod ? 'mod' : ''} ${b.ctr ? 'ctr' : ''} "
      + "${b.cls ?? ''}` ``, so a plain chip renders a class attribute of `badge` followed by "
      + 'THREE spaces, and a classed one `badge` + three spaces + `proph on` — two empty slots '
      + 'in the middle and usually a trailing '
      + 'space. CSS does not care. **Naive space-separated regexes and selectors written against '
      + 'a badge\'s classes silently never match.**',
    evidence:
      'The R183 agent hit this in its own red-check: an assertion of the form `/badge offer/` '
      + 'could NEVER have matched, so the test passed for a reason unrelated to what it claimed '
      + 'to check. It found it only because a mutation that should have reddened the test did '
      + 'not. It now reads `/badge[^"]*offer/`, with a comment. '
      + 'This is the same family as CT-56 — a test that cannot fail on the thing it names — but '
      + 'the CAUSE here is in the code under test rather than in the test, which makes it worse: '
      + 'the next person writing a badge assertion will hit it too.',
    fix:
      "One line: `[...].filter(Boolean).join(' ')`. The R183 agent deliberately left it alone "
      + 'because it churns expected markup in other agents\' test files mid-round. Do it when '
      + 'the tree is quiet, then grep `test/` for badge-class assertions and check none of them '
      + 'was passing only because of the extra spaces — that is the real work, and it is the '
      + 'reason this is filed rather than done.',
    proof: null,
    verify:
      'A badge chip\'s class attribute has single spaces and no trailing space, and every '
      + 'existing badge assertion still passes for a reason it can state.',
    guards: [
      '163-cache-affordance-and-badges.test.ts::a badge chip class has single spaces and no trailing space',
    ],
    closed:
      'R192 (2026-08-26). One line, as the entry said: the chip class is now '
      + "['badge', mod, ctr, cls].filter(Boolean).join(' '). "
      + 'THE TAIL — which is why this was filed rather than done — came back CLEAN, and it was '
      + 'MEASURED rather than assumed. All 57 `badge` mentions in engine/test/ were '
      + 'cross-checked against the 12 cls values the UI actually emits. Exactly FOUR assert '
      + 'against a badge CLASS ATTRIBUTE, all in 155-hand-affordances (lines 189/220/241/386), '
      + 'and all four already carry R183\'s [^"]* workaround — so all four match the SAME set of '
      + 'chips before and after. **None was lying and none needed repair**; 155 is 10/10 green '
      + 'under both shapes of the emitter. Everything else asserts on Badge OBJECTS or '
      + 'packBadgeLine\'s pure output, never on a class string. No test repaired, none renamed. '
      + '⚠ THE SAME DEFECT SURVIVES ONE ELEMENT UP: cardHtml\'s card div emits '
      + '`class="${cls.join(\' \')}" ${opts.data ?? \'\'} data-prev=…`, a double space when '
      + '`data` is absent. Left alone deliberately — it churns card-div markup in other agents\' '
      + 'expected strings mid-round, which is the exact reason this entry existed. Carried as '
      + 'CT-75.',
    status: 'done',
  },
  {
    id: 66,
    area: 'coverage',
    severity: 'blocker',
    title: 'Version the saved games against the engine that produced them',
    detail:
      'CT-51 established the diagnosis: every divergence in the corpus is a DELIBERATE rules '
      + 'change, none is a regression, and a saved game survives about three hours of rules '
      + 'work. The logs are sound; the reader moved. That is exactly the failure versioning '
      + 'fixes, and the alternative — retiring forensics for unit tests — would be throwing away '
      + 'good evidence because we lost the decoder ring.',
    evidence:
      'The CT-51 investigation replayed all 22 server games across 170 commits. 20 of 22 '
      + 'diverge; median replayable prefix ~30%. It also hand-built the proposed tool six times '
      + '(detached worktree at the recorded SHA) and got a CLEAN replay in 5 of 6 cases in '
      + 'seconds each — so the approach is demonstrated, not theoretical.',
    fix:
      'Four parts, in order. '
      + '(1) Stamp `engineVersion` (commit SHA) into the room file at creation AND on every fork '
      + 'entry — VEAV proves one stamp per file is not enough, because a forked file is two '
      + 'games recorded against two engines. No such field exists today. '
      + '(2) `replay-room.ts --as-recorded`: spin a detached worktree at that SHA and replay '
      + 'there. '
      + '(3) **Report the DELTA between the two replays, not the refusal.** This is the part '
      + 'that matters: without a reference engine to diff against, the tool structurally CANNOT '
      + 'name the real divergence, which is why it is off by up to six actions today. A ~50-line '
      + 'per-action state-signature probe is the working prototype. '
      + '(4) Mark GAXG and HDGG unreplayable (no recorded trio) so they stop being counted. '
      + '⚠ Unit tests remain the right answer for games ALREADY past saving — everything '
      + 'recorded before `engineVersion` exists. Versioning only helps from here forward, so do '
      + 'it soon: the cost of waiting is measured in dead prefixes per round.',
    proof: null,
    verify:
      'A game saved today still replays cleanly a week and fifty rules commits later, via '
      + '--as-recorded, and the tool names what changed between then and HEAD.',
    guards: [
      '171-engine-version-stamp.test.ts::an unstamped file says so, and says what to do about it',
      '171-engine-version-stamp.test.ts::a forked file is two games against two engines',
      '171-engine-version-stamp.test.ts::a draft file with no recorded trio is UNREPLAYABLE, not diverged',
      '171-engine-version-stamp.test.ts::a truncated copy of a game is caught by the canonical file',
      '171-engine-version-stamp.test.ts::a game saved today replays IDENTICALLY at the engine it was recorded on',
      '171-engine-version-stamp.test.ts::against an OLDER engine the tool NAMES what changed',
      '171-engine-version-stamp.test.ts::a refusal index is reported as an UPPER BOUND',
      'server/test-forensics.ts::a room file with no `versions` field restores exactly as it always did',
      'server/test-forensics.ts::and its first stamp starts where the unstamped log ENDS',
    ],
    closed:
      'R200 (2026-08-26). All four parts. `Room.versions` is a LEDGER, one VersionStamp per '
      + 'engine naming the action index it took over at — stamped in resetSegment (every fresh '
      + 'log passes through it) and appended by restoreRooms on any commit change for a live '
      + 'room WHETHER OR NOT ANYTHING WAS LOST, because the loss-free rules change is the case '
      + 'that previously left no trace at all. `--as-recorded [--at <sha>]` spins a detached '
      + 'worktree and runs a copied replay-probe there. GAXG/HDGG are classified unreplayable '
      + '(own verdict, own exit code) instead of throwing. '
      + '⚠⚠ FOUR CORRECTIONS TO MY BRIEF, and the third is the one to remember: '
      + '(1) "make the tool report the FIRST divergence and the cascade as a cascade — the '
      + 'highest-value line you can add" was ALREADY DONE by R169/CT-45 at the base commit. '
      + '(2) "late by up to SIX actions" understated it badly: measured against dbe6f84, SMVJ is '
      + '1 action late and ANBB is **93** — first refusal [125], boards actually part at [32]. '
      + '(3) THE FIRST DIFFERENCE IS NOT THE FINDING EITHER, which nobody had said: two engines '
      + 'part and COME BACK. SMVJ differs at signature 100, AGREES AGAIN 111-120, and parts for '
      + 'good at 121 — a naive per-action probe would report [99], swapping a point measured '
      + 'late for one measured early. The tool reports the index after which they never agree '
      + 'again, and lists healed differences separately as rules changes the log survived. '
      + '(4) "GYSR FAITHFUL" is not a meaningful statement about GYSR: it replays 0-refusal at '
      + 'HEAD, but dbe6f84 refuses 142 of its actions, so that is demonstrably not its engine — '
      + 'and GYSR does not say what recorded it, so nothing can tell us whether HEAD\'s clean '
      + 'replay is the game that was played. That is the whole argument for this ticket. '
      + 'HONEST LIMIT, stated in R200: versioning only helps FROM HERE FORWARD. Unit tests stay '
      + 'the right answer for everything recorded before the field existed. '
      + 'DEPLOY: additive and backward-compatible (sanitizeVersions returns [] for a missing '
      + 'field, guarded); no migration; cost is one restart, and every live room takes one extra '
      + 'persist on first boot. A file with no stamp gets its first stamp at the log\'s END, '
      + 'never backdated to 0 — claiming the current commit over an older engine\'s log would '
      + 'send --as-recorded to the wrong rules. '
      + '⚠ THREE OF ITS RED-CHECKS REFUSED TO GO RED AND ALL THREE WERE FIXTURE BUGS, not fix '
      + 'bugs — including the R186 trap exactly as warned (a fixture with ZERO entities, so '
      + 'renumbering mutated an empty map) and an assertion indexing `later[k-1]` at k=0, which '
      + 'passed for every possible input. The third exposed real DEAD CODE: the stamp in '
      + 'createRoom was overwritten one line later by resetSegment. '
      + 'The collision it flagged with R191 was already resolved — both agents independently '
      + 'excluded `kind: \'changed\'` from analyze()\'s declaredIdx.',
    status: 'done',
  },
  {
    id: 67,
    area: 'engine',
    severity: 'minor',
    title: 'Three small truth-in-reporting defects found while building the hand-entry primitive',
    detail:
      '(a) **Worldbender fabricates a `draw` event for a draw that does not happen.** '
      + '`batch-metal-c.ts` emits `g.ev(\'draw\', "…skips the draw phase…")` as a LOG LINE. It '
      + 'is a real `draw` event in the stream with no `n`, and inside a battle window it would '
      + 'be dispatched to draw listeners as a draw that moved no cards. It should be `info`, or '
      + 'a real draw. '
      + '(b) **`afterDespawn` recovers the despawn event as `this.events[this.events.length - '
      + '1]`** — a positional read of a global array, now one line further from its `ev()` call '
      + 'because `toHand` runs just before it and appends events of its own. Correct today by '
      + 'ordering alone; a future edit that moves the push after the announce breaks despawn '
      + 'dispatch SILENTLY. It deserves an explicit handle, not an index. '
      + '(c) **A fork records only refusals, never silent state change.** `LostAction.kind` has '
      + 'a `\'changed\'` arm and the restore path only ever pushes `\'lost\'`. A restart onto '
      + 'an engine that ACCEPTS every action while producing a different board leaves no trace '
      + 'at all — which is precisely the case CT-66 is being built to detect.',
    evidence:
      '(a) and (b) from the R179 agent, (c) from the CT-51 investigation. All three are '
      + '"the record says something that is not so", which is the class that made CT-51 take a '
      + 'full round to diagnose.',
    fix:
      'Each is small and independent. (c) is the one to do alongside CT-66, since a fork that '
      + 'cannot record a silent divergence undercuts the whole versioning story.',
    proof: null,
    verify:
      'No card emits a typed event for something that did not happen; afterDespawn names its '
      + 'event rather than indexing for it; a restart that changes the board without refusing an '
      + 'action is recorded.',
    guards: [
      '162-item-identity-and-truthful-events.test.ts::Worldbender: the skipped draw phase is announced, not FAKED',
      '162-item-identity-and-truthful-events.test.ts::afterDespawn dispatches the DESPAWN event even when another event is appended',
      // ⚠ cited by ok() LABEL, not by the console.log section header — the guard
      // checker resolves labels, and a section banner is not one.
      'server/test-forensics.ts::a fork IS recorded for a restore that refused nothing',
      'server/test-forensics.ts::no keys on disk, no drift reported',
      'server/test-forensics.ts::and no fork invented for a file that simply predates the field',
    ],
    closed:
      'R191 (2026-08-26). All three. (a) Worldbender\'s line is `info`. (b) afterDespawn takes '
      + 'the despawn event as a PARAMETER; both callers hand over what ev() returned. (c) '
      + '`persist` writes each action\'s reference key (`refs`, additive); a restore compares '
      + 'them (`driftedAgainst`) and records mismatches as kind: \'changed\'. '
      + '⚠ ALL THREE OF MY MECHANISMS WERE WRONG, though all three defects were real: '
      + '(a) "inside a battle window it would be dispatched to draw listeners" is FALSE — E.ev() '
      + 'only appends; dispatch is E.fireEvent, never called for that line, in any window. The '
      + 'defect is confined to the event STREAM, and the real victims are its readers '
      + '(server/stats.ts scans e.type for account stats and achievements). The agent fixed the '
      + 'type and refused to fabricate a listener assertion. '
      + '(b) "now one line further because toHand (R179) runs just before it" is WRONG — toHand '
      + 'runs before the ev(\'despawned\'), not between the ev() and the read, and the engine\'s '
      + 'own R179 comment says so. The distance never changed and the index is still correct at '
      + 'HEAD. It is LATENT fragility, so the test has to CREATE the future edit. '
      + '(c) "make the changed arm reachable" — it was already reachable; undoActionAt has always '
      + 'produced it. What could not reach it was the RESTORE path specifically. '
      + '⚠ THE AGENT DECLINED TO DRESS UP THREE RETENTION GUARDS AS BUG-FINDING: tests 2, 4 and '
      + '5 do not redden on any revert, because the old code carried !i.copy too. Stated plainly '
      + 'rather than claimed. That is the standard to hold. '
      + 'FOUND IN PASSING: two spellPlayed test FIXTURES were not the event the engine emits — '
      + '140-layers-and-riders and 93-engine-defects both omitted `item` while their comments '
      + 'claimed "as commitItem builds it". Fixed; the same rot likely exists in other fixtures. '
      + '⚠ `refs` grows a saved game by ~30KB per 276 actions, and a change to referenceKey\'s '
      + 'output is a change to the saved-game FORMAT until CT-66\'s stamp covers it.',
    status: 'done',
  },
  {
    id: 68,
    area: 'coverage',
    severity: 'minor',
    title: 'The dead-code sweeps have a gap and a stale exemption list',
    detail:
      '`147-comment-conformance.test.ts` §4 sweeps for zero-call-site helpers, and two things '
      + 'are wrong with it now. (a) Its `DEAD_EXEMPT` list names `tokensInRegion` and '
      + '`lifeGainedIn`, **both of which were deleted by R181** — and nothing asserts that an '
      + 'exemption still matches something, so the list is silently lying. That is the same '
      + 'failure class as a park note that outlived its cause, which is the very thing R174 '
      + 'built that file to prevent. (b) It sweeps only `src/cards/sets`, so dead helper '
      + 'FUNCTIONS in `test/` are outside its reach — `28-metal-c::constructedTurn` and '
      + '`36-cache-prophecy::cacheIdx` were found by `noUnusedLocals` instead, and only because '
      + 'they happened not to be exported.',
    evidence:
      'Reported by the R181 agent, which also established the important limit: **`tsc` ignores '
      + 'EXPORTED declarations**, so `noUnusedLocals` would never have caught `lifeGainedIn`. '
      + 'The two mechanisms are complementary and neither subsumes the other — which is exactly '
      + 'why the exemption list going stale matters.',
    fix:
      'Assert every `DEAD_EXEMPT` entry still resolves to a real declaration (drop the two that '
      + 'do not), and widen §4 past `src/cards/sets`. '
      + '⚠ The `_`-prefix escape hatch is narrower than it looks: measured, `_` exempts an '
      + 'unused binding only inside a DESTRUCTURING PATTERN. A plain `const _x = …` and an '
      + 'unused import still error.',
    proof: null,
    verify: 'A stale exemption fails the suite, and a dead helper in test/ is caught by the sweep.',
    guards: [
      '147-comment-conformance.test.ts::every DEAD_EXEMPT entry still names a real declaration',
      '147-comment-conformance.test.ts::the sweep can see a dead helper — positive control over a synthetic file',
      '164-sweep-sight.test.ts::stripCode reads `${ … }` inside a template literal as CODE',
      '164-sweep-sight.test.ts::a violation planted anywhere in engine.ts is seen by all three whole-file sweeps',
      '164-sweep-sight.test.ts::the nested-template hole hides no swept idiom in src/',
      '164-sweep-sight.test.ts::no sweep in 90-coverage-census is reading an empty population',
    ],
    closed:
      'R193 + R201 (2026-08-26), and the ticket was the smaller half of what it found. '
      + 'R193: both stale exemptions dropped, every DEAD_EXEMPT entry now asserted to name a '
      + 'real declaration, and the scan widened from src/cards/sets to src/ + test/ + scripts/ '
      + '(30 files/231 decls -> 204 files/1392 decls). '
      + '⚠⚠ THE REAL FIND WAS stripCode\'s THIRD BLINDNESS. Its `tpl` state had no notion of '
      + '`${ … }`, so a NESTED template inverted parity — the inner opening backtick read as the '
      + 'outer\'s closing tick, swallowing the code before it and handing the inner string body '
      + 'back as CODE. Measured: engine.ts leaked 10 lines; ui/main.ts leaked 368 and BLANKED '
      + '911 lines of real code. A real z.bin.push() planted inside a nested template in '
      + 'src/rng.ts left ALL NINE tests of 90-coverage-census GREEN — a live bypass of the '
      + 'R124/R145 bin choke point, invisible to every sweep that rests on this helper. '
      + 'FIXED as R201 (a brace-depth stack); the orchestrator verified the planted bypass now '
      + 'reddens 90 and that the ui/ exclusion R193 had just been forced to add could come '
      + 'straight back out. NINE of the ten dead helpers it had reported were false positives OF '
      + 'THE BLINDNESS. '
      + '⚠ THE TENTH EXPOSED A SECOND CHECKER DEFECT, found by the orchestrator: the sweep built '
      + 'its matcher as `new RegExp(\'\\\\b\' + name + \'\\\\b\')`, and `$` is a legal JS '
      + 'identifier character AND a regex end-anchor — so `\\b$app\\b` reads as "end of input, '
      + 'then app" and can NEVER match. ui/main.ts::$app is used on eight lines and read as '
      + 'dead. `\\b` is also the wrong boundary for `$` regardless. Now an identifier '
      + 'lookaround, red-checked in both directions. '
      + '⚠ MY BRIEF WAS WRONG TWICE and the ticket wrong three times: tsconfig ALREADY has '
      + 'noUnusedLocals (R181), and §4\'s own doc comment still claimed otherwise; the header\'s '
      + '"stripCode is blind today in a second place" was stale (R181 fixed it) and R174\'s '
      + 'repair had become HARMFUL, mangling 40 lines; and widening §4 as the ticket wrote it, '
      + 'without first fixing the `${ … }` blind spot, would have produced a 75%-FALSE-POSITIVE '
      + 'sweep (45 reported, 34 false). '
      + 'CONFIRMED BY MEASUREMENT, not assumed: tsc ignores EXPORTED declarations (planted the '
      + 'same helper twice — exported: exit 0; unexported: TS6133), so the two mechanisms are '
      + 'complementary and neither subsumes the other.',
    status: 'done',
  },
  {
    id: 69,
    area: 'card',
    severity: 'minor',
    cards: ['Origon', 'Hexbane Shiitake'],
    title: 'Two stack lookups can stop being heuristics now that the event carries the item',
    detail:
      'R178 put the played item\'s ID on the `spellPlayed` payload, so a card that wants "the '
      + 'spell that was just played" can match on identity. Origon (`batch-hybrids-fwe.ts`) and '
      + 'Hexbane Shiitake (`batch-wood-a.ts`) still use R166\'s `[...g.s.stack].reverse().find('
      + 'i => i.card === name && i.controller === seat && !i.copy)`, and each carries a paragraph '
      + 'of comment explaining why a reverse scan happens to be right.',
    evidence:
      'Reported by the R178 agent, which converted Earthbound Replicator the same way. Reverse-'
      + 'find is correct under TODAY\'s push order and is a heuristic under any other; an id is '
      + 'correct under all of them. The paragraph of justification is itself the tell.',
    fix:
      'Match on `ev.data.item`. The explanatory comments come out with the scan. '
      + '⚠ Keep the `!i.copy` reasoning: R164 established that a copy is not PLAYED, so a card '
      + 'keying off a play must still not see one — that is a separate question from which item '
      + 'the lookup finds, and switching to an id must not quietly answer it differently.',
    proof: null,
    verify: 'Both cards act on the item the event names, with two identical spells on the stack.',
    guards: [
      '162-item-identity-and-truthful-events.test.ts::Origon negates the item the play event NAMES',
      '162-item-identity-and-truthful-events.test.ts::Hexbane Shiitake exchanges for the item the play event NAMES',
      '162-item-identity-and-truthful-events.test.ts::no play event ever names a COPY',
    ],
    closed:
      'R191 (2026-08-26) for BOTH NAMED CARDS. Origon and Hexbane Shiitake match on '
      + '`ev.data.item`; the paragraphs of justification came out with the reverse scans. '
      + 'THE !i.copy QUESTION WAS VERIFIED RATHER THAN ASSUMED, which this entry required: '
      + '`pushSpellCopy` never routes through `commitItem`, so no spellPlayed event can ever '
      + 'name a copy — the id path excludes copies for a STRONGER reason than the scan did. '
      + '⚠⚠ THE CLASS IS THREE CARDS, NOT TWO, AND THIS ENTRY\'S FIX CANNOT REACH THE THIRD. '
      + 'Void Mandible (batch-light-c.ts:633) prints "When a nontoken card is played during '
      + 'battle, sacrifice me. If you do, negate THAT EFFECT" — the same pronoun R164/R166 '
      + 'settled — and carries TWO live defects: a FORWARD .find() while pushItem pushes to the '
      + 'end, so with two same-card same-seat plays it negates the OLDER one; and NO !i.copy '
      + 'guard at all, so it can negate a copy where the original never reached the stack. '
      + '"Match on ev.data.item" is IMPOSSIBLE for it: spellPlayed carries item, and '
      + '**cardPlayed does not** — and Void Mandible listens on cardPlayed. It needs an engine '
      + 'change this entry never mentions. Filed as CT-79. Found by the round-27 class audit, '
      + 'exhaustive over every g.s.stack access in all 30 set files.',
    status: 'done',
  },
  {
    id: 70,
    area: 'card',
    severity: 'major',
    title: 'Fifteen effects go silent on the same clause: "each opponent" in a region holding nobody else',
    detail:
      'R25 scopes an effect to its region, and these read the region\'s `presentSeats` to find '
      + '"each opponent". A HOME region out of battle lists only its owner, so the loop runs zero '
      + 'times and the effect resolves saying NOTHING — the player is told neither what happened '
      + 'nor why it did not. `85-silent-branches` §9 already fixed exactly this for the three the '
      + 'old fuzz happened to reach (Restitution, Vroot, Flzzz); the rest were never driven.',
    evidence:
      'Found by R182\'s deterministic drive, which reaches 430/430 EffectDefs where the fuzz it '
      + 'replaced reached 280/431. By effect label: `ability:Bloated Manablub#0` + its graft, '
      + '`ability:Blightmound#0` + its graft, `spell:Linked Extinction` + graft (its cost-declined '
      + 'branch DOES announce; the opponent loop below it does not), `spell:Void Memory` + graft '
      + '(⚠ its own comment CITES R25 and still does not announce the case), and the augment '
      + 'halves of Growing Plague, Malicious Hardware, Pestilent Mycelion, Rotwall and Verdant '
      + 'Necrophage. '
      + 'A near neighbour rather than the same shape: `augment:Stellarspore Harvester#0` counts '
      + '"each of your units with a -1/-1 counter" at resolution and says nothing when the count '
      + 'is zero.',
    fix:
      'One `g.ev(\'info\', …)` per branch, saying the region held no opponent — the same repair '
      + '85-silent-branches §9 made for the first three, so there is a precedent to copy '
      + 'verbatim. All sixteen are listed in 65\'s `SILENT_KNOWN` with reasons and a '
      + 'self-invalidating test, so **a fix cannot land without the entry coming off**, and the '
      + 'ticket closes when the list is empty. '
      + '⚠ Do not "fix" these by making the loop run — the region genuinely holds nobody else and '
      + 'the effect genuinely does nothing. The defect is the silence, not the no-op.',
    proof: null,
    verify: '65-effect-conformance\'s SILENT_KNOWN list is empty for the R25 family.',
    guards: [
      '158-silent-region-branches.test.ts::Bloated Manablub',
      '158-silent-region-branches.test.ts::Blightmound',
      '158-silent-region-branches.test.ts::Linked Extinction',
      '158-silent-region-branches.test.ts::Void Memory',
      '158-silent-region-branches.test.ts::Growing Plague',
      '158-silent-region-branches.test.ts::Malicious Hardware',
      '158-silent-region-branches.test.ts::Pestilent Mycelion',
      '158-silent-region-branches.test.ts::Rotwall',
      '158-silent-region-branches.test.ts::Verdant Necrophage',
      '158-silent-region-branches.test.ts::Stellarspore Harvester',
      '158-silent-region-branches.test.ts::the four grafted R25 riders are the same EffectDef object',
      '65-effect-conformance.test.ts::no effect resolves into silence',
    ],
    closed:
      'R187 (2026-08-26). Nine EffectDefs got one g.ev(\'info\', ...) guard each, copying the '
      + '85-silent-branches §9 wording verbatim. NO loop was made to run — every card keeps '
      + 'identical board behaviour, which is what this entry asked for. SILENT_KNOWN went from '
      + '14 live entries to ONE (spell:Trench Stalker, `run: () => {}` by construction), so the '
      + 'R25 family is empty and the entry\'s own verify line is satisfied. '
      + '⚠ THIS TICKET\'S OWN COUNT WAS WRONG AND THE AGENT CORRECTED IT: the family is '
      + 'THIRTEEN LABELS OVER NINE EffectDefs, not fifteen effects. Four cards (Bloated '
      + 'Manablub, Blightmound, Linked Extinction, Void Memory) appear TWICE in SILENT_KNOWN '
      + 'because 65 labels the ability/spell route and the graft route separately while both '
      + 'read the SAME OBJECT — one repair closed both labels. "Sixteen" was never on the list. '
      + 'Test #11 pins the shared-object claim so it cannot silently stop being true. '
      + '⚠ A SECOND CORRECTION: my brief said to NAME THE REGION. A Region is { owner, '
      + 'presentSeats } — there is no name field, no naming helper, and the client never labels '
      + 'a region. Every existing member of this family says "here"; the agent copied the '
      + 'precedent rather than inventing a region vocabulary across ten card files. '
      + 'NEW DEFECT FOUND WHILE FIXING: Malicious Hardware was silent on a SECOND branch nobody '
      + 'had listed — every present opponent having no unit to sacrifice (`picks` empty). '
      + 'Neither 65\'s drive nor SILENT_KNOWN had it, because 65\'s board happens to give every '
      + 'present opponent a unit. Fixed here; the general sweep for it is CT-74. '
      + 'Orchestrator verified independently: deleting Pestilent Mycelion\'s info line reddens '
      + '158 BY CARD AND PRINTED CLAUSE and reddens 65\'s whole-pool silence sweep; restored, '
      + 'both green.',
    status: 'done',
  },
  {
    id: 71,
    area: 'client',
    severity: 'major',
    // ⚠ `reportId: 104` deliberately MOVED to CT-78 on 2026-08-26. Report #104
    // has two halves. This one — "is the reveal actually reaching the opponent?"
    // — is answered and `done`. The half the owner most likely meant, that a
    // reveal he can technically read is not one he NOTICES, is CT-78 and is
    // open, so #104 sits `partial` and the report pointer belongs on the open
    // half. Splitting the pointer is what keeps 83-card-todo's cross-check
    // honest instead of letting a `done` ticket close a live complaint.
    cards: ['Oracle of Foretelling', 'Premonition', 'Celestial Purge', 'Dematerialize', 'Foretell'],
    title: 'Glimpse says REVEAL and the opponent cannot see the cards',
    detail:
      'Every printed Glimpse reminder says REVEAL — "Reveal the top five cards of the deck and '
      + 'cache one" — and the engine agrees with itself: `glimpse()` carries a comment saying '
      + '"the reveal is genuinely public — the cache is public information (R41)" and emits a '
      + '`glimpsed` event carrying `cards: revealed`. The owner says the opponent cannot see them.',
    evidence:
      'Playtest report #104, GYSR action 110. ⚠ THE GAME IS FINISHED (file last written 12:50 '
      + 'UTC against a 14:15 clock), so unlike most of this corpus it REPLAYS and the moment can '
      + 'be reconstructed.',
    fix:
      '**Investigate before touching anything — I could not find the cause by reading.** '
      + '`server/view.ts::redactEvent` touches only `recycle`, and `visibleToSeat` hides only '
      + '`privateTo` events, so nothing in the redaction layer removes a `glimpsed`. Candidates, '
      + 'all UNVERIFIED: the glimpse happening inside a HIDDEN SIMULTANEOUS SEGMENT, where '
      + '`heldEvents` holds the opponent\'s copy until the barrier — his phrase "right now" may '
      + 'be exactly that — or the client not rendering the names in the opponent\'s log line. '
      + 'Replay GYSR to action 110 and look. '
      + '⚠ If it IS the segment hold, this stops being a bug and becomes a RULES question for the '
      + 'owner: is a reveal inside a hidden step public immediately, or at the barrier? Do not '
      + 'answer that one in code.',
    proof: null,
    verify: 'An opponent sees the revealed cards at the moment they are revealed.',
    guards: [
      '159-glimpse-reveal-visibility.test.ts::the Glimpse 5 reveal is public to the opponent',
      '159-glimpse-reveal-visibility.test.ts::its reveal is inside the hidden deployment segment, and escapes it',
      '159-glimpse-reveal-visibility.test.ts::the Glimpse X reveal is public to the opponent',
      '159-glimpse-reveal-visibility.test.ts::the Glimpse 1 reveal is public to the opponent',
    ],
    closed:
      'R188 (2026-08-26). THE REPORTED MOMENT IS NOT BROKEN — and the entry\'s own instruction '
      + '("investigate before touching anything; I could not find the cause by reading") is what '
      + 'produced that answer instead of a fix for an imaginary bug. GYSR replays 306/306; its '
      + 'three glimpses are [54]/[107]/[136], all battle-phase with segmentKey null, and at [107] '
      + 'the SEAT-1 payload carries glimpsed with data.cards unredacted. A truncated GYSR was '
      + 'then restored into a real server and opened in HEADLESS CHROME AS SEAT 1: the names '
      + 'render as inspectable .logcard spans and the public cache panel appears; a reload '
      + 're-links them. NO ENGINE OR SERVER CODE CHANGED. '
      + 'The one genuinely invisible case is a glimpse inside a HIDDEN SIMULTANEOUS SEGMENT '
      + '(heldEvents parks the opponent\'s copy until the barrier), proven end to end with Oracle '
      + 'of Foretelling — timing: deploy, so ALWAYS inside the segment. Glook, Lilbot, Visionary '
      + 'Construct, Maw of Despair and Seer of Empty Spaces reach it too; the other four printed-'
      + 'reveal cards are {Battle} and are never held. THAT IS A RULES QUESTION, deliberately not '
      + 'answered in code — CT-77. '
      + '⚠ BOTH OF MY NAMED CANDIDATES WERE WRONG. The hidden segment is wrong FOR THE REPORTED '
      + 'MOMENT (all battle-phase) and right for a card family I never named — which is exactly '
      + 'how the ticket survives. "The client does not render it" is wrong outright, verified in '
      + 'a real browser. My read-and-rule-out was right on all three counts (redactEvent touches '
      + 'only recycle, visibleToSeat gates only privateTo, viewFor does not touch the cache). '
      + '⚠ WITH NO FIX TO REVERT, the guards were red-checked against deliberate mutants of the '
      + 'mechanism each claims: blurring glimpsed in redactEvent (5/6 red), making it privateTo '
      + '(6/6), redacting the opponent\'s cache (4/6), dropping the names from E.glimpse (5/6). '
      + 'THE OWNER\'S ACTUAL ASK IS PROBABLY PRESENTATIONAL and is still open as CT-78 — the '
      + 'glimpser gets N card SCANS in a modal, the opponent gets one line of prose in an 80-line '
      + 'log. Report #104 therefore sits `partial`, not `fixed`.',
    status: 'done',
  },
  {
    id: 72,
    area: 'client',
    severity: 'minor',
    reportId: 105,
    title: 'Simultaneous triggers reach the stack together and arrive on screen one at a time',
    detail:
      'Owner: "All triggers from death (and after combat) should go onto the stack, visually, at '
      + 'the same time. The Geode\'s trigger DID, but not visually." '
      + '⚠ NOTE THE PRECISION: he says the trigger DID reach the stack. The objection is that the '
      + 'SCREEN staged them serially. So this is the pacing layer and the fix must not change '
      + 'when anything actually resolves.',
    evidence:
      'Playtest report #105, GYSR action 140. Same family as report #53 ("damage and all effects '
      + 'happened instantly"), which is instructive in the opposite direction: #53 wanted MORE '
      + 'staging and this wants less, so the rule is not "stage more" — it is that a batch which '
      + 'is simultaneous in the rules must look simultaneous, and a sequence must look sequential.',
    fix:
      'ui/flash.ts beats and R150\'s `holdable`. ⚠ Guard the FEEDING, not the stager: #53\'s '
      + 'original guards proved `combatStages` could stage and could not fail if the client '
      + 'stopped feeding it, which is exactly why R173 had to widen them. Drive it through '
      + 'test/ui-driver.ts.',
    proof: null,
    verify: 'Triggers that reach the stack in one batch appear on screen in one beat.',
    guards: [
      '160-simultaneous-trigger-beats.test.ts::R189 THE REPORT: a trigger sweep puts every trigger on the strip in ONE frame',
      '160-simultaneous-trigger-beats.test.ts::a beat explains and never gates',
      '160-simultaneous-trigger-beats.test.ts::R189 a play and the triggers it caused are TWO beats, and the second is three cards at once',
      '160-simultaneous-trigger-beats.test.ts::a second batch queues behind the first',
      '160-simultaneous-trigger-beats.test.ts::R189 flashBatches cuts a real batch where the RULES cut it',
      '160-simultaneous-trigger-beats.test.ts::positive evidence only',
    ],
    closed:
      'R189 (2026-08-26), in ui/flash.ts ALONE — nothing in engine/src or ui/main.ts, so no '
      + 'change to when anything resolves, which is what this entry required. queueFlashes '
      + 'stamped EVERY item of an arriving batch STAGGER_MS after the one before it, '
      + 'unconditionally; it now spaces GROUPS cut where the rules cut them (a trigger leaves the '
      + 'queue by stackPushed or stackFlash, so everything queued before the drain is '
      + 'simultaneous). POSITIVE EVIDENCE ONLY — grouped only when its own `triggered` marker is '
      + 'in the same batch — and that gate is load-bearing: removing it reddens three existing '
      + 'docs/11 guards in 56-ui-flash, whose synthetic helper builds markerless triggered items. '
      + 'My literal framing ("a batch that arrives together looks together") would have widened '
      + 'those three. '
      + '⚠⚠ THE REPORTED ACTION IS WRONG AND HIS OWN CASE HAS NO PACING FIX. Action 140 is a '
      + 'passPriority ending the battle round with no triggered and no stackFlash in it; the '
      + 'moment is [135] (three death triggers in one sweep). But each of those three stopped on '
      + 'a DECISION of his, so the three flashes arrived in THREE SEPARATE SERVER ROUND-TRIPS '
      + 'with his answers in between, and no honest pacing rule merges three round-trips. R189 '
      + 'deliberately gives them a beat each and says so. The general form is real and the corpus '
      + 'supplied it one game over: SMVJ [141] is four death triggers in ONE action and ONE '
      + 'update drawn 280ms apart. SMVJ [94] is the control in the other direction. '
      + '⚠ MY SEAM WAS RIGHT AND THE PART I POINTED AT WAS NOT: R150\'s holdable and R80\'s '
      + 'Beat/combatStages are not involved at all; the defect is in queueFlashes, the older '
      + 'docs/11 flash queue.',
    status: 'done',
  },
  {
    id: 73,
    area: 'card',
    severity: 'minor',
    reportId: 106,
    cards: ['Oracle of Foretelling', 'Premonition', 'Celestial Purge', 'Dematerialize', 'Foretell'],
    title: 'The Glimpse reminder text never says the unchosen cards are recycled',
    detail:
      '⚠⚠ EVERY FACTUAL CLAIM THIS ENTRY ORIGINALLY MADE WAS FALSE, and the retraction is kept '
      + 'in place of the claim because the entry sent one round down the wrong path already. '
      + 'It used to read: "CONFIRMED against printed.json. Oracle of Foretelling reads … and '
      + 'STOPS." That was never checked. Verified 2026-08-26 against BOTH printed.json and '
      + 'AlgomancyCards-OracleText.json: Oracle of Foretelling, Premonition, Celestial Purge and '
      + 'Dematerialize ALL end their reminder with "Recycle the rest." Foretell is Glimpse 1 — '
      + 'one card revealed, one cached, no "rest" — and correctly says nothing, which is R45\'s '
      + 'own N=1 reading. '
      + 'THE OWNER WAS STILL RIGHT ABOUT WHAT HE SAW. The reminder he read is the GLOSSARY row '
      + 'the card inspector prints for every keyword a card mentions '
      + '(ui/main.ts::glossaryHits -> ui/glossary.ts), and that row still described R45 AS IT '
      + 'READ BEFORE THE 2026-08-19 CORRECTION — "cache them", all N, recycle never mentioned. On '
      + 'those four cards the panel CONTRADICTED ITSELF: printed box said "cache one … Recycle '
      + 'the rest", reminder underneath said the opposite.',
    evidence:
      'Playtest report #106, GYSR action 154. ⚠ R45\'s own doc comment quotes these reminders as '
      + 'reading "Recycle the rest" — they do not, and that misquote is what let the omission sit '
      + 'unnoticed. Worth correcting in the comment either way.',
    fix:
      '⚠ RETRACTED WITH THE DETAIL ABOVE. This said "a data fix upstream and that is the whole '
      + 'difficulty". There was no upstream data error at all, and the fix was two rows of '
      + 'ui/glossary.ts.',
    proof: null,
    verify: 'The Glimpse reminder says what happens to the cards not chosen.',
    guards: [
      '161-printed-text-overrides.test.ts::the Glimpse glossary reminder names the recycle, and the full rule survives beside it',
      '161-printed-text-overrides.test.ts::the Recycle reminder no longer denies what the Glimpse one now says',
      '161-printed-text-overrides.test.ts::every printed N>1 reminder says cache-ONE-and-recycle, matching E.glimpse',
      // ⚠ static tail only — the title is `§1 ${name}'s printed reminder ${...}`, a template
      // literal, so no static substring carries the card name.
      '161-printed-text-overrides.test.ts::every printed N=1 reminder says cache-IT and claims no rest',
      '161-printed-text-overrides.test.ts::an override whose upstream has been fixed FAILS instead of applying',
    ],
    closed:
      'R190 (2026-08-26). Two rows of ui/glossary.ts reworded off E.glimpse and doRecycle rather '
      + 'than off prose. The SECOND row was not in the report and was worse: `Recycle` read "the '
      + 'card is gone for the rest of the game" — the one thing recycling never does '
      + '(doRecycle calls e.recycleToBottom on the line before it pushes the dormant resource). '
      + 'The agent fixed it rather than filing it, because leaving it would have made the Glimpse '
      + 'fix wrong on screen, and flagged the judgement call. '
      + 'Also generalised R162\'s TYPE_OVERRIDES into scripts/printed-overrides.mjs: '
      + 'field-general (type | text), each entry carrying card/field/from/to/since/by/why, and '
      + 'applyOverride throws StaleOverrideError so the extractor exits non-zero and writes '
      + 'NOTHING when upstream is corrected. printed.json REGENERATES BYTE-IDENTICAL — no entry '
      + 'was added, because none was needed. '
      + '⚠ MY BRIEF WAS WRONG TWICE MORE: the fail-loud override table ALREADY EXISTED (R162); '
      + 'this is a generalisation, not a new mechanism. And the upstream error list is THREE type '
      + 'lines plus one missing card, with NO text-field error anywhere in the pool — one of the '
      + 'four (Linked Extinction\'s "Sacrifce") was already FIXED AT SOURCE in 0818074, which '
      + 'proves the source route works and is the one to prefer. '
      + 'Orchestrator verified independently: printed.json regenerates byte-identical; and '
      + 'simulating Caleb fixing Might of the Grove upstream makes `npm run extract` FAIL, name '
      + 'the card, and leave printed.json untouched. Oracle file restored, md5 confirmed.',
    status: 'done',
  },

  // ── filed 2026-08-26 (round 27) ─────────────────────────────────────────
  // From the agents' own out-of-scope findings. Those have been the highest-
  // yield input of several rounds and they only exist because every brief ends
  // with "report any real defect that is out of scope for you to file".
  {
    id: 74,
    area: 'coverage',
    severity: 'minor',
    title: 'A loop that commits a collected list says nothing when the list comes back empty',
    detail:
      'CT-70 repaired the R25 "no opponent in this region" family. While inside Malicious '
      + 'Hardware the R187 agent found a SECOND silent branch that was on no list at all: an '
      + 'opponent IS present, and every one of them has no unit to sacrifice, so `picks` comes '
      + 'back empty, the run completes and emits nothing. Ghord and Molten Tormentor already '
      + 'carry a line for exactly this; Malicious Hardware did not. '
      + 'The general shape is "a loop that collects picks and then commits them, with no '
      + 'announcement when the collection is empty" — distinct from CT-70, whose loop never ran '
      + 'because the region held nobody.',
    evidence:
      '⚠ THE REASON IT WAS INVISIBLE IS THE INTERESTING PART: 65-effect-conformance drives every '
      + 'EffectDef deterministically, but its BOARD happens to give every present opponent a '
      + 'unit — so the empty-picks branch is never taken and the sweep reports clean. That is a '
      + 'checker blind spot of the same family as the four found in round 26, and it was found '
      + 'the same way all of them were: by somebody working nearby, never by the suite.',
    fix:
      'Sweep the pool for the shape (collect into a list, commit the list, no else-branch) and '
      + 'give each an info line. Then decide the harder half: 65\'s drive needs a SECOND board '
      + 'where the opponents are present but empty-handed, or the sweep keeps being blind to '
      + 'this whole branch class no matter how many cards are repaired. '
      + 'Two related weaknesses in the machinery, from the same agent: '
      + '(a) `SILENT_KNOWN`\'s self-invalidation only catches "no longer silent", never "silent '
      + 'for a NEW reason" — the reason string is checked for length (> 40) and nothing else, so '
      + 'a stale reason outlives its truth. '
      + '(b) 85-silent-branches §11 and 158\'s test #12 now make the SAME house-rule claim about '
      + 'disjoint card lists, so if the R25 family grows again no single file owns it. Merging '
      + '§9\'s three cards (Restitution, Vroot, Flzzz) into 158 puts the whole family in one place.',
    proof: null,
    verify:
      'A card whose collected list comes back empty says so, and 65 drives a board that reaches '
      + 'that branch.',
    guards: [
      '179-empty-collection-branches.test.ts::Shoreline Specter — its prompt promises "each opponent loses 2 life"',
      '65-effect-conformance.test.ts::no effect resolves into silence — every completed run says something',
      '65-effect-conformance.test.ts::the known-silent list is still accurate',
      '158-silent-region-branches.test.ts::every card repaired for CARD-TODO #70 is one the whole-pool sweeps also watch',
    ],
    closed:
      'R209 (2026-08-26). CT-74 (the class) and CT-81 (the derived lists) landed together, because '
      + 'CT-81\'s own fix said of Dragnol and Shoreline Specter "that is CT-74, and these two are its'
      + 'first members". PART A — THE GLIMPSE LIST IS DERIVED. 161-printed-text-overrides\''
      + 'GLIMPSE_CARDS went from FIVE hardcoded names to ELEVEN computed from printed text, and all'
      + 'three of the file\'s loops with it. `recycles` is computed from the parsed N; a third derived'
      + 'field, `reminder`, had to be added because five of the eleven print the keyword bare and the'
      + 'recycle assertion cannot be asked of them. Big Glimpse Card is correctly excluded and two'
      + 'assertions pin WHY (the word is in its NAME, not its text). ⚠ BOTH WARNED TRAPS WERE REAL:'
      + 'four of the eleven route through file-local `glimpse()` wrappers, so a call-site sweep'
      + 'misses them and the printed-text derivation is the only safe one. Positive control:'
      + 'appending "Glimpse 2" to a card\'s text reddens three tests AND drives the intruder through'
      + 'every loop. ⚠ PART B — ALL THREE CODE-SHAPE READINGS WERE REJECTED, AND THAT IS THE FINDING.'
      + 'The agent swept on the PLAYER-FACING property instead: a clause that promises a per-seat'
      + 'outcome, resolves over an empty collection — of seats or of picks — and emits nothing for'
      + 'that clause. Its reasoning: the accumulator is not the class (Perish has none), the cause is'
      + 'not the class (CT-70 vs CT-74 changes only the wording), and every shape reading orphans the'
      + 'other shape onto no ticket, which is the docs/13 §4 failure this ticket pair exists to'
      + 'correct. Result: 12 REPAIR SITES, 15 CONFORMANCE LABELS — Cull, Seabed Shellcaster and'
      + 'Recall each back two labels with one shared EffectDef object, pinned by an assertion each,'
      + 'which is the double-counting trap CT-70 paid for once already. ⚠ THE TICKET\'S EXEMPLAR WAS'
      + 'ALREADY FIXED: Malicious Hardware carries its empty-picks line at'
      + 'batch-hybrids-wm-a.ts:761-764, landed by R187 in the same commit that spun CT-74 off. ⚠⚠'
      + 'PART C IS THE DELIVERABLE THAT OUTLASTS THE TWELVE REPAIRS. 65-effect-conformance has a'
      + 'THIRD BOARD, `barren`. Both existing boards gave every present seat a unit, so the empty'
      + 'branch was not rare — IT WAS UNREACHABLE, and the sweep reported clean forever. On its first'
      + 'run, before a single card was changed, it convicted SEVEN LABELS — including `spell:Perish`,'
      + 'which is on no ticket and in no report. And SILENT_KNOWN\'s reason is falsifiable at last:'
      + 'entries carry the SET OF BOARDS they are silent on, asserted by equality, so "silent for a'
      + 'NEW reason" reddens where the old `length > 40` check let a stale reason outlive its truth.'
      + 'That repairs the unfalsifiable closure the round-28 audit found in CT-70, whose verify line'
      + '— "SILENT_KNOWN is empty for the R25 family" — was satisfiable while members remained. 85'
      + '§9\'s three cards (Restitution, Vroot, Flzzz) are merged into 158, so the R25 family has one'
      + 'owner. REPORTED, NOT FIXED, CORRECTLY: Luminous Arc and Dreadwave Devourer THROW on'
      + '`ctx.targets[0]!` with no targets. Unreachable in a real game because R86 fizzles first, and'
      + 'the fix is engine-side; 65 now prints them by name every run instead of counting them.'
      + 'ORCHESTRATOR VERIFIED INDEPENDENTLY: removing Shoreline Specter\'s new line reddens 179 and'
      + 'the failure message SHOWS THE OTHER HALF\'S EVENTS — "resolved over an EMPTY collection and'
      + 'said nothing about it. The 2 event(s) it did emit are the OTHER half of the card" — which'
      + 'demonstrates CT-81(b)\'s claim rather than asserting it. Restored; 107/107 across 161, 65,'
      + '158 and 85.',
    status: 'done',
  },
  {
    id: 75,
    area: 'client',
    severity: 'major',
    title: 'The UI driver cannot see a nested affordance, so a whole class of click bug tests green',
    detail:
      'Three findings from the R192 agent, all one mechanism. '
      + '(a) **`data-btn` beats `data-act` regardless of DOM DEPTH.** The document click listener '
      + '(ui/main.ts ~4716) asks `closest(\'[data-btn]\')` first and only then '
      + '`closest(\'[data-act]\')`. So ANY data-act element placed inside a data-btn container is '
      + 'silently swallowed, however deep. '
      + '(b) **`test/ui-driver.ts` is STRUCTURALLY BLIND to (a)**, because its fake `closest()` has '
      + 'no ancestors — there is no container for the inner element to lose to. A test about a '
      + 'nested affordance therefore PASSES in the driver and is WRONG in the browser. '
      + '(c) The driver\'s own header comment ASSERTS the opposite: it says having no ancestors '
      + '"is true of every affordance in the board markup: they carry their own data-btn/data-act". '
      + 'The regioncache panel is a data-btn affordance CONTAINING card scans and was so before '
      + 'this round, and the bin panel (data-btn="binopen", regionbinthumbs) is identical in shape.',
    evidence:
      '⚠ THIS IS NOT THEORETICAL — IT ALREADY PRODUCED A WRONG TICKET. CARD-TODO #64\'s own `fix` '
      + 'field prescribed exactly the swallowed shape ("give the thumbs the same data-act=\"cache\" '
      + 'the dialog entries use"). In a real browser it does nothing. In ui-driver it would have '
      + 'gone green. The R192 agent found this only by reading the listener rather than trusting '
      + 'the driver, and shipped a data-btn instead. '
      + 'Same family as the four blind guards found by the round-26 audit and as stripCode going '
      + 'blind twice: a CHECKER that reports more sight than it has, found by somebody working '
      + 'nearby rather than by the suite.',
    fix:
      'Two halves, and the first is the one that matters. '
      + '(1) Give ui-driver.ts a `closest()` WITH ancestors, then re-run every test that drives '
      + 'it and see which ones were only ever passing because the fake had none. That measurement '
      + 'IS the deliverable — the count of tests that change is the size of the blind spot. '
      + '(2) Then decide (a) on its merits: a depth-aware rule (prefer whichever match is NEARER, '
      + 'e.g. `btn.contains(actEl)`) fixes the whole class, but it changes GLOBAL click routing, '
      + 'so it needs its own red-checks against every existing affordance. '
      + 'Also fold in the cardHtml card-div double space from CT-65 (`class="${cls.join(\' \')}" '
      + '${opts.data ?? \'\'}`), which is the same one-liner and was deliberately deferred to a '
      + 'quiet tree.',
    proof: null,
    verify:
      'ui-driver.ts resolves closest() through real ancestors; the number of tests that changed '
      + 'behaviour is recorded; and a data-act nested inside a data-btn either works or fails '
      + 'loudly.',
    guards: [
      '176-nested-affordance-and-serialiser.test.ts::the driver resolves closest() through REAL ancestors',
      '176-nested-affordance-and-serialiser.test.ts::closest() prefers the element itself, then the nearest ancestor',
      '176-nested-affordance-and-serialiser.test.ts::no data-act in the rendered board sits inside a data-btn container',
      '176-nested-affordance-and-serialiser.test.ts::shown the swallowed shape, the detector says so',
    ],
    closed:
      'R205 (2026-08-26). `test/ui-driver.ts` rebuilds a REAL ancestor chain from the rendered '
      + 'markup and `closest()` walks it, nearest first. The header comment that asserted the '
      + 'opposite — "this fake has no ancestors, which is true of every affordance in the board '
      + 'markup" — is gone; it was the falsehood that let this survive. '
      + '⚠ THE MEASUREMENT THE TICKET ASKED FOR CAME BACK **ZERO**, and the reason is measured, '
      + 'not lucky: 194 tests across the 13 ui-driver files pass identically before and after. '
      + 'An affordance census computed from the rendered markup shows NO `data-act` anywhere in '
      + 'the client is currently nested inside a `data-btn` — R192 had already fixed the only '
      + 'instance, correctly. So the blind spot was LATENT, not cashed in: the suite could not '
      + 'have caught the NEXT one. That was proven directly rather than inferred — planting '
      + 'CARD-TODO #64\'s prescribed `data-act="cache"` on the cache thumb gives OLD driver `ok`, '
      + 'NEW driver `not ok` (expected 33, actual 30 — the panel ate the click). Same client, '
      + 'same test, opposite verdicts. '
      + 'PART 2 DECLINED, WITH THE ENUMERATION, AND THAT IS THE RIGHT CALL: 71 `data-btn` values '
      + 'and 12 `data-act` values were enumerated; exactly TWO `data-btn` elements are containers '
      + '(.regionbin :1816, .regioncache :2109), both hold only `cardHtml` output whose single '
      + 'attribute slot the builders control, and every `data-act` renders at board top level or '
      + 'inside an overlay dialog that is a SIBLING of the panel, not a descendant. A depth-aware '
      + 'delegator would therefore change nothing today — an untestable change to GLOBAL click '
      + 'routing, red-checkable against no real affordance. Instead the trap is made LOUD: §2 '
      + 'computes the census from rendered markup and fails if any `data-act` has a `data-btn` '
      + 'above it, so a panel added next year walks into the guard by itself (docs/13 §7.2). '
      + 'ORCHESTRATOR VERIFIED INDEPENDENTLY: planting the swallowed shape reddens THREE tests and '
      + 'names it verbatim — "data-act=\"cache\" is inside data-btn=\"cacheopen\" … CARD-TODO #64 '
      + 'prescribed the data-act and it could not have worked." Reverted; 12/12. '
      + '⚠ TICKET CLAIMS CORRECTED: `.regionbin` is :1816, not :1755 (cited wrong in CT-75 AND '
      + 'CT-82b); and CT-75\'s implied premise that tests were passing for the wrong reason is '
      + 'NOT borne out — zero changed. '
      + 'ALSO FOUND, on no ticket: ui-driver\'s tag regex `/<[a-zA-Z][^>]*>/g` was not '
      + 'quote-aware, so a `title="…"` containing `>` (the board writes prose into those) ended '
      + 'the tag early — harmless when reading one tag, but it would have silently corrupted the '
      + 'ancestor stack this ticket exists to build. Fixed as part of the same change.',
    status: 'done',
  },
  {
    id: 76,
    area: 'client',
    severity: 'major',
    title: 'Nothing ties a glossary reminder to the ruling it paraphrases, so a corrected rule leaves it lying',
    detail:
      'ui/glossary.ts holds a plain-English reminder for every keyword, and the card inspector '
      + 'prints one row per keyword a card mentions (ui/main.ts::glossaryHits). To a player that '
      + 'row IS the reminder text — report #106 proves it, because the owner reported "the '
      + 'reminder text for Glimpsing is wrong" about a printed card whose printed reminder was '
      + 'RIGHT. '
      + 'Nothing checks a glossary entry against the ruling it paraphrases. So an R-number '
      + 'correction can land in engine.ts, apply.ts, docs/digital-rules.md AND a test, and leave '
      + 'ui/glossary.ts describing the SUPERSEDED rule indefinitely.',
    evidence:
      'R45 was corrected on 2026-08-19 (glimpse caches exactly ONE and recycles the rest). '
      + 'ui/glossary.ts kept the pre-correction wording — "cache them", all N, no recycle — for '
      + 'SEVEN DAYS, until report #106. On the four N>1 Glimpse cards the inspector panel '
      + 'contradicted itself on screen: printed box "cache one … Recycle the rest", reminder '
      + 'underneath saying the opposite. '
      + '⚠ AND IT WAS THE SECOND TIME a report about reminder text was routed to the printed '
      + 'data when the glossary was the culprit — which is the real cost: the wrong triage is '
      + 'cheap to repeat and expensive to undo, and it wrote a false claim into CARD-TODO #73 '
      + 'and into playtest-ledger #106 that stood until somebody finally opened printed.json. '
      + 'A second, unrelated row was found rotten in the same panel while fixing it: `Recycle` '
      + 'said "the card is gone for the rest of the game", which is the one thing recycling never '
      + 'does. Nobody had reported that one at all.',
    fix:
      'A conformance test tying each glossary entry to its ruling. The shape that already works '
      + 'in this repo is 109-attr-channel-conformance, which DERIVES its rule by scraping the '
      + 'printed reminder text rather than hardcoding a list — prefer that to a hand-maintained '
      + 'map, which is just another thing to go stale. '
      + 'Minimum viable version: every glossary entry must cite an R-number, and the citation '
      + 'must resolve to a ruling that is not marked superseded/narrowed in digital-rules.md '
      + '(the repo already marks them — that is how a superseded R108 was caught being cited). '
      + 'Better version: for the keywords whose behaviour is machine-readable (glimpse, recycle, '
      + 'the attribute set), assert the reminder against what the engine actually does. '
      + '⚠ Check the OTHER rows while building it — two of the handful examined were wrong, '
      + 'which is not a reassuring base rate.',
    proof: null,
    verify:
      'A glossary row whose ruling has been corrected fails the suite, naming the row and the '
      + 'ruling.',
    guards: [
      '177-glossary-conformance.test.ts::every glossary row cites a ruling, and every citation RESOLVES and is LIVE',
      '177-glossary-conformance.test.ts::printed text wins — no row drops a rules word its own card prints',
      '177-glossary-conformance.test.ts::every attribute with a printed reminder ADMITS it',
      '177-glossary-conformance.test.ts::the rows resting on NEITHER a ruling NOR printed text, by name',
      '177-glossary-conformance.test.ts::the staleness detector can tell a retired ruling from a live one',
      '177-glossary-conformance.test.ts::the printed-reminder scrape finds the pool it is supposed to read',
      '177-glossary-conformance.test.ts::every check above goes RED on a row broken on purpose',
      '177-glossary-conformance.test.ts::and stays GREEN on the rows as they really are',
    ],
    closed:
      'R206 (2026-08-26). CT-80 (the rows) and CT-76 (the checker) landed together, because splitting them is how the rows get reworded and the checker never arrives. ⚠⚠ THE CLASS IS **15 WRONG ROWS OUT OF 43 — A 35% BASE RATE**. The ticket said four; the orchestrator\'s audit found seven; reading the 26 rows NOBODY had ever examined found eight more: Unstable (omitted the printed type line entirely AND stated the erase unconditionally — R145 scopes it to the ACTIVE ZONES, so from hand/deck/bin/cache it bins normally), Prophecy (\"normal timing still applies\" is flatly false for a banner ending [Haste]), Augment and Graft (neither said WHEN — both are deployment actions — and Graft\'s \"[Switch1] is bounded\" is contradicted by R110\'s multiplier), Haste (canHaste opens the step on FIVE conditions; the row named one), Shard (two callers since R132), Prismite and Recycle (\"any element\" is gated to the game\'s elements). ⚠⚠ **FIVE OF THE FIFTEEN WERE ON CT-80\'S OWN \"CHECKED AND CORRECT, DO NOT RE-AUDIT\" LIST** — Pure, Graft, Haste, Shard, Prismite. That list was not a saving; it was a liability, and it should be read as a warning about protected lists generally rather than re-trusted. THE CHECKER: two derived checks plus six engine pins. The one that matters is PRINTED TEXT WINS — for the 15 attributes carrying a printed reminder, the row may not drop a rules word the card uses, derived from printed.json so a new card extends it for free. Run cold against the OLD table it named {Piercing} and {Electric} and nothing else. Citations must resolve to a LIVE ruling, with retirement read from the header OR the leading blockquote — R10 and R76 are marked only in the blockquote, and R10 is exactly what {Unaware} was still teaching. ⚠ CT-76\'S \"every entry must cite an R-number\" IS NOT ACHIEVABLE and was replaced with something honest: Flying, Evasive, Poisonous, Resonant and Lethal have no ruling and never did. The rule is now \"cite a SOURCE\" — an R-number that resolves and is live, or \'printed\' which must be true of the pool — and the residue with neither is asserted BY NAME (Evasive, Resonant) rather than left implied. ⚠ THE AGENT MEASURED ITS OWN INSTRUMENT and pinned two false-positive classes as negative controls: a fixed-size body window marks R9 and R17 retired (their bodies are two lines, so it runs into the next ruling\'s marker), and a body-wide match marks R18 retired because it says \"The ⚠ is withdrawn\" about its own warning. Either would have falsely accused the {Haste}, {Once} and {Prismite} rows. Nine mutants run in-suite every run. ⚠ NEITHER TICKET NAMED R103, which is IN THE REGISTER titled \"{Piercing} pierces on NON-COMBAT damage too, into the unit\'s controller\" — the rule WAS written down; only the glossary never heard. Both tickets\' Piercing and Electric line numbers were also wrong (:4088-4119 and :4123-4160, not :3978-3995 and :4021-4045). REPORTED, NOT FIXED (correctly — the engine is another agent\'s territory and a row is not the place to change behaviour): engine.ts:10599-10607 declares its own canHaste/castable() divergence, so the haste step can open with nothing playable or be skipped while a playable card sits in hand. The {Cache} row\'s \"you both see every cached card\" is qualified by R188, which is CT-77\'s open question, and was left alone. ORCHESTRATOR VERIFIED INDEPENDENTLY: reverting the Piercing row to its pre-R206 wording reddens two tests and names the card AND the dropped word — \"the PRINTED reminder on Protective Adaptations says ... and the glossary row drops [controller]. Printed text wins — reword the row, not the card.\" Reverted; 15/15.',
    status: 'done',
  },
  {
    id: 77,
    area: 'engine',
    severity: 'major',
    title: 'OWNER RULING NEEDED: is a reveal inside a hidden simultaneous step public now, or at the barrier?',
    cards: ['Oracle of Foretelling', 'Glook', 'Lilbot', 'Visionary Construct', 'Maw of Despair',
      'Seer of Empty Spaces'],
    detail:
      'THE QUESTION, in one sentence: **is a reveal that happens inside a hidden simultaneous '
      + 'step (deployment, the haste step, the resource step) public IMMEDIATELY, or only at the '
      + 'BARRIER with the rest of that step?** '
      + 'Every printed Glimpse reminder says REVEAL, and R41 makes the cache public information. '
      + 'But `rooms.ts` parks the opponent\'s copy of every event in a hidden segment in '
      + '`heldEvents` until the barrier, so mid-segment the opponent\'s visible log is EMPTY and '
      + 'at the barrier they receive the whole line at once. '
      + 'Six cards reach this state. Oracle of Foretelling is `timing: deploy`, so it is ALWAYS '
      + 'inside the segment. The other four printed-reveal Glimpse cards are {Battle} and are '
      + 'never held.',
    evidence:
      'R188 (2026-08-26), proven end to end through applyToRoom + viewFor + redactLog, and '
      + 'guarded by 159-glimpse-reveal-visibility.test.ts, which pins TODAY\'s behaviour so '
      + 'whichever way the ruling goes it is one test to change. '
      + 'Arose from report #104, where the owner said opponents could not see a Glimpse. The '
      + 'reported moment turned out to be fine (verified in a real browser); this is the case '
      + 'that is genuinely invisible, and it is a DIFFERENT card family from the one he played.',
    fix:
      '⚠ DO NOT ANSWER THIS ONE IN CODE — ask. R188 already prices both answers: '
      + '"AT THE BARRIER" closes it as a clarification, costing one comment and one test rename. '
      + '"IMMEDIATELY" needs a new PER-EVENT exemption in heldEvents, which is all-or-nothing per '
      + 'segment today, and forces a second decision about what escapes ALONGSIDE the reveal — '
      + 'the framing `resolved` line, the following `cached` line, the stack item. That second '
      + 'decision is where the work is, not the exemption itself. '
      + '⚠ The standing steer (printed text wins; take the permissive reading) points at '
      + '"immediately", since the card says REVEAL without qualification — but a hidden '
      + 'simultaneous step is a deliberate information rule, not an engine accident, so this is '
      + 'genuine ambiguity and not a case the steer settles.',
    proof: null,
    verify: 'The owner has answered, and digital-rules.md records it.',
    guards: [
      '203-reveal-escapes-the-hidden-hold.test.ts::R235 §1: the reveal line stands on its own',
      '203-reveal-escapes-the-hidden-hold.test.ts::R235 §2: the play, the resolution, the cache and the spawn around it are still held',
      '203-reveal-escapes-the-hidden-hold.test.ts::R235 §3: a hidden step with NO reveal in it leaks nothing (the negative control)',
      '203-reveal-escapes-the-hidden-hold.test.ts::R235 §4: the seat channel can tell the two seats apart (the positive control)',
      '159-glimpse-reveal-visibility.test.ts::its reveal is inside the hidden deployment segment, and escapes it',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29). THE OWNER RULED: "Immediately — the card says REVEAL" '
      + '(R222), which is the standing steer applied and the answer that costs work. Implemented as '
      + 'R235: the hold is PER-EVENT now — `escapesHold(ev)` in server/rooms.ts, a one-entry set '
      + 'containing `glimpsed`, filtered at both heldEvents push sites. ⚠⚠ AND THE TICKET\'S '
      + 'PRESCRIBED FIX WOULD HAVE MADE THINGS STRICTLY WORSE. This entry, R188 and the brief all '
      + 'said `heldEvents` was the thing withholding the reveal. It is not the only one. '
      + 'MID-SEGMENT, `server/main.ts` sends the actor\'s events ONLY TO THE ACTOR; the hold governs '
      + 'just the RESYNC channel (visibleLog, on join/undo) and the barrier flush. So a '
      + 'rooms.ts-only exemption would have delivered the reveal to the opponent ONLY IF THEY '
      + 'RECONNECTED, and would have dropped it from the barrier flush as well — a card that used '
      + 'to be revealed late would have become revealed never. Two lines in main.ts complete it, '
      + 'and test 203 §4 is the only guard that can see that hop, which is precisely why it exists. '
      + 'THE CARD LIST IS ELEVEN, NOT TEN, and the eleventh is the interesting one: **Lifebound '
      + 'Seer** is printed `timing: deploy` — so every list built from the timing field calls it '
      + 'holdable — but its trigger is "when I attack or block", so it only ever glimpses in '
      + 'BATTLE, where nothing is held. SIX can actually be held (Oracle of Foretelling always, '
      + 'plus Glook, Lilbot, Visionary Construct, Maw of Despair and Seer of Empty Spaces in the '
      + 'haste step); five never can. Both derivation channels — /Glimpse/i over printed.json, and '
      + 'E.glimpse() call sites resolved to their owning card() — returned the same 11 and agreed '
      + 'exactly. ⚠ THE ORPHAN-LINE PROBLEM THE ORCHESTRATOR WORRIED ABOUT DID NOT MATERIALISE, so '
      + 'the exemption was NOT widened. E.glimpse writes a whole sentence — "Player 1 glimpses 5: '
      + 'A, B, C, D, E — one is cached…, the rest are recycled." The opponent gets prose naming the '
      + 'glimpser and every card. It does not say WHICH CARD caused it, and that is exactly the '
      + 'part that should stay hidden. TWO CONSEQUENCES RECORDED RATHER THAN ACTED ON: R41\'s public '
      + 'cache stays barrier-delayed inside a hidden step (the STATE channel is frozen, and only '
      + 'the event channel was exempted), and the barrier does not repeat the reveal. ORCHESTRATOR '
      + 'VERIFIED IN THE DIRECTION THAT MATTERS — THE LEAK. Forcing `escapesHold` to return TRUE '
      + 'for everything reddens EIGHT tests, including §3\'s NEGATIVE control ("a hidden step with '
      + 'no reveal in it leaks nothing") and §4\'s positive control. Restored byte-identical. The '
      + 'agent separately confirmed the other direction (escapesHold → false, i.e. pre-R235) '
      + 'reddens seven while that negative control correctly stays green.',
    status: 'done',
  },
  {
    id: 78,
    area: 'client',
    severity: 'major',
    reportId: 104,
    title: 'A reveal the opponent can read is not a reveal the opponent NOTICES',
    detail:
      'The glimpser gets N full card SCANS in a decision modal. The opponent gets ONE LINE OF '
      + 'PROSE in an 80-line log. Both are "the reveal", and only one of them looks like one. '
      + 'The names ARE there and ARE inspectable — that was verified in a real browser as the '
      + 'opponent seat — so this is not a correctness bug, which is exactly why it is easy to '
      + 'close the report and leave the complaint standing.',
    evidence:
      '⚠ THIS IS THE MOST LIKELY THING REPORT #104 ACTUALLY MEANT. The owner wrote "Glimpse is '
      + 'supposed to REVEAL the cards, but opponents cannot see them right now". R188 proved the '
      + 'data reaches the opponent and renders. What is missing is that it does not READ as a '
      + 'reveal. '
      + 'Same family as BL-19 and BL-25, both of which taught the same lesson from the other '
      + 'side: an affordance complaint can be a dead code path wearing a UX costume — and here '
      + 'it is the mirror, a live code path wearing no costume at all. Also the same family as '
      + 'report #103 / CT-63 and the deployment interstitial.',
    fix:
      'A card-sized reveal surface for the non-glimpsing seat — the same scans, briefly, on the '
      + 'opponent\'s screen. '
      + '⚠ ONE REAL OBSTACLE, reported by the R188 agent: `E.glimpse` leaves NO STRUCTURED RECORD '
      + 'of a reveal in GameState, only the transient event. So a client that reconnects a second '
      + 'later has nothing to render from, and any card-sized surface has to decide whether the '
      + 'reveal is a moment or a piece of state. That is a design call. '
      + '⚠ Do NOT build this before CT-77 is answered — if a reveal in a hidden segment is public '
      + 'only at the barrier, then WHEN the surface appears is part of the ruling.',
    proof: null,
    verify:
      'An opponent who was not looking at the log knows a reveal happened and what was in it.',
    progress:
      '2026-08-28 (round 29): UNBLOCKED. This entry said "Do NOT build this before CT-77 is '
      + 'answered — if a reveal in a hidden segment is public only at the barrier, then WHEN the '
      + 'surface appears is part of the ruling." CT-77 is now answered and shipped: R222/R235 make '
      + 'the reveal public IMMEDIATELY, so the surface appears at the moment of the reveal, in '
      + 'every segment. That question is settled and this ticket no longer waits on anything. AND '
      + 'THE PICTURE IS BETTER THAN THIS ENTRY ASSUMED. It says the opponent gets "ONE LINE OF '
      + 'PROSE in an 80-line log" — true, but the line is a whole sentence naming the glimpser AND '
      + 'every revealed card ("Player 1 glimpses 5: A, B, C, D, E — one is cached…, the rest are '
      + 'recycled"), and the names render as inspectable .logcard spans. So the gap is genuinely '
      + 'one of ATTENTION, not of information, which is exactly what the entry argued and is now '
      + 'verified rather than assumed. ⚠ THE ONE REAL OBSTACLE THIS ENTRY NAMES IS STILL REAL AND '
      + 'R235 DID NOT REMOVE IT: E.glimpse leaves NO STRUCTURED RECORD in GameState, only the '
      + 'transient event — so a client that reconnects a second later still has nothing to render a '
      + 'card-sized surface from. R235 exempted the EVENT channel only; R41\'s public cache remains '
      + 'barrier-delayed inside a hidden step because the STATE channel is frozen. Whoever builds '
      + 'the surface must still decide whether a reveal is a moment or a piece of state, and that '
      + 'decision is now the whole of this ticket.',
    guards: [
      '217-reveal-rows.test.ts::§5a the OPPONENT glimpse becomes a surface; your own does not',
      '217-reveal-rows.test.ts::§5b an empty glimpse is not a reveal',
      '217-reveal-rows.test.ts::§5d the client does not re-decide what is public',
      '217-reveal-rows.test.ts::§5f a MOMENT: non-modal, self-expiring, and gone on a resync',
    ],
    closed:
      '✔ FIXED 2026-08-29 (round 30). The non-glimpsing seat gets a card-sized surface — the same '
      + 'scans, briefly — off the `glimpsed` event, which already carried `{seat, n, cards}` and '
      + 'reaches that seat intact. `ui/reveal.ts::glimpseNotice` is the judgement, main.ts draws it. '
      + '⚠ THE DESIGN CALL THIS ENTRY SAID WAS THE WHOLE TICKET, MADE: A REVEAL IS A MOMENT, NOT A '
      + 'PIECE OF STATE. `E.glimpse` writes no structured record into GameState, so there is nothing '
      + 'to re-render from and a surface that pretended otherwise would lie on the first reconnect. '
      + 'It is shown when it happens and expires on the shared beat timer. THE RESIDUAL IS REAL AND '
      + 'IS NAMED RATHER THAN CLOSED: a player who reconnects during the seconds it is up has missed '
      + 'it, and their log line is what remains. Closing that needs a record in GameState, which is '
      + 'a rules-visible change and a separate decision. '
      + '⚠ NON-MODAL, deliberately: a glimpse can land in a battle window you still have to act in, '
      + 'so it must never be something to dismiss before you may play. And SILENT — every existing '
      + 'cue is a state change you may have to answer; giving news its own sound is a decision for '
      + 'the sound layer, not something to slip in on the back of a visual fix. '
      + 'Its dwell scales with R242 tempo (one step per card), because the point of that ruling is '
      + 'that the client has ONE opinion about how fast a human reads and a reveal is not exempt. '
      + 'VERIFIED BY BREAKING: showing the glimpser their own glimpse reddens §5a; dropping the '
      + 'expiry reddens §5f. ⚠ A THIRD BREAK-TEST FOUND A HOLE IN THE GUARD RATHER THAN THE CODE — '
      + 'the empty-glimpse check passed on `Array.isArray` alone, so §5b now asserts BOTH shapes an '
      + 'empty glimpse can arrive in.',
    status: 'done',
  },
  // ── filed 2026-08-26 (round 27, from the class-widening audit) ──────────
  // A read-only agent was asked the owner's question — "for each item, check to
  // see if it's wider reaching than just the initial report" — against all
  // thirteen open tickets. It found a live information leak (fixed as R202), a
  // regression in work merged the same hour (fixed), and the entries below. It
  // also RETRACTED two of its own claims on re-verification, which is why the
  // rest can be trusted.
  {
    id: 79,
    area: 'card',
    severity: 'major',
    cards: ['Void Mandible'],
    title: 'Void Mandible negates the WRONG stack item, and cardPlayed cannot tell it which',
    detail:
      'Prints *"When a nontoken card is played during battle, sacrifice me. If you do, negate '
      + 'THAT EFFECT"* — the same pronoun R164/R166 settled for Origon and Hexbane Shiitake. It '
      + 'carries TWO live defects at `batch-light-c.ts:633-635`: '
      + '(a) a FORWARD `.find()` scanning from index 0 while `pushItem` pushes to the END, so '
      + 'with two same-card same-seat plays on the stack it negates the OLDER one; '
      + '(b) NO `!i.copy` guard at all, so it can negate a COPY where the original never reached '
      + 'the stack — which R164 established is not a "played" card.',
    evidence:
      'Round-27 class audit, exhaustive over every `g.s.stack` access in all 30 set files: the '
      + 'class is THREE cards and CT-69 named two. '
      + '⚠ CT-69\'s prescribed fix is IMPOSSIBLE HERE, which is why this is its own ticket. '
      + '"Match on `ev.data.item`" works because `spellPlayed` carries `item: item.id` '
      + '(engine.ts:7612). **`cardPlayed` does not** (engine.ts:7641-7645) — and Void Mandible '
      + 'listens on `cardPlayed`, because it must see UNITS as well as spells.',
    fix:
      'Put the played item\'s id on the `cardPlayed` payload the way R178 put it on '
      + '`spellPlayed`, then convert the card. ⚠ Check what else reads `cardPlayed` first — it '
      + 'is the broader of the two events and R129 already had to add it for mid-resolution '
      + 'unit plays. '
      + 'Until then the two defects are independently fixable and worth doing anyway: '
      + '`.reverse().find()` and a `!i.copy` guard, which is exactly the R166 shape the other '
      + 'two cards had before R191.',
    proof: null,
    verify:
      'Void Mandible negates the item the event names, with two identical spells on the stack '
      + 'and with a copy on the stack.',
    guards: [
      '178-played-item-and-erased-mods.test.ts::with two same-card same-seat spells up, it negates THE ONE THE EVENT NAMES',
      '178-played-item-and-erased-mods.test.ts::a COPY on the stack is never negated',
      '178-played-item-and-erased-mods.test.ts::the ordinary case still works',
      '178-played-item-and-erased-mods.test.ts::asPlay',
    ],
    closed:
      'R207 (2026-08-26). `cardPlayed` now carries `item: item.id` at engine.ts:7984 (the '
      + 'commitItem emitter), the way R178 put it on `spellPlayed`, and Void Mandible matches on it'
      + '(batch-light-c.ts:696) with `!i.copy` and CARD_PLAY_KINDS kept as assertions rather than as'
      + 'a search — R191\'s shape. ⚠ THREE DEFECTS, NOT TWO. (a) the forward `.find()` and (b) the'
      + 'missing `!i.copy` are both real and confirmed at source. (c) IS NEW AND WAS ON NO TICKET:'
      + '`cardPlayed` has a SECOND emitter — spawnUnit\'s `opts.asPlay` path (engine.ts:2997, R165) —'
      + 'where there is NO STACK ITEM AT ALL. Wake the Dead is a {Battle} spell, so a unit it raises'
      + 'can share a name with an unrelated item on the stack, and the old (card, controller) scan'
      + 'negated THAT. An absent `item` now means "this play put no effect on the stack", which is'
      + 'the honest encoding. LISTENERS ENUMERATED BEFORE THE PAYLOAD CHANGED, as the ticket asked:'
      + 'Void Mandible; Bloomcaster (reads seat/card/token, never the stack); The Ancient One\'s'
      + 'AO_EVENTS mimic list; drill.ts\'s WINDOW_CLOSERS (types only); and five test files that count'
      + 'events. Nothing asserts the payload\'s key set and no ui/ source reads the event. No listener'
      + 'is affected. ⚠ THE CLASS WAS ONE CARD AT HEAD, NOT THREE. An exhaustive sweep of all 30 set'
      + 'files found 39 `s.stack` accesses, of which exactly FOUR cards ever ask "which item did the'
      + 'event name": Earthbound Replicator (fixed R178), Origon and Hexbane Shiitake (both fixed'
      + 'R191), and Void Mandible. "Three" was the round-27 snapshot of how many were still on scans'
      + 'when R191 swept. The other 35 accesses are id-by-target-ref or whole-stack sweeps, and'
      + 'neither defect can touch them. ⚠ AND THE CLASS IS NOW ENDED BY A DERIVED GUARD RATHER THAN A'
      + 'LIST, which is the point: test 9 computes every `s.stack.find/filter/some` keyed on `.card'
      + '===` instead of `.id ===` across src/cards/sets/, with positive, negative and prose'
      + 'controls. A FIFTH card fails on arrival. This class had previously been closed one card at a'
      + 'time across three tickets — CT-58, CT-69, CT-79 — each closure naming the next remainder,'
      + 'which is exactly the docs/13 §4 failure mode caught mid-flight. ⚠ EVERY FILE:LINE IN THE'
      + 'TICKET WAS STALE: batch-light-c.ts:644-645 not :633-635; spellPlayed\'s item at'
      + 'engine.ts:7908 not :7612; the cardPlayed payload at :7938-7944 not :7641-7645. ORCHESTRATOR'
      + 'VERIFIED INDEPENDENTLY: reverting the ENGINE half alone (dropping `item: item.id`) reddens'
      + 'exactly three tests — the two-spells case, the copy case, AND the ordinary case. Restored;'
      + '9/9. The nine tests drive the real stack throughout: the Mandible arrives mid-battle as a'
      + 'real `augment` action under Rook\'s R95 permission, with no hand-built events or items, which'
      + 'is the shape docs/13 §5 lists four `fixed` reports for getting wrong.',
    status: 'done',
  },
  {
    id: 80,
    area: 'card',
    severity: 'major',
    title: 'Four glossary rows state a rule the engine does not follow, and the glossary IS the rule',
    detail:
      'The card-side half of CT-76, with members. `ui/glossary.ts` is what the inspector prints '
      + 'under every card mentioning a keyword, and for attributes with NO printed reminder it '
      + 'is the only statement of the rule that exists. `engine.ts:4222` on {Reaping} says so '
      + 'outright: *"none of the four cards carries a reminder at all. ui/glossary.ts is the '
      + 'repo\'s own statement of it, AND IT IS WHAT R184 READ."* So a wrong row is a rules bug, '
      + 'not a UI nit. '
      + '(a) **Trash** — says *"a NONTOKEN card entering a bin from anywhere but the stack is '
      + 'trashed"*. `E.toBin` has NO token check, and its docstring says why: *"tokens included, '
      + 'and NOT because a token is a card (R133: it is not), but because trashing is defined by '
      + 'the destination, not by the object."* R133 records that the only printed "nontoken" '
      + 'wording came from Void Scavenger, A CARD CUT FROM THE SET. Reach: 14 cards. '
      + '(b) **Piercing** — says *"excess damage from its BLOCKED COLUMN carries through to the '
      + 'DEFENDING PLAYER"*. The engine generalised off the column at engine.ts:3978-3995 '
      + '(CARD-TODO #4) on the owner\'s 2026-08-23 ruling: *"piercing is done even when its on a '
      + 'non-combat effect"*. AND THE PRINTED CARDS ARE ALREADY RIGHT — Protective Adaptations '
      + 'and Pernicious Photosynthesis both print *"excess damage from piercing sources is dealt '
      + 'to the RECIPIENT\'S CONTROLLER"*. Exactly the Glimpse shape: card right, glossary behind. '
      + '(c) **Unaware** — carries R10\'s wording, superseded by R106. Never states the operative '
      + 'rule (both sides read PRINTED stats), and R10\'s "everything counts as interacting" '
      + 'included TARGETING, which R106 deliberately does not implement. Reaches Bubb, '
      + 'Trashling, Haboob. '
      + '(d) **Virus** — says *"may be augmented during battle onto an ENEMY unit"*. '
      + '`doAugment`\'s battle branch never checks who controls the host and R157 §26 says so; '
      + 'the row also OMITS the real restriction, `from === \'hand\'`. Reach: 64 cards mention '
      + 'Virus. '
      + 'Minor, same family: **Electric** omits the recursion engine.ts:4021-4045 implements and '
      + 'that Envoy of Lightning\'s printed reminder DOES name.',
    evidence:
      'Round-27 class audit. (a) and (b) verified by the auditor with runnable probes — a token '
      + 'Wisp destroyed emits `trashed | ... | {"token":true}`. (c) and (d) from a subagent '
      + 'sweep, spot-checked. '
      + '⚠ CHECKED AND CORRECT, for the record, so nobody re-audits them: Rot, Afflicting, '
      + 'Reaping (post-R184), Pure\'s "outside combat: not implemented yet" caveat, Cache, Debt, '
      + 'Once, Graft, Battle, Haste, Shard, Prismite. '
      + '52-ui-glossary.test.ts:56-63 states the gap in its own words: *"The TEXT cannot be '
      + 'checked automatically… everything else is on the author."* Seven rows have been pinned '
      + 'one at a time, each AFTER being caught.',
    fix:
      'Reword each off what the engine does, citing the ruling — the R190 precedent. Then build '
      + 'CT-76\'s conformance test, because four wrong rows out of a handful examined is not a '
      + 'base rate that survives being fixed one at a time.',
    proof: null,
    verify: 'Each of the four rows states the rule the engine implements, and cites it.',
    guards: [
      '177-glossary-conformance.test.ts::every glossary row cites a ruling, and every citation RESOLVES and is LIVE',
      '177-glossary-conformance.test.ts::printed text wins — no row drops a rules word its own card prints',
      '177-glossary-conformance.test.ts::every attribute with a printed reminder ADMITS it',
      '177-glossary-conformance.test.ts::the rows resting on NEITHER a ruling NOR printed text, by name',
      '177-glossary-conformance.test.ts::the staleness detector can tell a retired ruling from a live one',
      '177-glossary-conformance.test.ts::the printed-reminder scrape finds the pool it is supposed to read',
      '177-glossary-conformance.test.ts::every check above goes RED on a row broken on purpose',
      '177-glossary-conformance.test.ts::and stays GREEN on the rows as they really are',
    ],
    closed:
      'R206 (2026-08-26). CT-80 (the rows) and CT-76 (the checker) landed together, because splitting them is how the rows get reworded and the checker never arrives. ⚠⚠ THE CLASS IS **15 WRONG ROWS OUT OF 43 — A 35% BASE RATE**. The ticket said four; the orchestrator\'s audit found seven; reading the 26 rows NOBODY had ever examined found eight more: Unstable (omitted the printed type line entirely AND stated the erase unconditionally — R145 scopes it to the ACTIVE ZONES, so from hand/deck/bin/cache it bins normally), Prophecy (\"normal timing still applies\" is flatly false for a banner ending [Haste]), Augment and Graft (neither said WHEN — both are deployment actions — and Graft\'s \"[Switch1] is bounded\" is contradicted by R110\'s multiplier), Haste (canHaste opens the step on FIVE conditions; the row named one), Shard (two callers since R132), Prismite and Recycle (\"any element\" is gated to the game\'s elements). ⚠⚠ **FIVE OF THE FIFTEEN WERE ON CT-80\'S OWN \"CHECKED AND CORRECT, DO NOT RE-AUDIT\" LIST** — Pure, Graft, Haste, Shard, Prismite. That list was not a saving; it was a liability, and it should be read as a warning about protected lists generally rather than re-trusted. THE CHECKER: two derived checks plus six engine pins. The one that matters is PRINTED TEXT WINS — for the 15 attributes carrying a printed reminder, the row may not drop a rules word the card uses, derived from printed.json so a new card extends it for free. Run cold against the OLD table it named {Piercing} and {Electric} and nothing else. Citations must resolve to a LIVE ruling, with retirement read from the header OR the leading blockquote — R10 and R76 are marked only in the blockquote, and R10 is exactly what {Unaware} was still teaching. ⚠ CT-76\'S \"every entry must cite an R-number\" IS NOT ACHIEVABLE and was replaced with something honest: Flying, Evasive, Poisonous, Resonant and Lethal have no ruling and never did. The rule is now \"cite a SOURCE\" — an R-number that resolves and is live, or \'printed\' which must be true of the pool — and the residue with neither is asserted BY NAME (Evasive, Resonant) rather than left implied. ⚠ THE AGENT MEASURED ITS OWN INSTRUMENT and pinned two false-positive classes as negative controls: a fixed-size body window marks R9 and R17 retired (their bodies are two lines, so it runs into the next ruling\'s marker), and a body-wide match marks R18 retired because it says \"The ⚠ is withdrawn\" about its own warning. Either would have falsely accused the {Haste}, {Once} and {Prismite} rows. Nine mutants run in-suite every run. ⚠ NEITHER TICKET NAMED R103, which is IN THE REGISTER titled \"{Piercing} pierces on NON-COMBAT damage too, into the unit\'s controller\" — the rule WAS written down; only the glossary never heard. Both tickets\' Piercing and Electric line numbers were also wrong (:4088-4119 and :4123-4160, not :3978-3995 and :4021-4045). REPORTED, NOT FIXED (correctly — the engine is another agent\'s territory and a row is not the place to change behaviour): engine.ts:10599-10607 declares its own canHaste/castable() divergence, so the haste step can open with nothing playable or be skipped while a playable card sits in hand. The {Cache} row\'s \"you both see every cached card\" is qualified by R188, which is CT-77\'s open question, and was left alone. ORCHESTRATOR VERIFIED INDEPENDENTLY: reverting the Piercing row to its pre-R206 wording reddens two tests and names the card AND the dropped word — \"the PRINTED reminder on Protective Adaptations says ... and the glossary row drops [controller]. Printed text wins — reword the row, not the card.\" Reverted; 15/15.',
    status: 'done',
  },
  {
    id: 81,
    area: 'coverage',
    severity: 'major',
    title: 'Guards landed this round that are scoped to their ticket\'s card list instead of the pool',
    detail:
      'The round\'s own output reproducing the failure the round exists to catch. '
      + '(a) **`GLIMPSE_CARDS`** in `161-printed-text-overrides.test.ts:81-87` hardcodes CT-73\'s '
      + 'five reported names. **Eleven cards call `E.glimpse()`**, and a SIXTH prints a full '
      + '`{i}(Reveal the top…)` reminder the guard never touches: **Visionary Construct** '
      + '(`batch-hybrids-ld-c.ts:337`, Glimpse 1, `recycles: false`). The other five — Lifebound '
      + 'Seer (2, true), Seer of Empty Spaces (1, false), Glook (1, false), Maw of Despair '
      + '(2, true), Lilbot (2, true) — glimpse with NO printed reminder, so the glossary row is '
      + 'the only reminder their readers get, which is precisely why R190\'s glossary fix needs '
      + 'them in scope. '
      + '(b) **CT-70\'s family has two members `SILENT_KNOWN` structurally cannot see.** '
      + '`65-effect-conformance` convicts only an effect emitting NO event at all, so an effect '
      + 'whose opponent-loop is empty BUT WHOSE OTHER HALF FIRES is invisible to it forever. '
      + 'Unguarded at HEAD: **Dragnol** (`batch-hybrids-ld-c.ts:263`) pays the mana and gains the '
      + 'life, then loops zero times in silence; **Shoreline Specter** '
      + '(`batch-water-b.ts:290-292`) announces the recall while the life loss silently does not '
      + 'happen — and its own prompt says *"(each opponent loses 2 life)"*.',
    evidence:
      'Round-27 class audit, exhaustive over `allCardNames()` (495 = 492 printed + 3 synthetics) '
      + 'by BOTH printed text and `glimpse(` call sites, the two lists identical. '
      + '⚠ A sweep driven off printed.json alone MISSES `registerSynthetic` cards; that is how an '
      + 'earlier sweep skipped the exact card in a report. '
      + 'Big Glimpse Card is deliberately excluded: its NAME says Glimpse, its text does not, and '
      + 'it never routes through E.glimpse.',
    fix:
      'DERIVE both lists, never type them. For Glimpse: '
      + '`allCardNames().filter(n => /Glimpse/i.test(getCard(n).text ?? \'\'))` with `recycles` '
      + 'computed from the parsed N, plus an assertion that the count is 11 so a NEW Glimpse card '
      + 'fails on arrival rather than being silently uncovered. '
      + 'For CT-70\'s pair: the harder half is that 65 needs a SECOND board — opponents present '
      + 'but with nothing to give — or the whole empty-collection branch class stays invisible no '
      + 'matter how many cards are repaired. That is CT-74, and these two are its first members.',
    proof: null,
    verify:
      'A new Glimpse card fails the guard on arrival; Dragnol and Shoreline Specter announce '
      + 'their empty branches.',
    guards: [
      '161-printed-text-overrides.test.ts::the Glimpse list is DERIVED and complete — a NEW Glimpse card fails here',
      '161-printed-text-overrides.test.ts::the parsed N and the derived `recycles` agree with what each card prints',
      '179-empty-collection-branches.test.ts::Shoreline Specter — its prompt promises "each opponent loses 2 life"',
    ],
    closed:
      'R209 (2026-08-26). CT-74 (the class) and CT-81 (the derived lists) landed together, because '
      + 'CT-81\'s own fix said of Dragnol and Shoreline Specter "that is CT-74, and these two are its'
      + 'first members". PART A — THE GLIMPSE LIST IS DERIVED. 161-printed-text-overrides\''
      + 'GLIMPSE_CARDS went from FIVE hardcoded names to ELEVEN computed from printed text, and all'
      + 'three of the file\'s loops with it. `recycles` is computed from the parsed N; a third derived'
      + 'field, `reminder`, had to be added because five of the eleven print the keyword bare and the'
      + 'recycle assertion cannot be asked of them. Big Glimpse Card is correctly excluded and two'
      + 'assertions pin WHY (the word is in its NAME, not its text). ⚠ BOTH WARNED TRAPS WERE REAL:'
      + 'four of the eleven route through file-local `glimpse()` wrappers, so a call-site sweep'
      + 'misses them and the printed-text derivation is the only safe one. Positive control:'
      + 'appending "Glimpse 2" to a card\'s text reddens three tests AND drives the intruder through'
      + 'every loop. ⚠ PART B — ALL THREE CODE-SHAPE READINGS WERE REJECTED, AND THAT IS THE FINDING.'
      + 'The agent swept on the PLAYER-FACING property instead: a clause that promises a per-seat'
      + 'outcome, resolves over an empty collection — of seats or of picks — and emits nothing for'
      + 'that clause. Its reasoning: the accumulator is not the class (Perish has none), the cause is'
      + 'not the class (CT-70 vs CT-74 changes only the wording), and every shape reading orphans the'
      + 'other shape onto no ticket, which is the docs/13 §4 failure this ticket pair exists to'
      + 'correct. Result: 12 REPAIR SITES, 15 CONFORMANCE LABELS — Cull, Seabed Shellcaster and'
      + 'Recall each back two labels with one shared EffectDef object, pinned by an assertion each,'
      + 'which is the double-counting trap CT-70 paid for once already. ⚠ THE TICKET\'S EXEMPLAR WAS'
      + 'ALREADY FIXED: Malicious Hardware carries its empty-picks line at'
      + 'batch-hybrids-wm-a.ts:761-764, landed by R187 in the same commit that spun CT-74 off. ⚠⚠'
      + 'PART C IS THE DELIVERABLE THAT OUTLASTS THE TWELVE REPAIRS. 65-effect-conformance has a'
      + 'THIRD BOARD, `barren`. Both existing boards gave every present seat a unit, so the empty'
      + 'branch was not rare — IT WAS UNREACHABLE, and the sweep reported clean forever. On its first'
      + 'run, before a single card was changed, it convicted SEVEN LABELS — including `spell:Perish`,'
      + 'which is on no ticket and in no report. And SILENT_KNOWN\'s reason is falsifiable at last:'
      + 'entries carry the SET OF BOARDS they are silent on, asserted by equality, so "silent for a'
      + 'NEW reason" reddens where the old `length > 40` check let a stale reason outlive its truth.'
      + 'That repairs the unfalsifiable closure the round-28 audit found in CT-70, whose verify line'
      + '— "SILENT_KNOWN is empty for the R25 family" — was satisfiable while members remained. 85'
      + '§9\'s three cards (Restitution, Vroot, Flzzz) are merged into 158, so the R25 family has one'
      + 'owner. REPORTED, NOT FIXED, CORRECTLY: Luminous Arc and Dreadwave Devourer THROW on'
      + '`ctx.targets[0]!` with no targets. Unreachable in a real game because R86 fizzles first, and'
      + 'the fix is engine-side; 65 now prints them by name every run instead of counting them.'
      + 'ORCHESTRATOR VERIFIED INDEPENDENTLY: removing Shoreline Specter\'s new line reddens 179 and'
      + 'the failure message SHOWS THE OTHER HALF\'S EVENTS — "resolved over an EMPTY collection and'
      + 'said nothing about it. The 2 event(s) it did emit are the OTHER half of the card" — which'
      + 'demonstrates CT-81(b)\'s claim rather than asserting it. Restored; 107/107 across 161, 65,'
      + '158 and 85.',
    status: 'done',
  },
  {
    id: 82,
    area: 'coverage',
    severity: 'minor',
    title: 'The residues: four follow-ups the round\'s own fixes left behind',
    detail:
      '(a) **CT-55 — four paths reach `endBattleRound`, not one**, and R194 is class-complete by '
      + 'luck rather than by design: `apply.ts:1516` (the ticket\'s decline), `engine.ts:9140` '
      + '(post-afterWindow, legitimate), `engine.ts:10234` (recursive "sent no counterattackers"), '
      + 'and **`batch-hybrids-wm-b.ts:309` — Temporal Rift, a CARD ending the battle '
      + 'mid-resolution**. `passEndsBattlePhase` covers 10234 but NOT Temporal Rift, and its '
      + 'documented invariant is false for it. All four funnel through `startRegroup`, so the '
      + 'announcement reaches them — but nothing says so. '
      + '(b) **CT-64 has a twin nobody filed**: `.regionbin` (`main.ts:1755`) is a '
      + '`data-btn="binopen"` container whose thumbs carry no handler, while the bin DIALOG\'s '
      + 'entries carry `data-act="bin"` and bin cards are legally playable right now. Identical '
      + 'shape, and CT-64\'s prescribed fix cannot work on it either — see CT-75. '
      + '(c) **CT-65 residue**: R192 fixed `cardHtml`\'s badge only. Three more multi-slot class '
      + 'builders (`main.ts:1261`, `:1483`, `:1767`) and ~23 trailing-space sites remain, '
      + 'including `main.ts:1400` IN THE SAME FUNCTION, where an empty `opts.data` renders '
      + '`class="card"␣␣data-prev=` and defeats any regex spanning the two attributes. No test is '
      + 'CURRENTLY unfalsifiable, but `144-hotseat-decision-gate.test.ts:219` is one CSS class '
      + 'away. '
      + '(d) **CT-72 residue**: R189 fixed `queueFlashes`. A SECOND serialiser is still live and '
      + 'unnamed anywhere — `anim.ts:183` staggers EVERY card flight by list index (45ms, capped '
      + '220ms), including triggers that reached `state.stack` together, which fits the owner\'s '
      + 'wording for the battle/deploy routing `queueFlashes` never touches.',
    evidence:
      'Round-27 class audit; (a), (b) and the two `main.ts` sites in (c) verified by the auditor '
      + 'directly, (d) from its UI sweep.',
    fix:
      'Each is small. (a) is a comment and a test, not a code change. (b) rides CT-75, which has '
      + 'to fix the delegator first. (c) is the one-liner CT-65 deferred to a quiet tree, plus '
      + 'the audit of what it changes. (d) needs the same "positive evidence only" gate R189 '
      + 'built, applied one layer down.',
    proof: null,
    verify: 'Each of the four is either fixed or has a named reason it is not.',
    guards: [
      '183-end-battle-round-paths.test.ts::exactly four call sites reach endBattleRound',
      '183-end-battle-round-paths.test.ts::every path funnels through startRegroup',
      '183-end-battle-round-paths.test.ts::passEndsBattlePhase names Temporal Rift',
      '183-end-battle-round-paths.test.ts::stripCode really is blanking the prose mentions',
      '176-nested-affordance-and-serialiser.test.ts::a bin card usable RIGHT NOW is one click from the region panel',
      '176-nested-affordance-and-serialiser.test.ts::an unusable bin thumb keeps the old route',
      '176-nested-affordance-and-serialiser.test.ts::nothing the client writes has a doubled or trailing space in a class',
      '176-nested-affordance-and-serialiser.test.ts::flights that made the same journey in one render share a beat',
      '176-nested-affordance-and-serialiser.test.ts::POSITIVE EVIDENCE ONLY',
    ],
    closed:
      'ALL FOUR RESIDUES CLOSED. (b)(c)(d) by R205 with CT-75; (a) by R213. '
      + '(a) — the four paths are now DERIVED from source and asserted by file and by REASON, '
      + 'never by line, and the reason that matters is the invariant nobody had written down: '
      + 'every exit from endBattleRound funnels through startRegroup, which is WHY R194 is '
      + 'class-complete. A fifth caller fails the suite and names the file. The real defect was '
      + 'the other half — `passEndsBattlePhase`\'s doc comment enumerated the transitions as if '
      + 'they were all of them, which made a documented invariant FALSE for Temporal Rift. It '
      + 'now names that path and says why it is uncoverable: the warning answers "would passing '
      + 'RIGHT NOW end the battle" from the state at pass time, and whether a card later on the '
      + 'stack will end the battle is not predictable from there. Not a bug that it cannot fire; '
      + 'a bug to imply it could. '
      + '(b) `binplay` on live bin thumbs, `handleBinClick` extracted so panel and dialog share '
      + 'one handler, one `binUsableIndexes` predicate feeding both the affordance and the glow. '
      + '(c) 17 sites fixed, guarded over RENDERED markup with its own red-check: 12 bad class '
      + 'attributes plus the `class="card"␣␣data-prev=` gap, now 0. '
      + '(d) `flightDelays` extracted pure from anim.ts; JOURNEY, not array index, is the unit of '
      + 'spacing, positive evidence only (a move with either anchor null keeps its own step). '
      + '⚠ EVERY LINE NUMBER IN THIS TICKET WAS WRONG EXCEPT (d)\'s. (a): :1541/:9563/:10749/:316, '
      + 'not :1516/:9140/:10234/:309. (b): .regionbin is :1816, not :1755. (c): the cardHtml site '
      + 'is :1467 not :1400, and the "three multi-slot class builders" at :1261/:1483/:1767 are '
      + 'NONE OF THEM class builders — the real count is two, and "~23 trailing-space sites" is '
      + '16. That is why 183 derives its call-site list instead of pinning the ticket\'s lines: a '
      + 'guard built on those numbers would have been wrong on arrival. '
      + 'ORCHESTRATOR VERIFIED (a) INDEPENDENTLY: planted a fifth caller in batch-fire-a.ts, §2 '
      + 'reddened and named the file; reverted, 5/5.',
    status: 'done',
  },
  {
    id: 83,
    area: 'coverage',
    severity: 'minor',
    title: 'Nine allowlists have no staleness test, and one has zero assertions at all',
    detail:
      'CT-68 caught DEAD_EXEMPT naming two helpers R181 had deleted — a waiver outliving its '
      + 'reason, in the very file built to prevent that. It is not the only one. The audit counted '
      + '**nine lists with no staleness test**, the worst being **`NOT_A_GAP`** '
      + '(`71-card-ledger.test.ts:368`, 9 entries, ZERO assertions). '
      + 'Also concrete: **`POOL_CLAIM_ALLOWLIST[0]`** (`147-comment-conformance.test.ts:409`) says '
      + 'a claim is *"KNOWN FALSE … assigned to whoever fixes Burgeon"*. Burgeon IS fixed '
      + '(`doubleStats` in helpers.ts:300, regression at 140-layers-and-riders.test.ts:245, '
      + 'retraction at batch-wood-a.ts:73-85) and no Burgeon ticket exists. §2 of that same file '
      + 'has the right mechanism for this (`RETRACTED`, :350); §3 does not use it. '
      + 'And **`export function printedCost`** (`dsl.ts:418`) has zero references tree-wide — '
      + 'exported so noUnusedLocals ignores it, outside src/cards/sets so §4 never saw it — while '
      + 'carrying an 8-line R64/R157 doc comment that reads as a live description of the rules.',
    evidence:
      'Round-27 class audit and the R193 agent, independently. The general principle is the one '
      + 'this repo keeps relearning: **an exemption list is a claim about the code, and nothing '
      + 'checks it.** Prefer an ALLOWLIST that fails loudly when its reason expires, and make '
      + 'every entry carry a machine-checkable reason rather than prose.',
    fix:
      'Give each of the nine a staleness assertion of the shape R193 gave DEAD_EXEMPT: every '
      + 'entry must still resolve to the thing it exempts. Start with NOT_A_GAP, which asserts '
      + 'nothing today. Then retire POOL_CLAIM_ALLOWLIST[0] and printedCost.',
    proof: null,
    verify: 'A stale entry in any of the nine fails the suite, naming the entry and its reason.',
    guards: [
      '180-pool-sight.test.ts::every test file that sweeps the card pool can see all of it',
      '180-pool-sight.test.ts::every BLIND_ON_PURPOSE entry still names a file, and its reason still holds',
      '180-pool-sight.test.ts::the import walker finds a blind file, a sighted one, and a bare import',
      '180-pool-sight.test.ts::the pool floor the eight sweeps carry can actually fail',
      '71-card-ledger.test.ts::NOT_A_GAP',
      '147-comment-conformance.test.ts::POOL_CLAIM_ALLOWLIST',
      '153-typecheck-reach.test.ts::SKIP_DIRS',
    ],
    closed:
      'R210 (2026-08-26). ⚠ THE HEADLINE NUMBER WAS WRONG IN THE TICKET\'S OWN FAVOUR AND THE '
      + 'CLOSURE HAS TO SAY SO: 37 waiver tables exist (34 excluding 142\'s three classification'
      + 'maps), and 31 ALREADY CARRIED A STALENESS ASSERTION. Six did not — not nine — and only three'
      + 'of those six were non-empty and genuinely waiving. Over-counting a gap costs the same'
      + 'credibility as under-counting one, and the honest summary is that the repo was already doing'
      + 'this right 31 times out of 37. Two of the existing ones — 122\'s WORD_OVERRIDES and 182\'s'
      + 'KNOWN_WRONG — pin EXACT MEMBERSHIP, which is stronger than CT-83 asks for. The independent'
      + 'audit reached 33/27 on a different waiver-vs-classification boundary; THE SIX ARE IDENTICAL'
      + 'either way, which is the number that matters. LANDED: NOT_A_GAP, POOL_CLAIM_ALLOWLIST,'
      + 'PARKED_EXEMPT, NOT_SCANNED and SKIP_DIRS all re-derive from the registry, the source or git.'
      + 'NO LENGTH-OF-REASON CHECKS ANYWHERE — the ticket named that failure (SILENT_KNOWN checks its'
      + 'reason for `length > 40` and nothing else, so a stale reason outlives its truth) and this'
      + 'deliberately does not repeat it. ⚠ POOL_CLAIM_ALLOWLIST[0] RETIRED, AND THE REASON IT'
      + 'SURVIVED IS THE REAL FIND: §2 has read retractions over the ENCLOSING BULLET since it was'
      + 'written, but §3 matched line by line — so §3 could never see batch-wood-a.ts withdraw'
      + 'itself, and the Burgeon waiver sat there after Burgeon was fixed. §2\'s walk is lifted out as'
      + 'a shared `enclosingBullet()`. The new `basis` field then CAUGHT THE AGENT\'S OWN ERROR ON ITS'
      + 'FIRST RUN: it recorded batch-dark-c.ts as `retracted` when that claim is a `//` block rather'
      + 'than a `*` bullet, and the test refused it; re-based as `verified` with a real check. ⚠'
      + 'SKIP_DIRS BELONGS, AND IS THE MORE DANGEROUS KIND, which is the argument the ticket did not'
      + 'make: a waiver names what it waives, but a SKIPPED DIRECTORY is invisible in both directions'
      + '— and §1\'s verdict is quantified over the corpus SKIP_DIRS defines. That is R181\'s own'
      + 'failure reproduced inside the file written to prevent it. Now asserted against `git'
      + 'ls-files`. ⚠ ALL THREE OF THE TICKET\'S printedCost CLAIMS WERE WRONG: it is dsl.ts:423 not'
      + ':418 (there is no engine/src/dsl.ts); the doc comment is 9 lines not 8; and "outside'
      + 'src/cards/sets so §4 never saw it" is FALSE — R193 widened §4, which SAW it, waived it with'
      + 'a written expiry, and guarded the waiver. So retiring it is a cleanup and the machinery'
      + 'worked as designed. Deleted, waiver removed, DEAD_EXEMPT kept empty-with-guard. STILL OPEN,'
      + 'HANDED BACK: the KNOWN_UNACTIVATED patch (84-card-semantics was another agent\'s territory'
      + 'this round) — mirrors KNOWN_UNMET\'s check and enforces the REAL/BOARD rule its own comment'
      + 'already states. Exact wording is in the agent\'s report.',
    status: 'done',
  },
  {
    id: 84,
    area: 'coverage',
    severity: 'blocker',
    title: 'The engine suite structurally cannot catch a secrecy bug — h.log has no seats in it',
    detail:
      '`Harness.absorb()` pushes every event\'s `msg` into ONE `log` array with no seat '
      + 'separation, and `visibleToSeat` is nowhere near it. So **any secrecy assertion written '
      + 'against `h.log` is unfalsifiable**, and the suite reads green whether the information is '
      + 'public or private. '
      + 'The concrete instance: `42-dark-b.test.ts:1331` asserts '
      + '`h.log.some(l => l.includes(\'Thought Extraction reveals\'))`. That passed BEFORE the '
      + 'leak was fixed and passes after it. The card was publishing an opponent\'s entire hand '
      + 'to the shared log and its own test could not tell.',
    evidence:
      'Found by the R197b agent while fixing the three "look at a hand" leaks, and it is the '
      + 'structural reason that class survived: 173-look-at-a-hand.test.ts had to reach past the '
      + 'Harness into `server/view.ts::visibleToSeat` to say anything at all. '
      + '⚠ THE SAME BLINDNESS COVERS R202. The `handEntered` leak — the opponent\'s incoming '
      + 'card names on the wire in every phase — was likewise invisible to every engine test, and '
      + '172-event-channel-secrecy.test.ts also had to import `server/view.ts` to see it. '
      + 'TWO independent information leaks in one round, both invisible to 153 test files for the '
      + 'same reason. This is the highest-value checker gap currently known.',
    fix:
      'Give the Harness a seat-aware log — either `h.logFor(seat)` built through `redactLog` / '
      + '`visibleToSeat`, or a `h.visibleLog` pair — so a secrecy claim can be written where the '
      + 'cards are tested instead of only in a server-adjacent file. '
      + 'Then add a `154-guard-shape`-style LINT: an assertion that names a card and a secret in '
      + 'the same breath must not be reading `h.log`. That is the half that stops it recurring — '
      + 'the Harness change alone leaves 153 files still asserting against the flat log. '
      + '⚠ Expect the lint to flag existing tests that are fine (a PUBLIC reveal legitimately '
      + 'reads the shared log). Bioremediation and Void Memory are the controls.',
    proof: null,
    verify:
      'A card that publishes a hidden zone to the shared log fails a test written in the card\'s '
      + 'own test file, without importing the server.',
    guards: [
      '174-secrecy-is-seat-aware.test.ts::logFor(h, seat) CAN SEE',
      '174-secrecy-is-seat-aware.test.ts::the seat log is built from EVENTS',
      '174-secrecy-is-seat-aware.test.ts::the lint is not blind',
      '174-secrecy-is-seat-aware.test.ts::no assertion names a card and a secret in the same breath',
      '174-secrecy-is-seat-aware.test.ts::the lint has reach',
      '174-secrecy-is-seat-aware.test.ts::Bioremediation and Void Memory print REVEALS',
      '42-dark-b.test.ts::Thought Extraction: strip a card from a hand you can see',
      '26-metal-a.test.ts::Dreamtender',
    ],
    closed:
      'R203 (2026-08-26). `test/util.ts::logFor(h, seat)` runs `h.events` through '
      + 'server/view.ts::redactLog — the log that seat is ACTUALLY served — and '
      + '174-secrecy-is-seat-aware is the lint that keeps secrecy claims off `h.log`. '
      + 'It is a free function over a Harness, not a method on it, because engine/src must not '
      + 'import server/ (server/view.ts already imports engine/src/engine.ts, so a method would '
      + 'close a cycle); engine TESTS import view.ts freely, which is what makes this legal. '
      + 'Built from `h.events`, never `h.log`, so it cannot re-make the log/logTypes drift. '
      + 'THE LINT HAS ZERO PROSE EXEMPTIONS, and that is the point: both halves are DERIVED — '
      + 'the private-look card set from PRINTED TEXT via allCardNames(), and the private-fragment '
      + 'set by scanning every `privateTo`-tagged `.ev(` under engine/src. A vocabulary rule '
      + 'would have needed three prose waivers (exactly the CT-83 shape); the derived rule needs '
      + 'none, and Void Memory / Worldbender are planted as controls proving it stays quiet on '
      + 'legitimate public reveals. '
      + 'ORCHESTRATOR VERIFIED INDEPENDENTLY: dropping `{ privateTo: ctx.controller }` from '
      + 'batch-dark-b.ts:848 reddens 42-dark-b IN THE CARD\'S OWN FILE with no server import, and '
      + 'the failure message is the leak itself — ten of the opponent\'s card names printed in '
      + 'full. Reverted; 131/131 across 42-dark-b, 174, 26-metal-a, 172 and 173. '
      + '⚠ TWO TICKET CLAIMS WERE WRONG, BOTH IN THE FLATTERING DIRECTION FOR THE TICKET. '
      + '(1) Bioremediation is NOT a flat-log control — its test (23-wood-a:54) reads no log at '
      + 'all, it asserts on `state.seenHand`. Only Void Memory is; §5 pins both facts. '
      + '(2) "153 files still asserting against the flat log" OVERSTATES it: measured, 167 '
      + 'assertions read a seatless Harness log and EXACTLY ONE was a secrecy claim. The other '
      + '166 assert on public events and are correct. 153 is the size of the CAPABILITY gap, not '
      + 'a count of unfalsifiable assertions — so this lint\'s value is prospective, and saying '
      + 'so is the honest close. Only 2 existing tests changed behaviour (42-dark-b, 26-metal-a). '
      + 'The lint follows hoisted `const x = h.log.…` bindings, because 26-metal-a already had '
      + 'that shape and a one-line hoist would otherwise evade the rule.',
    status: 'done',
  },
  {
    id: 85,
    // 'server' is not a TodoArea — the enum is card/attribute/engine/client/
    // coverage. A flaky suite is a COVERAGE defect: it is the tests failing to
    // tell the truth about the code, not the code failing.
    area: 'coverage',
    severity: 'major',
    title: 'The server suite fails about one run in three, on a different test each time',
    detail:
      'Measured by the orchestrator: three consecutive `npm --prefix server test` runs gave '
      + '`fail 1`, `fail 0`, `fail 0`, and an earlier pair gave `fail 2` then `fail 0`. The '
      + 'failing test differs run to run — `test-building.ts` (ECONNREFUSED) and '
      + '`test-postgame.ts` have both been seen — and each passes standalone.',
    evidence:
      'Reported INDEPENDENTLY by two agents this round (R191 and R200) before the orchestrator '
      + 'reproduced it, both correctly identifying it as contention rather than a regression: the '
      + 'suite binds real ports and reads a real clock, and fifteen agents were running. '
      + '⚠ THE REASON THIS IS `major` AND NOT A NUISANCE: a suite that goes red at random cannot '
      + 'be trusted to go red for a REASON. Every agent this round was told "I run the full suite '
      + 'myself"; a flaky red is exactly the signal that gets waved through as "probably the '
      + 'flake" on the day it is real. It also cost real time this round — one agent re-ran its '
      + 'entire verification serially to be sure.',
    fix:
      'Bind port 0 and read back the assigned port instead of hardcoding one, and inject the '
      + 'clock rather than reading `Date.now()` — the same treatment `ALGO_ISSUES_FILE` and '
      + '`ALGO_ENGINE_VERSION` already give the other two ambient dependencies. '
      + '⚠ Until then, `server/package.json` should run the suite SERIALLY and say why, so a red '
      + 'run means something. Note the engine suite has the same property for a different reason '
      + '(153 files, 2-minute foreground timeout) and is already run serially from a script.',
    proof: null,
    verify: 'Twenty consecutive server suite runs under load are all green.',
    guards: [
      'server/test-clock.ts::each pack has been picked over once',
      'server/test-building.ts::both seats joined',
      'server/test-postgame.ts::joining a decided game gets the post-game payload, not just a dead board',
    ],
    closed:
      'R204 (2026-08-26), AND THE TICKET NEEDED RE-SCOPING BEFORE IT COULD BE FIXED. '
      + '⚠⚠ BOTH PRESCRIBED FIXES WERE ALREADY IN THE TREE — this ticket would have been closed '
      + 'by doing nothing. "Bind port 0 and read back the assigned port": test-util.ts::freePort '
      + 'already did that. "package.json should run the suite SERIALLY and say why": already '
      + 'true, and MEASURED true — the 19 subtest durations sum to 28.5s of a 28.6s total. A '
      + 'third ticket claim was simply false: "the engine suite is already run serially from a '
      + 'script" — engine/package.json is plain `node --test`, run in parallel across cores, and '
      + 'no such script exists. There was nothing to match. '
      + 'MEASUREMENT FIRST: 10 runs on an idle box = 10/10 green (an unloaded box cannot measure '
      + 'a contention bug). 12 runs under 4 concurrent copies = **2 failures, 17%** — and both '
      + 'were the SAME assertion in test-clock.ts, which is on no ticket. '
      + 'THE REAL CAUSE, CAUGHT IN THE ACT: `test-clock.ts::advanceUntil` tested its predicate '
      + 'against a view while a message for the OTHER client was still in flight, then drove that '
      + 'client off its STALE `legal` — so seat 1 drafted twice. Its own docstring warns about '
      + 'this class and fixed only half of it. '
      + 'FOUR MORE, of which the ticket named none: (1) `freePort()` binds :0, reads the port and '
      + 'CLOSES it before handing the bare number to the child — a TOCTOU whose window is however '
      + 'long main.ts takes to boot, and which produces exactly the reported ECONNREFUSED; used '
      + 'by ELEVEN tests, not three. (2) test-building.ts discarded the ready line and slept '
      + '1200ms — the file the ECONNREFUSED was reported against had TWO independent reasons to '
      + 'produce one. (3) test-postgame.ts bound PORT+1 unchecked, and its readiness promise was '
      + 'the only one of eleven with NO exit rejection, so a failed bind became a silent 15s '
      + 'timeout naming nothing. (4) two time bounds assuming a join round trip costs under 300ms. '
      + 'SHIPPED: main.ts supports PORT=0 and prints the port it ACTUALLY bound; spawnServer() '
      + 'reads it back from the ready line; freePort() deleted; 11 tests converted; quiesce() '
      + 'waits for both sockets to fall quiet instead of sleeping longer; the time bounds derive '
      + 'from a MEASURED window. '
      + '⚠ THE CLOCK WAS DELIBERATELY NOT INJECTED, and the reasoning is right: `Date.now()` in '
      + 'settleClock is not ambient — elapsed wall time IS the feature. Faking it turns '
      + 'test-clock.ts into an arithmetic test, the exact "unit-test the last hop" shape '
      + 'docs/13 §5 lists as a defect. It also was not the flake. '
      + 'ORCHESTRATOR VERIFIED INDEPENDENTLY: 19 consecutive runs under ~7 concurrent suites '
      + '(heavier than the agent\'s 4-way), 19/19 green, 19 pass / 0 fail each. With the agent\'s '
      + 'own 24 that is 43 loaded runs green against a measured 17% baseline. '
      + '⚠ HONEST LIMIT, stated by the agent and worth keeping: the port race was never caught in '
      + 'the act. It is fixed on the strength of reading the code plus the argument that it '
      + 'produces precisely the reported ECONNREFUSED. The stale-view race IS the one that was '
      + 'reproduced, and it was in no ticket at all.',
    status: 'done',
  },
  {
    id: 86,
    area: 'card',
    severity: 'minor',
    cards: ['Slag Spewer'],
    title: 'A mod erased as a COST reaches no pile at all, and the drill was reading somebody else\'s event for it',
    detail:
      'Slag Spewer prints *"[Augment][once] [one], Erase one of my mods: I deal 2 damage to any '
      + 'target."* The erase really happens — R196 moved it into `payCastCost` as a proper '
      + '`castCost: { kind: \'eraseMod\' }` — but it is announced with '
      + '`g.ev(\'info\', "... is ERASED off ... — the cost of ...")` (engine.ts:6909). '
      + '`E.ev()` files the R65 PUBLIC ERASED PILE only for a `type: \'erased\'` event carrying a '
      + 'numeric `seat`, so the mod is **out of play and on no pile at all** — the one thing R65 '
      + 'exists to prevent, since the complaint that opened it was "there is currently no way to '
      + 'view erased cards". Every other erase site emits `erased`: E.eraseFromPlay, Spore of '
      + 'Regenesis\'s cost, both bin-erase sites in batch-metal-a / batch-dark-b.',
    evidence:
      '⚠ FOUND INDEPENDENTLY BY TWO AGENTS in the same round, from opposite directions — the '
      + 'R196 agent while rewriting the cost, and the R199 agent while chasing why the card read '
      + 'as OBSERVED. That second half is the more valuable finding: '
      + '**IT READ AS OBSERVED BY ACCIDENT.** The drill\'s press run used to end mid-activation, '
      + 'and `drillCard`\'s "ran out of steps" tail dumps everything from that activation to the '
      + 'END OF THE GAME into `activateTypes` — which swallowed the `erased` event produced when '
      + 'the HOST was later destroyed by the `die` beat. The card was borrowing somebody else\'s '
      + 'event. Making runs end cleanly closed that unbounded window and the card went dark. '
      + 'That is a new opener in 84-card-semantics\' UNREACHED — **EVENTLESS**: implemented, '
      + 'really happens, and nothing in the game can see it happen. Distinct from VOCAB, which '
      + 'says our vocabulary is too narrow.',
    fix:
      '⚠ THIS NEEDS A RULING, NOT A GUESS, and the R196 agent deliberately left it rather than '
      + 'change behaviour: **does a mod erased as a COST belong on the public erased pile?** '
      + 'R157 §3 arguably wants it there. Asked as Q3 of the round-27 owner questions. '
      + 'If yes it is one line — `\'info\'` -> `\'erased\'` with `{ seat, card }` — and the card '
      + 'stops being EVENTLESS for free. '
      + 'RELATED AND ALSO UNFIXED (R196 agent): there is **no choke point for erasing a mod off a '
      + 'host** at all. Three card-local sites hand-roll `host.mods.splice(...)` + '
      + '`delete s.entities[id]` (batch-hybrids-wm-b.ts:510, batch-hybrids-ld-a.ts:676, and Slag '
      + 'Spewer\'s, now in payCastCost). R178 built `E.moveMod`; the ERASE sibling does not '
      + 'exist, and this ticket is what a missing choke point looks like from the outside.',
    proof: null,
    verify:
      'The mod Slag Spewer erases as a cost is on a pile the players can see, or a ruling says it '
      + 'deliberately is not.',
    guards: [
      '178-played-item-and-erased-mods.test.ts::an erase paid as a COST still announces itself with "info" — Q3 is OPEN',
      '178-played-item-and-erased-mods.test.ts::Suppression Field: mods leave host and game, the host lives, and the pile is untouched',
      '178-played-item-and-erased-mods.test.ts::Return to Nature: the site that already got R65 right still files the public pile',
    ],
    closed:
      'R208 (2026-08-26), THE BUILDABLE HALF ONLY — Q3 REMAINS OPEN AND BEHAVIOUR IS '
      + 'BYTE-IDENTICAL. `E.eraseMod(mod, { leavesGame? })` now sits beside R178\'s `E.moveMod`:'
      + 'unlink from the host, delete the entity, and EMIT NOTHING — every caller keeps its own'
      + 'announcement, including Slag Spewer\'s plain `info`. That is the whole value of the choke'
      + 'point while the ruling is outstanding: when the owner answers Q3 it is ONE guarded line'
      + 'inside `eraseMod` instead of five scattered edits, and the seam is commented in place saying'
      + 'exactly which line the `ev(\'erased\', …)` goes on. ⚠ THE TICKET SAID THREE HAND-ROLLED SITES.'
      + 'IT IS FIVE. Two were invisible to the ticket\'s own `mods.splice` grep because they clear the'
      + 'list instead (`t.mods = []`): Suppression Field (batch-metal-c.ts:269) and Return to Nature'
      + '(batch-earth-b.ts:514). ⚠⚠ SUPPRESSION FIELD IS A SECOND LIVE INSTANCE OF THE SAME R65'
      + 'DEFECT AND WAS ON NO TICKET: real nontoken mod cards leave the game, the card says "ERASES"'
      + 'in its own log line, and nothing reaches the public pile. It belongs in Q3\'s scope and the'
      + 'owner should be told so before answering. Reclaim the Fallen routes with `leavesGame: false`'
      + 'because the card goes INTO PLAY — it is not an erase at all. ⚠ THE TOKEN HALF OF Q3 IS'
      + 'SELF-CONTRADICTORY TODAY and the owner should settle it in the same breath:'
      + '`disposeToBin`/`eraseUnit` DO file token mods on the erased pile; Ominous Growth does not.'
      + 'Ominous Growth\'s mods are token mods, so R133 may exempt them — that is a ruling, not a'
      + 'guess to make here. ORCHESTRATOR VERIFIED THE RULING IS GENUINELY PINNED OPEN, which is the'
      + 'claim that mattered: making `eraseMod` emit `erased` — i.e. answering Q3 in code without'
      + 'asking — reddens three tests by name (Slag Spewer, Suppression Field, Return to Nature).'
      + 'Restored; 9/9. So the next agent cannot quietly decide this one. STILL OPEN AND NOT CLOSED'
      + 'BY THIS: whether a mod erased as a COST reaches the R65 public pile. Q3/Q9 of the round-27'
      + 'owner questions.',
    status: 'done',
  },
  {
    id: 87,
    area: 'coverage',
    severity: 'minor',
    title: 'drillCard\'s "ran out of steps" tail is an unbounded evidence window',
    detail:
      'When a press run hits `maxSteps` mid-activation, `drillCard` dumps everything from that '
      + 'activation to the END OF THE GAME into `activateTypes`. Any event any card produces in '
      + 'that span is then credited to the card under test.',
    evidence:
      'This is exactly the blindness class CT-49 warns about, in CT-49\'s own instrument, and it '
      + 'had a live victim: **Slag Spewer read as OBSERVED because the window swallowed an '
      + '`erased` event produced when its HOST was destroyed several beats later** (CT-86). '
      + 'Round 26 found four blindnesses in this same checker and every one had made a number go '
      + 'UP — the direction that flatters. This is a fifth of the same shape. '
      + '⚠ MOSTLY MOOT NOW, which is why it is `minor` and not `major`: R199 made runs end '
      + 'cleanly, so the tail is rarely reached. But `maxSteps` can still be hit, and "rarely '
      + 'reached" is not "cannot fire". The R199 agent REPORTED rather than changed it, correctly '
      + '— a late unverified edit to the drill would have invalidated the round\'s measurements.',
    fix:
      'Bound the window: credit only events up to the end of the activation being pressed, and '
      + 'when `maxSteps` is hit mid-activation, record the run as INCONCLUSIVE for that claim '
      + 'rather than as evidence. An honest "could not tell" is worth more than a credited event '
      + 'that belongs to another card. '
      + 'Then re-measure the whole tally — some other card may be standing on the same accident.',
    proof: null,
    verify:
      'A press run that ends mid-activation credits the card under test with nothing that '
      + 'happened after it.',
    guards: [
      '181-inconclusive-activation-window.test.ts::a later card emits inside the unclosed window, and it is refused',
      '181-inconclusive-activation-window.test.ts::the borrowed evidence was SCORING evidence, not harmless noise',
      '181-inconclusive-activation-window.test.ts::the inconclusive flag can also say NO',
      '181-inconclusive-activation-window.test.ts::the pre-R211 behaviour is reachable ONLY from this control',
      '84-card-semantics.test.ts::drive every card and check it against its printed promises',
    ],
    closed:
      'R211 (2026-08-26). The tail is a REFUSAL now, not evidence: an activation still '
      + 'unresolved when the run ends records `actInconclusive` + a reason, and nothing scores '
      + 'off the span. 84-card-semantics prints an INCONCLUSIVE tally beside UNREACHED with '
      + '`assert.equal(incRuns, 0)` as a floor IN THE HONEST DIRECTION, and the `surprises` '
      + 'message now says "⚠ INCONCLUSIVE, not unreached" so nobody files a board precondition '
      + 'the card does not lack. '
      + '⚠ PART 1 MEASURED THE TAIL AT **ZERO**: 491 cards, 1296 drill runs, 0 ended '
      + 'mid-activation. The ticket\'s "mostly moot since R199" was UNDERSTATED — at HEAD it is '
      + 'entirely moot, and Part 3 re-measured the whole tally to a null: every number identical '
      + '(114/123, 278/316, augment 137, trigger 92, activated 35, condition 14, UNREACHED '
      + 'untouched), NO card changed state, no floor approached. So NO card was standing on '
      + 'borrowed evidence — measured, not assumed. '
      + 'THE WHOLE VALUE THEREFORE RESTS ON THE POSITIVE CONTROL, and it is a good one: an '
      + '`{augment, press}` Slag Spewer run, clipped at a maxSteps SEARCHED FOR AT TEST TIME (a '
      + 'hardcoded step would rot into a vacuous pass). The old window credited '
      + '`statChanged` from ANOTHER CARD\'s Protective Adaptations +1/+1 — and `EVIDENCE.pump` '
      + 'is `[\'statChanged\']` and nothing else, so the borrowed event was SCORING a pump '
      + 'promise for a card that prints no pump. CT-86\'s mechanism reproduced end to end. '
      + '⚠ THE TICKET WAS WRONG TWICE. (1) "a press run" — `press` ALONE never opens an '
      + 'activation window; `pendingAct` is set only under `activate` or `augment`, so a pure '
      + 'press run cannot reach the tail at all. (2) **`maxSteps` was not the only way in**: the '
      + '`gameover` break sits at the TOP of the loop, before the branch that closes a resolved '
      + 'activation, so a game ending mid-activation reached the identical unbounded tail. That '
      + 'matters because the drill\'s board is lethal by design (R199 raised the life top-up for '
      + 'exactly this). Both exits are covered and the reason is recorded: `maxSteps` means the '
      + 'drill is too impatient, `gameover` means the board killed somebody first, and only the '
      + 'first is fixable by turning a knob. '
      + 'ALSO FOUND, DORMANT, on no ticket: `pendingAct` is a SINGLE SLOT and the '
      + 'activation-taking branch does not require an empty stack, so a second activation offered '
      + 'while the first is unresolved would OVERWRITE the open window and silently DROP '
      + 'evidence — the UNflattering direction, which is why it would never have surfaced as a '
      + 'false positive. 0 occurrences over the same 1296 runs. '
      + 'ORCHESTRATOR VERIFIED: 181 is 4/4, and its opt-in flag for the OLD unbounded tail appears in '
      + 'exactly two files — drill.ts and 181 itself — which 181 asserts, so the pre-R211 behaviour '
      + 'cannot leak back into a scoring path. (That assertion caught this very closure note when '
      + 'it first named the flag verbatim, which is the guard working: it counts FILES, not call '
      + 'sites, and prose is exactly how such a hatch gets quietly re-adopted.)',
    status: 'done',
  },
  {
    id: 88,
    area: 'coverage',
    severity: 'minor',
    title:
      'Seventy test-local withE helpers hand-roll Harness.absorb, and sixty-two of them do it wrong ',
    detail:
      'R203 measured it while building the seat-aware log: 70 test files declare their own local '
      + '`withE` helper that re-implements what `Harness.absorb()` does, and only 8 of them reproduce'
      + 'the rule absorb states in its own docstring — "a signal-only event is not a log line". Only'
      + '2 keep `logTypes` index-aligned with `log`. So 62 files hold empty strings in `h.log` that a'
      + 'real hotseat log never contains, and 68 files have a `logTypes` array that has silently'
      + 'drifted out of alignment with the messages it is supposed to index. That is the exact bug'
      + '`src/harness.ts` warns about in the comment above `logTypes`, re-made sixty-eight times by'
      + 'copy-paste.',
    evidence:
      'Found by the R203 agent while building `logFor(h, seat)` for CT-84, and reported rather than '
      + 'fixed because it is 70 files. It is CURRENTLY LATENT and that is why this is minor, not'
      + 'major: no file both reads `logTypes` and has an unguarded push, so nothing is wrong today.'
      + '`logFor` is immune by construction because it reads `h.events`, never `h.log`. It is a'
      + 'loaded gun, not a firing one.',
    fix:
      'Export `absorb`/`withE` from `test/util.ts` and route all 70 files through it, so the rule '
      + 'lives in one place and cannot be re-derived wrongly. Then add a lint of the'
      + '`154-guard-shape` family asserting no test file declares its own. Do NOT hand-fix 62 files'
      + 'one at a time — that reproduces the cause. ⚠ Check as you go whether any of the 62 has a'
      + 'test that only passes BECAUSE its log holds an empty string; that would be a live defect'
      + 'hiding behind a latent one.',
    proof: null,
    verify:
      'No test file declares its own absorb; `logTypes` is index-aligned with `log` everywhere; and '
      + 'a lint names any file that reintroduces a local copy.',
    guards: [
      '197-absorb-is-shared.test.ts::the lint is not blind — it convicts a local absorb under any name',
      '197-absorb-is-shared.test.ts::no test source hand-rolls Harness.absorb',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R231. EVERY NUMBER IN THIS TICKET WAS ROUGHLY DOUBLE THE '
      + 'TRUTH, and a THIRD independent count agreed with the second: 35 files not 70, 31 wrong not '
      + '62, 4 correct not 8, 1 keeping logTypes aligned not 2. The method was mechanical rather '
      + 'than name-based — grep `.log.push(` for the population, then extract each enclosing '
      + 'helper, normalise whitespace and parameter names, and group by BODY. That grouping '
      + 'produced the finding that explains the whole ticket: **28 of the 35 helpers are '
      + 'BYTE-IDENTICAL** modulo the function name. This was never 35 people making the same '
      + 'mistake; it was one paste, 35 times. ⚠ A 36TH OFFENDER THAT THE TICKET\'S OWN DEFINITION '
      + 'CANNOT SEE. 136-triggers-and-modes.test.ts has a helper byte-identical to the shared one '
      + 'EXCEPT that it drops the log entirely — `h.events.push(...e.events);` and nothing else. '
      + '`.log.push(` cannot find it, and neither could a lint keyed on that. Its harness log '
      + 'silently omitted everything every white-box call did. The lint\'s rule was widened to a '
      + 'push into a Harness\'s `log`, `logTypes` OR `events`, so the honest population is 36. ⚠ AND '
      + 'THIS TICKET\'S PRESCRIBED `verify` WAS THE WRONG LINT, deliberately not implemented: "no '
      + 'test file declares its own absorb/withE" would have convicted 7 of 36, because the helper '
      + 'is called `whiteBox` 26 times, `withE` 7, `dealAllFrom` once, and in one file is a bare '
      + 'inlined loop with no helper at all. Keying on the NAME was the ticket\'s instinct and it '
      + 'was wrong; the lint keys on the SHAPE. §1(b) plants that exact evasion under four real '
      + 'names from the population and proves the shape rule catches all four. THE TICKET\'S '
      + '\'LATENT, NOT FIRING\' READING WAS TOO KIND AND TOO HARSH AT ONCE. Live in the data: '
      + 'instrumenting the shared absorb to count `!ev.msg` skips gives EXACTLY 12 files and '
      + 'EXACTLY 89 empty strings, independently reproducing the audit. But the ticket\'s own worry '
      + '— that some test passes BECAUSE its log holds an empty string — was checked and is FALSE: '
      + 'of the six files that read `h.log.length`, index `h.log` or touch `logTypes`, only one is '
      + 'in the population and it is one of the four already-guarded ones. WHAT SHIPPED: `absorb()` '
      + 'and `withE()` exported from test/util.ts (the rule in one place, guard and logTypes.push '
      + 'together); 31 files routed wholesale; 5 kept a genuinely different helper with only the '
      + 'absorb tail centralised — and the reason matters, because 125 and 53 have no try/catch and '
      + 'routing them through withE would NEWLY SWALLOW a Suspended, i.e. mask a real throw. '
      + 'Scripted, not hand-edited, because hand-fixing 31 files reproduces the cause. ⚠ THE AGENT '
      + 'REPORTED TWO BUGS IN ITS OWN SCRIPT, which is why this is trustworthy: a lazy regex '
      + '`/import\\s*\\{([\\s\\S]*?)\\}/` stretched from the file\'s FIRST import to the util one and '
      + 'mangled 12 files (reverted all 35 from git, redone with `[^{}]*`), and a backreference bug '
      + 'left a duplicated push in three files. Both caught by reading the diff. EVIDENCE IT '
      + 'CHANGED NOTHING: before and after across the 35, 752 tests pass and the sorted list of `ok '
      + 'N - <name>` lines is BYTE-IDENTICAL. Not one test changed result. ⚠⚠ ORCHESTRATOR VERIFIED '
      + 'BY BREAKING, INDEPENDENTLY: planted a hand-rolled absorb named `soakItUp` — a name '
      + 'appearing nowhere in the population — in 10-water-metal.test.ts, a file the agent never '
      + 'touched. §2 reddened naming the file, BOTH push lines, and the remediation. Removed it '
      + 'with a targeted edit (never a file restore, per the shared-tree rule); byte-identical to '
      + 'pre-plant and 15/15 green. ⚠ ORCHESTRATOR ERROR CORRECTED: this agent was dispatched with '
      + 'no reserved R-number and took R229, which was A5\'s. `184-ruling-register` named the '
      + 'collision. Renumbered to R231.',
    status: 'done',
  },
  {
    id: 89,
    area: 'engine',
    severity: 'minor',
    title:
      'Two cards throw a TypeError when they resolve with no legal target, instead of fizzling ',
    detail:
      'On 65-effect-conformance\'s new `barren` board — opponents present, nothing for them to give '
      + '— `Luminous Arc` and `Dreadwave Devourer` do not fizzle, they THROW: "Cannot use \'in\''
      + 'operator to search for \'player\' in undefined" and "... for \'stack\' in undefined". Both'
      + 'dereference `ctx.targets[0]!` unconditionally, and the non-null assertion is exactly the lie'
      + 'it looks like. R86 fizzles a spell whose target has gone away, so in a real game the throw'
      + 'is unreachable — but "unreachable today" is not "cannot fire", and the same shape on a card'
      + 'R86 does not cover would be a crash in a live game rather than a caught test error.',
    evidence:
      'Surfaced by the `barren` board R209 added for CT-74; 65 now prints both cards by name on '
      + 'every run rather than folding them into a count. Reported and deliberately not fixed by that'
      + 'agent, correctly — the fix is engine-side and `engine.ts` was another agent\'s territory that'
      + 'round.',
    fix:
      'Decide the general rule first, then apply it to the class rather than to these two: should '
      + 'an effect that reaches resolution with an empty `ctx.targets` fizzle quietly, announce, or'
      + 'be impossible by construction? Then sweep every `ctx.targets[0]!` in the pool — the'
      + 'assertion is the smell, and there will be more than two. ⚠ Per docs/13 §7.2 the guard\'s card'
      + 'list must be COMPUTED from that sweep, not typed from this ticket.',
    proof: null,
    verify:
      'A spell resolving with no target behaves the same way on every card in the pool, and a new '
      + '`ctx.targets[0]!` fails a sweep.',
    guards: [
      '196-empty-target-fizzle.test.ts::R227 Burning Vengeance: the site the drive CANNOT reach',
      '65-effect-conformance.test.ts::R227: no card reads a declared target without the shared fizzle helper',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R223/R227, and THE CLASS WAS EIGHT TIMES THE TICKET. The '
      + 'ruling first — the owner, asked what a spell should do when it resolves with nothing to '
      + 'target: "FIZZLE, AND SAY SO IN THE LOG." Not silently; the player must learn why nothing '
      + 'happened. One helper, `firstTarget(g, ctx, i)` in cards/dsl.ts, returns the target or logs '
      + '"<card>: it has no legal target — nothing happens." No engine.ts change was needed. THE '
      + 'MEASUREMENT: a `starve` mode was added to 65-effect-conformance\'s own `driveOne`, so every '
      + 'EffectDef declaring a targets spec is re-driven on all three boards through THE SAME '
      + 'EffectCtx the fair pass builds, with ctx.targets forced empty. 42 throws = 14 effect slots '
      + 'on 12 cards, reproducing the audit digit for digit. 11 of the 14 come through ONE factory '
      + '(registry.ts::dealToAnyTarget), and both multi-route cards are confirmed as ONE SHARED '
      + 'EffectDef REACHED TWICE — Sacrificial Burst (spell + graft), Rune Channeler (ability#0 + '
      + 'graft). A name-keyed guard really would have got those wrong. ⚠⚠ AND THE SWEEP ALONE WAS '
      + 'NOT THE CLASS, WHICH IS THE FINDING WORTH KEEPING. A DRIVE ONLY PROVES THINGS ABOUT LINES '
      + 'IT REACHES. `Burning Vengeance` holds an unguarded ctx.targets[0]! behind `if (deaths <= '
      + '0) return`, and no board the rig builds has a battle death — so the drive walks straight '
      + 'past it. Separately, Jelly and Leaping Lillik (2 routes) read a target they were never '
      + 'given and DO NOT THROW, because `isEnt` is null-safe: they fizzled SILENTLY, which R223 '
      + 'rules out exactly as explicitly as the crash. FINAL SCOPE: 17 slots, 15 cards, 13 call '
      + 'sites. SO THERE ARE TWO GUARDS, NOT ONE, and the second exists because of the first\'s '
      + 'blind spot: the starve sweep (194 slots × 3 boards, subject list computed from the '
      + 'registry every run) AND a SOURCE-LEVEL scan banning the `ctx.targets[i]!` idiom in '
      + 'src/cards/**. POSITIVE CONTROLS FOR BOTH, through the same entry point as the real pass — '
      + 'and note the second half of each, which is the part usually missing: the drive is shown a '
      + 'deliberately unguarded site and must convict on EVERY board, AND is shown the '
      + 'correctly-guarded twin and must LET IT WALK, because a sweep that convicts everything '
      + 'measures nothing. A third control asserts the guarded twin SPEAKS, since every "does not '
      + 'throw" assertion is satisfiable by `run: () => {}`. The source scan is shown 3 shapes it '
      + 'must convict and 4 it must not. ⚠ TWO OF THE AGENT\'S OWN TESTS WERE VACUOUS WHEN FIRST '
      + 'WRITTEN AND THE BREAK-TEST IS WHAT EXPOSED THEM: the Jelly regression read a nonexistent '
      + '`Entity.temp`, and a ResolvedTarget-shape test asserted only object literals. Both '
      + 'rewritten to assert real behaviour. That is the clearest argument in this round for why '
      + 'break-testing is not ceremony. ⚠ DELIBERATELY NOT CONVICTED, recorded so it is not '
      + 'rediscovered as a defect: the starve pass also finds ~100 slots that complete SILENTLY '
      + 'when starved. Those are the R86 path, where the ENGINE fizzles and logs before `run` is '
      + 'entered, so the player is already told. ⚠ TERRITORY NOTE: `src/cards/registry.ts` was in '
      + 'neither the agent\'s allowed nor its forbidden list and holds 7 of the 12 convicted cards, '
      + 'including the whole 11-slot dealToAnyTarget family. It edited it and said so. That was the '
      + 'right call and the omission was the orchestrator\'s. ORCHESTRATOR VERIFIED BY BREAKING, '
      + 'targeting the agent\'s most interesting claim: reverting Burning Vengeance to the raw idiom '
      + 'reddens its named regression AND the source scan, while the DRIVE STAYS GREEN — the blind '
      + 'spot is real, and the source scan is what covers it. Restored byte-identical, 38/38 green.',
    status: 'done',
  },
  {
    id: 90,
    area: 'engine',
    severity: 'minor',
    title:
      'The haste step can open with nothing playable, or be skipped while a playable card sits in '
      + 'hand',
    detail:
      'engine.ts:10599-10607 declares its own divergence in a comment: `canHaste` and `castable()` '
      + 'do not agree, so the haste step is offered on a condition that is not "you can actually do'
      + 'something here". Both failure directions are live — the step opens on an empty'
      + 'hand-of-options, and it is skipped while a card the player could legally haste sits in their'
      + 'hand. The second is the one a player would report as a bug, because a window they were'
      + 'entitled to never appeared.',
    evidence:
      'Found by the R206 agent while checking the {Haste} glossary row against the engine — the row '
      + 'named ONE of the five conditions `canHaste` actually tests, which is what led to reading the'
      + 'function. Reported, not fixed: the row was the ticket, the engine was not, and rewording a'
      + 'glossary row is not the place to change behaviour.',
    fix:
      'Work out which of the two is authoritative — most likely `castable()`, since the step exists '
      + 'to let somebody cast — and make `canHaste` ask it rather than approximating it. ⚠ This'
      + 'changes when a priority window opens, so it is a rules-visible change and wants a ruling,'
      + 'not just a patch. Check it against R97\'s battle-timing refusals: a {Battle} card prophesied'
      + 'with a [Haste] banner would bypass both, which is unreachable today only because no such'
      + 'card exists.',
    proof: null,
    verify:
      'The haste step opens exactly when the player has something they can legally do in it, '
      + 'demonstrated in both directions.',
    guards: [
      '200-haste-step-is-unconditional.test.ts::R228 §1: seat 1 is served the same view whatever seat 0 is holding',
      '200-haste-step-is-unconditional.test.ts::R228 §1 control: the same comparison DOES fire on a difference seat 1 may see',
      '200-haste-step-is-unconditional.test.ts::R228 §3: at donePlanning → haste, the step does not depend on hand contents',
      '200-haste-step-is-unconditional.test.ts::R228 §5: no seat is auto-done, and BOTH have to close the step',
      '200-haste-step-is-unconditional.test.ts::R228 §5: the step still ENDS properly — endOfHaste fires exactly once',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R228, and BOTH OF THIS TICKET\'S CLAIMS WERE WRONG. The '
      + 'owner ruled ALWAYS OFFER THE STEP (R224). `canHaste` is DELETED — nothing replaces it '
      + 'anywhere — and `apply.ts` calls `startHasteStep()` unconditionally, which removes the last '
      + 'hand-maintained duplicate of a shared predicate. That is the shape report #74 cost us '
      + 'once, after which R95 and R97 each became THE ONE PREDICATE. ⚠ CLAIM 1 WAS FALSE: "both '
      + 'failure directions are live". The over-permissive direction ("the step opens on an empty '
      + 'hand-of-options") has a population of ZERO across all 495 cards — every candidate under '
      + 'all four over-permissive mechanisms is {Battle}, and both grantors return early on battle '
      + 'timing; the 21 printed {Haste} cards carry no targets and no castCost at all, so both '
      + 'predicates are vacuously true on every one. The under-permissive direction is ONE CARD: '
      + 'Eldritch Reclaimer (the pool\'s only grant-eligible min-0 target spec) under Dispatch '
      + 'Courier (the pool\'s only R97 grantor), with an EMPTY BIN. ⚠ CLAIM 2 WAS FALSE TOO — this '
      + 'ticket\'s warning that "a {Battle} card prophesied with a [Haste] banner would bypass both, '
      + 'which is unreachable today only because no such card exists". IT EXISTS. Of the 7 printed '
      + 'banners exactly one carries a [Haste] release marker and it is a {Battle} card: Divine '
      + 'Intervention. It is not a bypass — R42\'s printed per-card banner is a deliberate override, '
      + 'unlike R97/R123\'s generic grants — and its release can never legally happen anyway, '
      + 'because its stackEffect target cannot exist in a stackless haste step. ⚠⚠ AND THE '
      + 'INFORMATION FRAMING WAS BACKWARDS IN BOTH THE TICKET AND THE BRIEF. The worry was that '
      + 'fixing this would MAKE the step a side channel. It already was one, at full strength: '
      + 'view.ts serves `hasteDone` live and public BY DESIGN, and the client paints it `ready ✓` '
      + 'versus `…` — seat D is served hasteDone=[false,true] while seat A\'s hand reads __HIDDEN__. '
      + 'Always-open REMOVES a channel the client invented as an optimisation; a physical table has '
      + 'no hasteDone array. The repo already held the argument against itself: startBattlePhase '
      + 'fires endOfHaste even on the skipped path because "an optimisation must not be '
      + 'observable". ⚠ THE CHANGE REACHED FURTHER THAN THE TICKET. Five SERVER tests broke — all '
      + 'five throwing "only haste cards during the haste step", none of them about haste; they had '
      + 'simply sailed past a step that used to be skipped. Fixed by teaching them to pass through '
      + 'it, NOT by making the step conditional again. And a DIFFERENT agent found that `?demo=1` '
      + 'had gone dead — the home screen\'s Practice button led to a blank page, because '
      + 'demoBattle\'s `h.state.battle!.attacker` threw once donePlanning stopped landing in the '
      + 'battle phase. Nothing in the suite covers demoBattle. That is the real lesson here: a '
      + 'rules-visible change reaches further than its ticket, and neither the ticket nor the brief '
      + 'anticipated either consequence. ORCHESTRATOR VERIFIED BY BREAKING, in a scratch copy '
      + 'outside the repo: reinstating the old skip reddens EIGHT of the eleven guards, including '
      + '§1 (the seat-aware view comparison — the actual leak assertion) and BOTH of its controls. '
      + 'Independently confirmed the step is genuinely unconditional by reading it: no seat is '
      + 'pre-marked done, with the reason stated in the code — "done is a thing a PLAYER says, and '
      + 'a step that says it for them is a broadcast". Server suite 21/21.',
    status: 'done',
  },
  {
    id: 91,
    area: 'card',
    severity: 'major',
    cards: ['Torrential Reclamation'],
    title:
      'Torrential Reclamation scales the sacrifice as well as the life loss, and no-ops entirely at '
      + 'X=0',
    detail:
      'Prints "Recall X target nontoken allies. Then each player sacrifices a unit and you lose 1 '
      + 'life for each ally recalled this way." Two defects found by the R212 correctness sample. (a)'
      + 'AMOUNT: with X=2 each player sacrifices TWO units, not one — batch-hybrids-fwe.ts wraps the'
      + 'seat loop in `for (let r = 0; r < recalled.length; r++)`. The trailing "for each ally'
      + 'recalled this way" should bind to the life loss it is attached to; no other card in the pool'
      + 'writes a scaled sacrifice that way, and Structural Collapse and No Hand Killer both put the'
      + 'scaling inline. (b) TIMING: at X=0 the whole spell returns early, so the second sentence'
      + 'never happens at all — it is not gated on the first in the printed text.',
    evidence:
      'The only two failures in R212\'s 30-card correctness sample: 125 of 127 clauses correct, and '
      + 'both misses are this one sentence. Pinned in `182-correctness-sample.test.ts`\'s KNOWN_WRONG'
      + 'by exact membership, so the suite reddens the moment either is fixed. The card\'s own comment'
      + 'says the distribution is deliberate, which is why this is a ruling question and not an'
      + 'obvious bug.',
    fix:
      '⚠ ASK BEFORE CHANGING (a). It is Q1 of the round-28 owner questions: does "for each ally '
      + 'recalled this way" scale the sacrifice too, or only the life loss? (b) is answerable without'
      + 'a ruling — the early return at X=0 skips a sentence the card prints unconditionally — but do'
      + 'both in one change once the ruling lands, and remove the KNOWN_WRONG rows rather than'
      + 'editing them.',
    proof: null,
    verify:
      'Both clauses do what the card prints, the KNOWN_WRONG rows are deleted, and 182 goes green '
      + 'with 127/127.',
    guards: [
      '182-correctness-sample.test.ts::with X = 0 the sacrifice STILL happens, and costs no life',
      '182-correctness-sample.test.ts::"each player sacrifices a unit" happens ONCE PER RECALLED ALLY',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) BY A RULING, AND IT SPLIT THE TICKET IN HALF. The owner was '
      + 'asked both questions directly and the two clauses went OPPOSITE WAYS. (a) AMOUNT — NOT A '
      + 'BUG, AND NEVER WAS. He ruled that "for each ally recalled this way" distributes over the '
      + 'sacrifice as well as the life loss, so with X=2 each player really does sacrifice two. '
      + 'Today\'s behaviour is correct and the `for (r)` loop is deliberate. THE TICKET WAS WRONG, '
      + 'and so was the correctness sample that filed it: 182 carried a `wrong()` row for two days '
      + 'against a card that was right. He was offered the reading this ticket argued for — the one '
      + 'where the rest of the pool writes scaling inline — and did not take it. (b) TIMING — REAL, '
      + 'AND FIXED. He was separately offered "both scale, and therefore X=0 does nothing", which '
      + 'would have closed this entry outright, and DID NOT TAKE THAT EITHER. So the sacrifice '
      + 'clause is UNCONDITIONAL with the scaling on top, not gated on the recall: `Math.max(1, '
      + 'recalled.length)` rounds in batch-hybrids-fwe.ts, and the early `if (x <= 0) return` is '
      + 'gone. The life loss stays purely scaled, so X=0 costs every player a unit and costs the '
      + 'caster nothing — and that asymmetry is what 182 now asserts, because it is the only thing '
      + 'separating the two halves of the sentence. ⚠ WHAT THIS DID TO THE HEADLINE NUMBER, said '
      + 'out loud because it is the interesting part. 182 now prints 127/127, 100%. THAT IS NOT A '
      + '100% CORRECTNESS RESULT and the file says so in its own header and in the comment over the '
      + 'now-empty KNOWN_WRONG: one of the two points came from fixing the game, the other from '
      + 'correcting the test. Of the sample\'s two findings, ONE was a real defect and ONE was the '
      + 'instrument misreading a card. A 50% false-positive rate on a two-item sample is the number '
      + 'worth carrying out of this round — docs/13 §5 is about exactly this, and a clean 127/127 '
      + 'quoted without that sentence would be the same flattering blindness. '
      + '⚠⚠ THE REAL FINDING, AND IT IS ABOUT RULINGS RATHER THAN CARDS: THIS WAS ALREADY RULED '
      + 'ON. R157 §17 (2026-08-25) reads "the card checks how many units you recalled and forces '
      + 'each player to sacrifice that many units and you lose that much life", marked *Already '
      + 'correct*. Four days later THIS TICKET filed it as a MAJOR OPEN BUG, 182 recorded the '
      + 'engine as WRONG on it, and docs/questions-round28.md Q1 RE-ASKED THE SETTLED QUESTION '
      + 'WHILE RECOMMENDING THE OPPOSITE ANSWER. Had the owner taken that recommendation he would '
      + 'have reversed his own ruling of four days earlier and NOTHING IN THE REPOSITORY WOULD '
      + 'HAVE OBJECTED. Found by the round-29 Downloads reconciliation, from OUTSIDE the suite — '
      + 'exactly like every finding in docs/13 §5. THE GAP IS STRUCTURAL: 184-ruling-register '
      + 'checks that a cited R-number EXISTS and R215 checked that a used ruling is REGISTERED, '
      + 'but NOTHING checks that an open ticket or a pending question is not re-litigating a '
      + 'CLOSED ruling. That guard is worth more than the card fix that produced it — CT-101. '
      + '⚠ WHERE R157 §17 AND R221 PULL APART, recorded rather than smoothed over: read literally, '
      + '"sacrifice THAT MANY units" gives ZERO at X=0, which is the early return this change '
      + 'deleted. But §17 was answering "does the for-each distribute?" and was never asked about '
      + 'X=0; R221 was asked exactly that, was SHOWN the "X=0 therefore does nothing" option, and '
      + 'declined it. Later and more specific governs, so the floor stands — but that is the seam '
      + 'if it is ever revisited. ORCHESTRATOR VERIFIED '
      + 'BY BREAKING: `Math.max(1, recalled.length)` reverted to `recalled.length` reddens 182\'s '
      + 'X=0 test BY NAME ("the sacrifice is not gated on the recall — 2 → 1"); restored, the file '
      + 'is byte-identical and 57/57 green.',
    status: 'done',
  },
  {
    id: 92,
    area: 'coverage',
    severity: 'minor',
    title:
      'The drill keeps one activation window in a single slot, so a second activation silently '
      + 'drops it',
    detail:
      '`pendingAct` in `test/drill.ts` is a single slot, and the branch that takes an activation '
      + 'does not require an empty stack. So a second activation offered while the first is still'
      + 'unresolved OVERWRITES the open evidence window, and everything the first activation'
      + 'delivered is dropped without a trace. This is the mirror of CT-87: that one CREDITED'
      + 'evidence that was not the card\'s, this one DISCARDS evidence that is. Both make the drill'
      + 'lie about what a card did.',
    evidence:
      'Found and measured by the R211 agent while fixing CT-87, in the same instrumented run: ZERO '
      + 'occurrences across 491 cards and 1296 drill runs. ⚠ Note WHICH direction it errs in — it'
      + 'makes a card read as delivering LESS than it did, so unlike round 26\'s four blindnesses it'
      + 'would never have surfaced as a flattering number. That is exactly why nobody would have'
      + 'caught it: it produces a plausible "never observed", which is a state the suite already'
      + 'expects to see.',
    fix:
      'Make `pendingAct` a stack rather than a slot, or refuse to take a second activation while '
      + 'one is open and record that refusal the way CT-87\'s `actInconclusive` records the other one.'
      + 'Then re-run the whole-pool measurement to confirm it is still zero, and keep the counter — a'
      + 'dormant defect with a live counter is cheap; a dormant defect with nothing watching it is'
      + 'how this class returns.',
    proof: null,
    verify:
      'A second activation opened while one is pending either nests correctly or is recorded as '
      + 'refused, and the whole-pool count of both is printed.',
    guards: [
      '181-inconclusive-activation-window.test.ts::CT-92 POSITIVE CONTROL: the refusal counter fires when a window really is left open',
      '181-inconclusive-activation-window.test.ts::CT-92: the control hatch cannot leak into a scoring path',
      '81-card-drill.test.ts::CT-92: no run silently DROPPED an activation window by overwriting it',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R232. The drill now REFUSES a second activation offered '
      + 'while one is unresolved, and counts the refusal, instead of overwriting the open evidence '
      + 'window and dropping everything the first activation delivered. MEASURED POOL-WIDE AFTER '
      + 'THE FIX: 0 refusals across 491 cards and 1473 runs, printed by 81-card-drill on every run. '
      + 'The ticket\'s zero reproduces. ⚠ The ticket\'s DENOMINATOR did not — it says 1296 runs and '
      + 'an audit said 1729; the drill\'s own aggregate is 491 × 3 = 1473. Three different numbers '
      + 'for the same quantity, which is its own small lesson about quoting a count you did not '
      + 'just compute. ⚠ THE COUNTER STAYS AT ZERO ON PURPOSE, and the ticket was right to insist: '
      + 'a dormant defect with a live counter is cheap, a dormant defect with nothing watching it '
      + 'is how the class returns. ⚠⚠ AND A COUNTER THAT HAS ONLY EVER PRINTED 0 IS '
      + 'INDISTINGUISHABLE FROM A COUNTER THAT IS BLIND — docs/13 §5 is a catalogue of exactly '
      + 'an opt-in control hatch pins the window open, and the same Slag Spewer run '
      + 'pins the window open, and the same Slag Spewer run that normally takes 4 activations with '
      + '0 refusals then takes 1 and refuses 45. The control also asserts the held run takes FEWER '
      + 'activations than the normal one, so it is proving the refusal really costs evidence rather '
      + 'than just incrementing. The hatch is guarded the way R211 guarded its sibling — 181 counts '
      + 'the FILES naming it and requires exactly two, because prose in a comment is how such a '
      + 'hatch gets quietly re-adopted. THE GENERALISATION WORTH KEEPING, which the ticket spotted '
      + 'and is right about: this defect biases the metric DOWNWARD. Round 26\'s four blindnesses '
      + 'were all found because a number went UP — the flattering direction, which invites '
      + 'suspicion. This one produces a plausible "never observed", a state the suite already '
      + 'expects and therefore never questions. A defect that makes results look WORSE is harder to '
      + 'find here than one that makes them look better, because the review reflex — correctly — is '
      + 'to distrust good news. ORCHESTRATOR VERIFIED BY BREAKING: neutering the refusal branch '
      + 'name; restored byte-identical, 6/6 green. '
      + '⚠⚠ AND THE FILE-COUNT GUARD THEN CAUGHT THIS VERY CLOSURE NOTE, which named the hatch '
      + 'verbatim — the IDENTICAL trap CT-87\'s closure note records falling into, on a different '
      + 'flag, from the same position: the person writing up the guard is the next one to trip '
      + 'it. That is twice now, so it is a pattern rather than an accident, and it is worth '
      + 'stating as a rule: **a closure note must describe a control hatch, never spell it.** The '
      + 'guard counts FILES precisely because prose is how such a hatch gets re-adopted, and '
      + 'prose in card-todo.ts is still prose. CT-99 hit the same shape in the same hour from the '
      + 'other direction — its note wrote out a fake backlog id that its own new guard then read '
      + 'as a real citation. Both fixed by rewording, not by weakening the guards.',
    status: 'done',
  },
  {
    id: 93,
    area: 'coverage',
    severity: 'minor',
    title:
      'The card-ledger guard tally dropped seven guards with no explanation, and the floor does not '
      + 'care',
    detail:
      '71-card-ledger.test.ts carries an R155 tally comment reading 49/6/99, and the file now '
      + 'reports 50/6/92. The first two numbers moved for understandable reasons; the third means'
      + 'SEVEN GUARDS ARE GONE and nothing in the repository says which, when, or why. The floor'
      + 'assertion below it is a lower bound that 92 still clears, so the suite is content. A guard'
      + 'count that falls silently is the same shape as the exemption lists CT-83 was about: a claim'
      + 'about the code that nothing re-checks.',
    evidence:
      'Found by the R210 agent while giving the file\'s exemption lists their staleness assertions. '
      + 'It fixed the lists it was sent for and reported this rather than quietly updating the'
      + 'comment to match, which is the right call — rewriting the number to 92 would destroy the'
      + 'only evidence that seven went missing.',
    fix:
      'Find the seven: `git log -p` on the file against the R155 commit will name them. Then decide '
      + 'per guard whether it was deliberately retired (say so, with the ruling) or lost in a'
      + 'refactor (restore it). ⚠ Then make the tally a real assertion rather than a comment — an'
      + 'exact expected count, or a floor that is raised when guards are added — because a lower'
      + 'bound nothing raises is a number that can only ever drift downwards.',
    proof: null,
    verify:
      'The seven are each accounted for, and the guard count is asserted rather than described. ',
    guards: [
      '71-card-ledger.test.ts::the static/cost/flag sweep reports its population, and none of it is provably inert',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29). THE SEVEN WERE ALL FOUND, AND NOT ONE WAS LOST — but the '
      + 'ticket was wrong about what the number even counts, and that is the part worth keeping. ⚠ '
      + '`guards` IN THAT TALLY IS NOT TEST GUARDS. 71-card-ledger.test.ts:831 counts `when()` '
      + 'PREDICATES ON TRIGGERED ABILITIES IN THE CARD POOL. So this ticket\'s entire prescribed fix '
      + '— "`git log -p` on the file against the R155 commit will name them" — COULD NEVER HAVE '
      + 'WORKED: the seven are not in that file\'s history at all, they are in the card files. The '
      + 'ticket pointed its instrument at the wrong artifact, which is the identical mistake '
      + 'reports #15, #104 and #106 each made, and it is the third time a ticket in this repo has '
      + 'prescribed a fix nobody had tried. HOW THEY WERE ACTUALLY FOUND: run the same tally in a '
      + 'git worktree at the R155 commit (8b92357) and again at HEAD, and diff PER CARD. Both '
      + 'headline numbers reproduce exactly (49/6/99 → 50/6/92) and the per-card diff nets exactly '
      + '−7. All seven are DELIBERATE conversions, each documented at length in its own card file: '
      + 'Aetherflux Golem (R168, triggered → static), Arbiter of Vitality ×2 (R162 and R157 §23, → '
      + 'AmountMultiplier), Stellarspore Harvester ×2 (R161 and R157 §15), Powerforge Synergist '
      + '(R165, → spawnsWithCounters), Maelstrom Charger (R178 via the RAQ, → asYouPlay). ⚠ AND THE '
      + 'TICKET WAVED THROUGH ITS OWN ANSWER: it dismissed the "+1 static" as moving "for '
      + 'understandable reasons". That +1 IS the Aetherflux Golem row — the same single edit. The '
      + 'guard did not vanish, it MOVED, and the ticket had already seen it move and looked away. '
      + 'WHAT SHIPPED is the one sentence of the fix that survived: the tally is an ASSERTION now, '
      + 'not a comment over a floor. `assert.deepEqual({statics,costMods,guards}, {50,6,92})`, with '
      + 'the seven listed in a table above it and a message that refuses to let you update the '
      + 'numbers without naming the card and the ruling. The old `>= 45 && >= 5 && >= 90` was a '
      + 'lower bound nobody ever raised, which is a number that can only drift downwards — exactly '
      + 'how these seven went missing in silence. ORCHESTRATOR VERIFIED BY BREAKING: pinning guards '
      + 'at 93 against the real 92 reddens test 8 by name; restored, 9/9 green.',
    status: 'done',
  },
  // ── round 29 (2026-08-28): the nine reports the repo had never seen, plus
  // two structural gaps this round walked into. CT-101 is the one that
  // matters: a settled ruling was re-asked with a recommendation to REVERSE
  // it, and nothing anywhere would have objected.
  {
    id: 94,
    area: 'client',
    severity: 'major',
    reportId: 107,
    title:
      'A formation placement question the battlefield cannot answer',
    detail:
      'Report #107: "Spawning something in formation does now work, but I should be able to click '
      + 'WHERE rather than using a button in the top bar." ⚠ NOTE THE FIRST FOUR WORDS — the RULES '
      + 'half of BL-24 is fixed and he says so. This is the affordance only, and routing it to the '
      + 'engine would be the #15/#104/#106 mistake again. TWO CAUSES, AND BOTH ARE NEEDED. (a) '
      + 'ui/main.ts:1023 gates the only board-click-to-decide route to dec.kind === \'targets\', so a '
      + 'formationSlot question can never be answered by clicking the board. (b) engine.ts:5352 '
      + 'sends a BARE SLOT INDEX, so the client holds the label prose and nothing else and CANNOT '
      + 'draw a drop target even in principle. The R29 sibling (engine.ts:6234) already sends a '
      + 'real FormationSpot and at least pings, so the correct shape exists in the engine already '
      + 'and this family simply does not use it.',
    evidence:
      'SBCM replayed to action [64]: kind=formationSlot, "Hooba-Bot: where does Robot join the '
      + 'formation?", options labelled "a new column on the left"/value 0 and value 1. That exact '
      + 'state driven through engine/test/ui-driver.ts yields 2 decide-buttons, 0 pings, 0 '
      + '.candidate elements, 0 click targets — the battlefield is completely inert, measured '
      + 'rather than described.',
    fix:
      'Add a DISPLAY-ONLY spot? to DecisionOption and populate it at every formationSlot site, '
      + 'then draw the spots as data-act="fslot" targets modelled on the existing '
      + 'slotHtml/data-act="slot". ⚠ THE ANSWER NAMESPACE MUST STAY THE INTEGER INDEX — saved games '
      + 'are keyed on it, and re-keying breaks 143-replay-divergence and the R200 forensic stack '
      + 'for exactly the games we most want to re-examine. Site list to be COMPUTED from the '
      + 'kind:\'formationSlot\' call sites (docs/13 §7.2), not typed.',
    proof: null,
    verify:
      'A formation placement question is answered by clicking the board, the top-bar button still '
      + 'works, and a saved game replays byte-identically with the spot payload present.',
    progress:
      '2026-08-28 (round 29): THE ENGINE HALF IS DONE, THE CLIENT HALF IS NOT. '
      + '`DecisionOption.spot?` exists and is populated, so the client now HAS the geometry it '
      + 'lacked; drawing the drop targets is what remains. ⚠ THERE ARE THREE ASK SITES, NOT SEVEN — '
      + 'the seven above is a CARD list, not a site list, and conflating the two is how a fix gets '
      + 'scoped to the wrong thing. The three: engine.ts::placeInFormation (R75 → Lin/Bot/God/Pon '
      + 'out of battle), engine.ts::collectFormationSpot (R29 → Tiderunner, Trench Stalker), '
      + 'batch-water-a.ts::pushInlinePlay (R198 → Pon in battle). All three emit `spot`, and a scan '
      + 'pins that there are exactly three so a fourth cannot appear unnoticed. THE ANSWER '
      + 'NAMESPACE IS UNCHANGED AND THAT IS ASSERTED, NOT ASSUMED: R75 options still carry the bare '
      + 'integer index in `value`, and `referenceKey` (server/rooms.ts:487) keys `decide` on kind + '
      + 'option count + chosen label — none of which moved. server/view.ts passes the decision '
      + 'through wholesale, so no server change is needed for the client to receive `spot`. ⚠ '
      + 'PARKED, AND IT IS A REAL RESIDUE RATHER THAN A TIDY-UP: `pushInlinePlay`\'s R198 spot menu '
      + 'is still built from `formationSlots(seat)`, and `resolveItem` consumes it via '
      + '`spawnUnit(item.controller, …)`. Making the OFFER source-based without moving the '
      + 'RESOLUTION would guarantee a no-match, so it was correctly left alone. Under mid-battle '
      + 'control theft Hooba-Pon\'s new R225 guard passes but the grid it offers is its '
      + 'CONTROLLER\'s, not its own. That needs an R29-side decision about where the resolution '
      + 'reads from, not another placement patch.',
    guards: [
      '215-formation-click.test.ts::§1a the ATTACKING grid: every offered spot points at the column the engine named',
      '215-formation-click.test.ts::§1b the BLOCKING grid is COMPACTED, and the anchor un-compacts it',
      '215-formation-click.test.ts::§2 gridSeatOf reads the grid off the OFFER',
      '215-formation-click.test.ts::§3a the battlefield is no longer inert',
      '215-formation-click.test.ts::§3b clicking a spot on the line sends the decision, keyed by OPTION INDEX',
      '215-formation-click.test.ts::§3c the click really places the unit where the spot said it would',
      '215-formation-click.test.ts::§3d the BLOCKING question draws on the blocking half, at the right column',
      '215-formation-click.test.ts::§4c an offer where NOTHING resolves draws nothing rather than an empty invitation',
    ],
    closed:
      '✔ FIXED 2026-08-29 (round 30) — THE CLIENT HALF, which is all that was left. `ui/fslot.ts` '
      + 'turns each option\'s display-only `spot` into a place on the committed battle panel and '
      + '`battleHtml` draws it as a `data-act="fslot"` target: in the column for a `behind` or a '
      + '`hole`, as a new bracketing column for an `end`, and beside the line for the printed '
      + '"you MAY". '
      + '⚠ THE ANSWER NAMESPACE IS UNTOUCHED and that is asserted rather than claimed: the click '
      + 'sends the option\'s INTEGER INDEX, i.e. byte-for-byte the `decide` the bar\'s button has '
      + 'always sent (§3b), so `referenceKey` and the R200 forensic stack never see this file. '
      + '⚠ TWO THINGS THE TICKET DID NOT SAY, both of which a reader gets wrong. (1) THE PANEL '
      + 'INDEXES BY ATTACK COLUMN FOR BOTH SEATS, and the engine\'s defender grid is '
      + '`Object.keys(b.blocks)` in key order — COMPACTED. A `hole` naming grid index 0 is drawn at '
      + 'attack column 1 when column 0 is unblocked. `attackColumnOf` is that translation, and §1b '
      + 'is a fixture built to catch it: three attackers, TWO blocked, so the identity map fails. '
      + 'A fixture that blocked everything would have gone green with the function deleted. '
      + '(2) THE ENGINE SENDS THE SPOTS BUT NOT WHOSE GRID THEY ARE IN, and under R225 '
      + '`Decision.seat` is the wrong answer. It is derived from the offer instead — an `end` spot '
      + 'exists if and only if the grid is the attacker\'s, because only an attacking line can '
      + 'widen (R72) — and §2b pins that the derivation really reads the OPTIONS and not the seat. '
      + 'VERIFIED BY BREAKING, THREE WAYS: the identity map reddens §1b; a dead `fslot` click '
      + 'reddens §3b/§3c; and reconstructing the pre-#107 inert battlefield reddens §3a–§3d — the '
      + 'historical defect measured in `evidence`, not a synthetic one.',
    status: 'done',
  },
  {
    id: 95,
    area: 'client',
    severity: 'minor',
    reportId: 108,
    cards: ['Borrower of Forms', 'Apex Prime'],
    title:
      'A copy borrows the name but not the face',
    detail:
      'Report #108: "Borrower of Forms should also copy/borrow the card ART of the thing its '
      + 'copying. Just the little note at the bottom (and the green power/defense) is great to mark '
      + 'it as a copy." ⚠ THE SECOND SENTENCE IS A CONSTRAINT, not politeness: the existing copy '
      + 'markings are GOOD and must survive. He wants the art to follow the name, not the copy to '
      + 'become indistinguishable from the original.',
    evidence:
      'ui/main.ts:1527 feeds u.card to art(). R118 deliberately never rewrites Entity.card; the '
      + 'projected face lives in E.nameOf, which cardtext.ts:485 already uses — which is exactly '
      + 'why the NAME updates and the ART does not. ui/inspect.ts:1042 already documents the '
      + 'intended behaviour, so only the render disagrees. ⚠ 117-copy-everything.test.ts is '
      + 'R127/Ancient One only: no Borrower, no Apex Prime, nothing about rendering. ITS GREEN IS '
      + 'NOT EVIDENCE HERE.',
    fix:
      'Render from the projected face. The class was computed two ways (printed text AND '
      + 'copy-primitive call sites, which agreed): Borrower of Forms and Apex Prime, the latter '
      + 'hitting N units at once so it proves the fix generalises. ⚠ ANCIENT ONE MUST NOT CHANGE — '
      + 'its projects omits the name facet, so it is a copy that deliberately keeps its own face, '
      + 'and it is the false-positive guard for this fix. Token and spell copies already render '
      + 'correctly.',
    proof: null,
    verify:
      'Borrower of Forms and Apex Prime show the copied art, still carry the copy note and the '
      + 'green stats, and Ancient One is untouched.',
    guards: [
      '198-copy-art.test.ts::R229 §1: a Borrower of Forms is DRAWN as the card it borrowed',
      '198-copy-art.test.ts::R229 §2: Apex Prime redraws EVERY unit it copied onto, in one resolution',
      '198-copy-art.test.ts::R229 §3: an Ancient One keeps its OWN art — a projection is not an identity',
      '198-copy-art.test.ts::R229 §3b: a copy is marked even when the borrowed body matches its own',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R229. ONE SEAM: `faceOf(u) = q().nameOf(u)` in '
      + 'ui/main.ts — "which card is this, for anything that SHOWS it" — used by the board art, the '
      + 'focus-rail art, and the right-click context menu. The cause was that main.ts fed '
      + '`Entity.card` to `art()` while R118 deliberately never rewrites `Entity.card`; the '
      + 'projected face lives in `E.nameOf`, which cardtext.ts already used. That is exactly why '
      + 'the NAME updated and the ART did not. THE CLASS, DERIVED TWICE AND AGREEING: the '
      + 'becomeCopy/prepareCopy call sites give Apex Prime and Borrower of Forms; printed text '
      + 'gives 11 cards saying "copy", of which the other 9 make TOKEN, SPELL or TRIGGER copies — '
      + 'new entities whose Entity.card is already right. Ancient One projects WITHOUT the `name` '
      + 'facet, so nameOf never sees it. ⚠ THE OWNER\'S SECOND SENTENCE TURNED OUT TO BE WRONG, and '
      + 'the agent said so rather than obeying it. He wrote that the existing markings are "great '
      + 'to mark it as a copy" — they are not, ONCE THE ART FOLLOWS THE FACE. Borrower prints 2/2 '
      + 'and Sporebloom Siren IS 2/2, so the green base plate does not render and the copy became '
      + 'indistinguishable on the board. Hence a new ⧉ cardboard chip when nameOf(u) !== u.card. '
      + 'One `if`; removable in one line if he objects. ⚠ SCOPE JUDGEMENT, flagged: the right-click '
      + 'inspector now opens on the FACE, because after the art fix it would otherwise name a card '
      + 'that is not on screen. ⚠⚠ ORCHESTRATOR VERIFIED WITH THE PLAUSIBLE-BUT-WRONG FIX, which is '
      + 'the verification that matters here: replacing nameOf with `facesWith(u,\'statics\').at(-1)` '
      + '— the over-broad reading a reasonable person would try — passes §1, §2, §3b and §4 and '
      + 'fails ONLY §3, the Ancient One guard. That guard is the entire difference between a '
      + 'correct fix and an over-applied one, and it earns it by asserting FIRST that the '
      + 'projection is really running and that \'Good Whale\' really is in facesWith, so it proves '
      + 'the over-broad path is LIVE before asserting the art. Restored byte-identical, 10/10 '
      + 'green. ⚠ 117-copy-everything is R127/Ancient One only and covers none of this — its green '
      + 'was never evidence here.',
    status: 'done',
  },
  {
    id: 96,
    area: 'client',
    severity: 'major',
    reportId: 109,
    title:
      'The haste step is a public side channel, and it is skipped when it should not be',
    detail:
      'Report #109 asks for a "Bluff Haste" toggle that stops in your haste step as if you had '
      + 'something to play. It lands on the same seam as the old CT-90. ⚠ THE FRAMING IN BOTH WAS '
      + 'WRONG AND THE MEASUREMENT REVERSED IT: the step does not merely RISK becoming a side '
      + 'channel if CT-90 is fixed — IT ALREADY IS ONE, at full strength. view.ts:103 serves '
      + 'hasteDone live and public by design, and main.ts:2907 paints it as "ready ✓" versus "…". '
      + 'Seat D is served hasteDone=[false,true] while seat A\'s hand reads __HIDDEN__.',
    evidence:
      'R224, the owner, 2026-08-28: ALWAYS OFFER THE STEP. Measured the same day: of CT-90\'s two '
      + 'claimed failure directions, "opens with nothing playable" has a population of ZERO across '
      + 'all 495 cards (every candidate is {Battle}; both grantors return early on battle timing), '
      + 'and "skipped while a playable card sits in hand" is ONE CARD — Eldritch Reclaimer under '
      + 'Dispatch Courier, reproduced with a positive control. ⚠ The repo already holds the '
      + 'argument against itself: startBattlePhase fires endOfHaste even on the skipped path '
      + 'because "an optimisation must not be observable". The optimisation IS observable.',
    fix:
      'Open the step unconditionally, which deletes canHaste\'s hand-maintained duplicate of '
      + 'castable() — the last haste gate keeping its own copy, and the exact shape report #74 cost '
      + 'us once before R95/R97 each became THE ONE PREDICATE. ⚠ An always-open window is a tax on '
      + 'every turn unless passing through it is cheap; that is a requirement of the ruling, not a '
      + 'nicety. Assert the ABSENCE of the side channel seat-aware via logFor/viewFor, not just the '
      + 'presence of the step.',
    proof: null,
    verify:
      'The haste step opens every turn regardless of hand contents, no seat can infer another '
      + 'seat\'s holdings from hasteDone, and passing through it costs one cheap action.',
    guards: [
      '200-haste-step-is-unconditional.test.ts::R228 §5: a bluff is a real move — you may sit in the step holding nothing',
      '200-haste-step-is-unconditional.test.ts::R228 §1: seat 1 is served the same view whatever seat 0 is holding',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R228, TOGETHER WITH CT-90 AND BY THE SAME CHANGE — which '
      + 'is the outcome the owner chose when he was offered them as alternatives. He picked "always '
      + 'offer the step + Bluff Haste" over "make canHaste ask castable()", so the toggle he asked '
      + 'for in report #109 became THE FIX rather than a feature bolted beside one. WHY THAT IS THE '
      + 'RIGHT ANSWER AND NOT JUST THE CHEAPER ONE: an always-open step IS a permanent bluff. There '
      + 'is nothing to toggle, because the step no longer says anything about your hand. The '
      + 'alternative — opening the step exactly when you can act — would have made its PRESENCE the '
      + 'tell, and then a bluff toggle would have been a patch over a channel we had just '
      + 'sharpened. `200-haste-step-is-unconditional` pins it from the bluffing seat\'s side: "a '
      + 'bluff is a real move — you may sit in the step holding nothing", and §1 asserts seat-aware '
      + 'that the opponent\'s view does not vary with what the other seat holds. ⚠ THE MEASUREMENT '
      + 'THAT SETTLED THE DESIGN, and it reversed this entry\'s own premise: the step was ALREADY a '
      + 'public side channel before any of this work. `hasteDone` is served live and public by '
      + 'design and the client paints it `ready ✓`. So there was never a trade-off between "fix the '
      + 'skip" and "keep the bluff" — the leak was there the whole time and closing it was free. '
      + 'ORCHESTRATOR VERIFIED BY BREAKING: reinstating the old conditional skip reddens the '
      + 'seat-view guard and both of its controls, so the bluff property is asserted rather than '
      + 'asserted-about.',
    status: 'done',
  },
  {
    id: 97,
    area: 'client',
    severity: 'major',
    reportId: 110,
    title:
      'The unit tooltip never appears on first hover — the client scrolls itself and cancels its '
      + 'own timer',
    detail:
      'Report #110: "It is weirdly difficult to get the hover to work on units and show their '
      + 'text. I often have to move my mouse several times to get it to show up." ⚠ HE DESCRIBED IT '
      + 'AS FLAKY AND IT IS DETERMINISTIC: on a fresh card the tooltip NEVER appears on first '
      + 'landing, 0 of 4 units. His "move the mouse several times" is a workaround he found, not '
      + 'evidence of randomness — which is why it read as an intermittent annoyance rather than a '
      + 'reproducible bug for as long as it did.',
    evidence:
      'Reproduced in HEADLESS CHROME, not in the driver. ui/main.ts:4936 hides on a window scroll '
      + 'and cannot tell a USER scroll from the client\'s OWN, and scrollFocusToBottom '
      + '(main.ts:4725) scrolls #preview from inside the same mouseover handler that just armed the '
      + '550ms tooltip timer. Measured: mouseover at t, scroll at t+3ms. Confirmed three '
      + 'independent ways — a second move onto a different child of the same card turns it ON, '
      + 'suppressing the preview scroll turns it ON, and leaving and returning turns it ON (that '
      + 'last is literally his workaround).',
    fix:
      'Distinguish the client\'s own scroll from the user\'s. ⚠⚠ AND FIX OR FENCE THE DRIVER: '
      + 'ui-driver.ts:165 no-ops clearTimeout and :60 fires no scroll event on scrollTop '
      + 'assignment, so A DRIVER TEST GOES GREEN ON A CLIENT THAT IS RED IN EVERY BROWSER. That is '
      + 'the second instance of the CT-75 family and it is the reason this bug survived. Verify in '
      + 'a real browser over CDP. ⚠ Serve the ALGOMANCY ROOT, not engine/ui — ART is '
      + '\'../../../data/cards/\', and with art missing the preview never overflows, no scroll '
      + 'fires, and the bug does not reproduce at all.',
    proof: null,
    verify:
      'The tooltip appears on the FIRST landing on a fresh card, in a real browser, and the '
      + 'driver either reproduces the failure or is documented as unable to.',
    guards: [
      '199-hover-scroll.test.ts::R230 §1: the focus rail scrolling does NOT hide the tip — this is #110',
      '199-hover-scroll.test.ts::R230 §5: test/ui-driver.ts really cancels a cleared timeout',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R230, and THE OWNER\'S "weirdly difficult" was more '
      + 'precise than this ticket\'s "never appears". The cause: main.ts\'s window scroll listener '
      + 'hid the tooltip unconditionally, and `scrollFocusToBottom` scrolls #preview from inside '
      + 'the same mouseover handler that just armed the 550ms timer. A new pure '
      + '`scrollHidesHoverTip(scroller, hovered)` in ui/inspect.ts hides only if the scroll could '
      + 'have MOVED the hovered card — document, or an element that contains it. No element-id list '
      + 'anywhere. ⚠ THE TICKET SAID "NEVER APPEARS ON FIRST LANDING, 0 OF 4" AND THAT IS TRUE ONLY '
      + 'AT ONE VIEWPORT. Measured in headless Chrome: 1280x720 → 0/4, 1400x900 → 2/4, 1600x1200 → '
      + '4/4, i.e. it DOES NOT REPRODUCE AT ALL at the largest size. It is GEOMETRIC, firing '
      + 'exactly when the focus rail\'s content overflows the rail. After: 4/4 at every viewport. '
      + 'Two of the original "4 units" were below the fold at 813px and produced no mouseover at '
      + 'all — the earlier measurement was partly vacuous. ⚠ AND THE TICKET\'S REPRO STEP WAS WRONG: '
      + '"a second move onto a different child turns it ON" is not what happens — a nudge within '
      + 'the same card fires no new mouseover, so it stays off. What works is LEAVING AND '
      + 'RETURNING, which is what the owner was actually doing. DRIVER FIDELITY, HALF FIXED: '
      + 'ui-driver.ts\'s clearTimeout is real now (monotonic id + Map, because tick() drains and '
      + 'recycled array indices would cancel the wrong timer). ⚠ THE BRIEF PREDICTED THIS WOULD '
      + 'REDDEN OTHER TESTS AND IT REDDENED NOTHING — 211 tests across 15 driver-driven files still '
      + 'pass, so no test was living on that lie. ⚠ THE SECOND GAP IS DELIBERATELY LEFT OPEN and is '
      + 'now CT-105: firing `scroll` on scrollTop alone would REPLACE ONE LIE WITH TWO, because '
      + '#preview/#hovertip are in the driver\'s ABSENT set, classList.contains returns a flat '
      + 'false, there is no mouseover dispatch, and the listener needs an Element global. '
      + 'ORCHESTRATOR VERIFIED: `scrollHidesHoverTip → return true` reddens §1 and §4; 10/10 green '
      + 'restored, and the real-browser A/B is in the ruling.',
    status: 'done',
  },
  {
    id: 98,
    area: 'card',
    severity: 'blocker',
    reportId: 111,
    cards: ['Hooba-Lin', 'Hooba-Bot', 'Hooba-God', 'Hooba-Pon'],
    title:
      '"In my formation" is read against the SEAT\'s grid, so a dead or unslotted source still '
      + 'places',
    detail:
      'Report #111: "Hooba-Lin should not have made a token here since it does not have a '
      + 'formation." The engine places the token into a column the source was never in — and in the '
      + 'reported game the source was already IN THE BIN and spliced out of the line. '
      + 'E.placeInFormation (engine.ts:5338, esp. :5346) is NEVER TOLD WHICH ENTITY "my" REFERS TO: '
      + 'opts.source is a display STRING, and the slots come from formationSlots(ctx.controller) — '
      + 'the seat\'s grid. The engine already has the right reading three files away (formationOf(g, '
      + 'self.id), columnOf(self.id)). THE COUNTING FAMILY READS THE SOURCE; THE PLACING FAMILY '
      + 'READS THE SEAT.',
    evidence:
      'FTUW replays ✓ FAITHFUL 240/240 and the log shows it in order: Hooba-Lin attacks, trigger '
      + 'goes to the stack, Fireball kills Hooba-Lin, "the formation closes up: 1 empty column(s) '
      + 'removed", then "Hooba-Lin: Unit Token joins the formation (column 1, behind Awoken Tomb)". '
      + 'THE CLASS IS FOUR CARDS AND ALL FOUR ARE WRONG, in two grades: DEAD SOURCE (Hooba-Lin, '
      + 'Hooba-Bot — no guard at all) and ALIVE BUT UNSLOTTED under R172 control theft (ALL FOUR, '
      + 'because Hooba-God and Hooba-Pon guard on "in play", which is the wrong predicate; Pon '
      + 'would also CHARGE the player for the play). Both grades reproduced minimally at HEAD, not '
      + 'just in FTUW.',
    fix:
      'Hand placeInFormation the source ENTITY ID, guard on columnOf, resolve slots from the '
      + 'source\'s grid, and move the guard AHEAD of the spawn in Lin and Bot — today the token is '
      + 'minted first and would be stranded. Guard Pon before the pay question. ⚠ RULES POSITION, '
      + 'already settled so nobody re-derives it: R1 makes "if I am still in formation" look like '
      + 'the only recheck, but "in my formation" is a REFERENT COMPUTED AT RESOLUTION, and R27 '
      + 'already rules exactly this for the same phrase ("a unit that wasn\'t attacking gets X = 0 → '
      + 'no token"). So this is consistency with R27, not an exception to R1. Add a call-site '
      + 'conformance scan so a FIFTH card inherits the guard or reddens the suite.',
    proof: null,
    verify:
      'A source that is dead, or alive but not in a formation, creates nothing and raises no '
      + 'decision — and nothing is left stranded in the region.',
    guards: [
      '108-formation-class.test.ts::R225 Hooba-Lin: killed under its own attack trigger',
      '108-formation-class.test.ts::R225 Hooba-Lin: alive but out of the formation (R172)',
      '108-formation-class.test.ts::R225 Hooba-Bot: killed under its own attack trigger',
      '108-formation-class.test.ts::R225 Hooba-God: alive but out of the formation (R172)',
      '108-formation-class.test.ts::R225 Hooba-Pon: alive but out of the formation (R172)',
      '108-formation-class.test.ts::R225 conformance: EVERY card call site of placeInFormation names its source ENTITY',
      '108-formation-class.test.ts::R225 conformance: every "in my formation" placer guards on the SOURCE before it spawns',
      '108-formation-class.test.ts::R225 the primitive itself: placeInFormation given a sourceId that is in NO formation refuses',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29), as R225, and the class held at exactly four. THE FIX: two '
      + 'new source-read primitives, `E.formationSeatOf(id)` and `E.myFormationSlots(id)`, derived '
      + 'from the existing private `formationGrid` so they CANNOT disagree with '
      + '`formationSlots`/`adjacentSlots`. `placeInFormation` now takes `opts.sourceId` (an '
      + 'EntityId, alongside the display-only `source` string that was the whole bug) and resolves '
      + 'slots from THAT UNIT\'s grid; a source in no grid gets a LOGGED REFUSAL rather than '
      + 'silence. All four cards guard AHEAD of the spawn — Hooba-Lin and Hooba-Bot had no guard at '
      + 'all, and Hooba-God and Hooba-Pon guarded on IN PLAY, which is the wrong predicate under '
      + 'R172 control theft. Hooba-Pon\'s guard sits BEFORE `payCard`, so a player is never charged '
      + 'for a play that cannot happen. THE CLASS, COMPUTED, AND NARROWER THAN THE PHRASE SUGGESTS: '
      + '14 /formation/i hits in printed.json reduce to SEVEN cards that refer to a formation BY '
      + 'THE SOURCE. The placing half is Hooba-Lin, Bot, God, Pon (all four wrong) plus Hooba-Nan, '
      + 'Rousing Spirit and Riftwalker — and those three were ALREADY RIGHT, because they read '
      + '`columnOf`/`locateInGrid(self.id)`. The counting half (Embermaw Fledgling, Lumengrove '
      + 'Lurker, Luminary Leader) is R27 and untouched. NOT members: Galactic Germination (a TARGET '
      + 'formation), Tiderunner Initiate and Trench Stalker (R29, YOUR formation), Aberrant '
      + 'Populace (reminder text only). ⚠ Hooba-Nan\'s printed "if I am still in formation" turns '
      + 'out to be REDUNDANT REMINDER TEXT, not a fifth member — which is the evidence that R27\'s '
      + 'reading was always right and R1\'s "only recheck mechanism" was the wrong frame. There is '
      + 'no fifth wrong card. TWO RUNTIME CONFORMANCE SCANS now derive membership rather than '
      + 'listing it: every `.placeInFormation(` call in engine/src/cards/** must pass `sourceId:`, '
      + 'and every card() body containing one must mention a source-read primitive. A fifth card '
      + 'inherits the guard or reddens the suite (docs/13 §7.2). ⚠ TWO LOAD-BEARING TEST-DESIGN '
      + 'NOTES, either of which would have made this fix LOOK proven when it was not. (1) The '
      + 'scenarios attack with a SECOND LIVING COLUMN, because on a lone-source board '
      + '`formationSlots` returns [] anyway and the test passes on the OLD code — the guard would '
      + 'never be reached. (2) Grade 2 is built with R172\'s own `giveControl` there-and-back, so '
      + 'the only changed fact is "not in a line". ⚠⚠ ORCHESTRATOR VERIFIED BY BREAKING, '
      + 'INDEPENDENTLY, in a scratch copy outside the repo: neutering Hooba-Lin\'s guard to `if '
      + '(false)` reddens tests 9 and 10 (both grades) AND test 18, the conformance scan. That '
      + 'third failure is the important one — it is the evidence that the scan COMPUTES membership '
      + 'rather than carrying a hardcoded list of four, which is the exact failure this repo has '
      + 'shipped three times. Restored: 21/21 green.',
    status: 'done',
  },
  {
    id: 99,
    area: 'client',
    severity: 'minor',
    reportId: 113,
    title:
      'The hand is drawn twice during draft, and the copy the player does not need covers the '
      + 'board',
    detail:
      'Report #113, filed by the owner explicitly as an IDEA and not a bug — his words are "UX '
      + 'improvement idea". "When drafting, or choosing which 2 to put on the bottom in '
      + 'constructed, make the hand along the bottom of the screen slide down to not show. Since '
      + 'you can see your hand in the draft/recycle area, it is just duplicated, and moving it off '
      + 'screen would let you more easily survey the battlefield at the same time."',
    evidence:
      'Measured: a draft state renders 16 data-act="draftcard" elements and the SAME 12 hand '
      + 'cards again in .handdock. The duplication is real and countable, so the complaint is not '
      + 'aesthetic.',
    fix:
      'Tuck the dock, do not delete it. ⚠ TWO TRAPS, both measured. (1) $app.innerHTML is '
      + 'replaced wholesale on every paint, so a CSS transition can never run — an instant hide is '
      + 'S, a real slide needs the dock hoisted out of the repainted subtree and is M. (2) '
      + 'data-animzone="hand:N" exists ONLY on the dock in net mode, so removing it from the DOM '
      + 'BREAKS CARD FLIGHTS. ⚠ This is a backlog-shaped item, carried here only because it is an '
      + 'unanswered report; it must not outrank card work.',
    proof: null,
    verify:
      'During draft and during the constructed bottom-two choice, the battlefield is '
      + 'unobstructed, and card flight animations still play.',
    guards: [
      '204-relocated-work-has-a-home.test.ts::every BL-nn cited by a closed ticket or a settled report really exists',
      '204-relocated-work-has-a-home.test.ts::work relocated to the backlog was not then quietly dropped',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) BY MOVING IT, not by building it — as backlog entry '
      + 'BL-32. The owner filed this through the in-game bug button but called it an "UX '
      + 'improvement idea" in his own words, and this list is for things that are WRONG. It was '
      + 'carried here only because 83-card-todo requires every unanswered owner report to have an '
      + 'entry, which is the right rule and produced the right outcome: the idea could not be '
      + 'dropped on the floor, and it is now in the queue it belongs to with the measurement and '
      + 'the traps attached. THE DUPLICATION IS REAL — measured, not assumed: a draft state '
      + 'renders 16 `draftcard` elements and the SAME 12 hand cards again in `.handdock`. ⚠ THE '
      + 'TWO TRAPS ARE IN BL-32 and are why this is not the ten-minute job it looks like: '
      + '`$app.innerHTML` is replaced WHOLESALE every paint so a CSS transition can never run, '
      + 'and `data-animzone="hand:N"` exists only on the dock in net mode, so unmounting it '
      + 'breaks card flights. Tuck, do not delete. ⚠ A NOTE ON WHAT THIS CLOSURE MEANS: nothing '
      + 'was fixed and there is no guard, because there is nothing to guard. Closing a ticket by '
      + 'relocating it is only honest if the destination is real and carries the evidence — '
      + '⚠⚠ AND "WE MOVED IT" IS NOW CHECKABLE RATHER THAN ASSERTED, which is the point: '
      + '204-relocated-work-has-a-home.test.ts fails if a closure cites a BL-nn that does not '
      + 'exist, or one that has since been DROPPED. The second direction is the one that matters — '
      + '"moved to the backlog, then dropped" is a report dying quietly while BOTH ledgers read as '
      + 'clean, and it is the same shape as the four fixed reports whose guards could never have '
      + 'failed. ⚠⚠ AND THE ORCHESTRATOR\'S FIRST BREAK-TEST OF THAT GUARD WAS ITSELF VACUOUS, '
      + 'caught only because the expected failure did not appear. The sed pattern `as backlog entry '
      + 'BL-32.` never matched: the phrase is split across a string concatenation in this very '
      + 'file, and the ledger writes it with a comma. The file was never modified, the test passed, '
      + 'AND THAT PASS WOULD HAVE READ AS "the guard was break-tested". A break-test that does not '
      + 'change the code is indistinguishable from a guard that cannot fail — docs/13 §5, committed '
      + 'by the person writing the §5 entry about it. Redone properly: repointing every occurrence '
      + 'at a backlog id that does not exist reddens the existence check by name, and flipping the '
      + 'real entry to `dropped` '
      + 'reddens the other; both restore byte-identical. ALWAYS ASSERT THE BREAK LANDED (grep the '
      + 'count) BEFORE BELIEVING A RED OR A GREEN.',
    status: 'done',
  },
  {
    id: 100,
    area: 'coverage',
    severity: 'minor',
    reportId: 115,
    cards: ['Rampart Guardian', 'Reality Bender', 'Its Dark Bubb', 'Beyond, Codex Incarnate', 'The Omniphage'],
    title:
      '{Tough} + {Inverted} is a two-card column wipe and nothing in the suite pins it',
    detail:
      'Report #115, which is the owner RETRACTING #114 and stating a rule while he does it: "That '
      + 'is actually how tough works. So tough + inverted always kills the unit since +0/+X is just '
      + '-0/-X where X is its exact defense." NOT A BUG — the engine agrees with him. This entry '
      + 'exists because an interaction the owner has explicitly ruled on, and that nothing in the '
      + 'suite can see regress, is worth more than most bugs. ⚠ HIS WORDING IS VERBALLY TOO STRONG '
      + 'AND MUST NOT BE PINNED LITERALLY: measured over 30 board states, final defense = −2·Δ '
      + 'where Δ is the net layer-3 defense change. Δ ≥ 0 kills (every ordinary board, which is why '
      + '"always" felt true), but Δ < 0 SURVIVES at 2|Δ| — a base 1/3 with a −1/−1 counter is a '
      + '2/2. A test written to the literal words would pin a false generalisation into the suite.',
    evidence:
      'FHDY replays ✓ FAITHFUL 264/264; per-action effStats probe puts the death at 111-119, not '
      + 'the reported 121. THE FINDING THE REPORT COULD NOT SEE: because the column shares power, '
      + '{Inverted} on the FRONT unit and {Tough} on the BACK unit KILLS BOTH — a two-card column '
      + 'wipe where neither card touches the unit that matters. Also measured: The Omniphage kills '
      + 'itself off its own bin (5/5 → 5/10 → 5/0), and Beyond Codex Incarnate turns any {Tough} '
      + 'into targeted removal against its own controller. {Unaware} beats both (layer 6 returns '
      + 'printed stats), as does attribute stripping.',
    fix:
      'A ruling under R93 stating the law as −2·Δ rather than "always", with the column-sharing '
      + 'consequence as its headline, plus tests in 79-round17-layers.test.ts. NO ENGINE CHANGE. '
      + 'That file currently pins Caleb\'s THREE-attribute example but not the TWO-attribute case '
      + 'that actually occurs in games. ⚠ Break-test by perturbing the layer-3 arithmetic — an '
      + 'assertion nobody has watched redden is worth nothing here, and Harness.absorb made every '
      + 'secrecy test in this repo unfalsifiable for months.',
    proof: null,
    verify:
      'The owner\'s case, the Δ < 0 survival case, the column wipe and the {Unaware} override are '
      + 'each asserted, and each has been watched to fail under a deliberate break.',
    guards: [
      '79-round17-layers.test.ts::the special case his wording misses — a SHRUNK unit survives',
      '79-round17-layers.test.ts::the column wipe — {Inverted} on the front unit, {Tough} on the BACK, and both die',
      '79-round17-layers.test.ts::Nectar Ridge Oracle, and the damage was never load-bearing',
      '79-round17-layers.test.ts::{Unaware} beats both — layer 6 returns the printed numbers',
      '79-round17-layers.test.ts::the class is FIVE cards, computed from the pool and not typed from the report',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29). NO ENGINE CHANGE — the engine was right and the owner was '
      + 'right; what was missing was anything that could see it regress. Seven tests added to '
      + '79-round17-layers.test.ts at seeds 7907-7914 (7906 and 7910 were already taken). THE LAW '
      + 'AS MEASURED, recorded instead of the sentence in the report: with Δ = the net layer-3 '
      + 'defense change, layer 4 gives t = 2(baseT + Δ) and layer 5 gives t = 2·baseT − 2(baseT + '
      + 'Δ), so FINAL DEFENSE = −2Δ and THE BASE CANCELS ENTIRELY. Δ ≥ 0 dies; Δ < 0 LIVES at 2|Δ|. '
      + 'The owner\'s derivation ("+0/+X is just -0/-X where X is its exact defense") is exactly '
      + 'right — only the word "always" is too strong, and it is the special case at Δ ≥ 0. A base '
      + '1/3 carrying one −1/−1 counter comes out a 2/2, alive. THE HEADLINE FINDING IS ONE THE '
      + 'REPORT COULD NOT SEE: because a column shares power, {Inverted} on the FRONT unit and '
      + '{Tough} on the BACK unit KILLS BOTH — a two-card column wipe where neither card touches '
      + 'the unit that dies. The back unit does NOT own {Inverted}; sharing lives in '
      + 'effAttrs/statLayerAttrs rather than ownAttrs, which is precisely why a player cannot see '
      + 'the wipe coming. The class is FIVE cards, computed from printed.json plus behaviour defs '
      + 'over the whole pool, with no sixth member. ⚠ CORRECTION THE AGENT MADE TO ITS OWN BRIEF: '
      + '{Pure} is NOT an escape. R61 blinds a combat EXCHANGE, not effStats, so a Pure unit with Δ '
      + '≥ 0 still dies to the state-based check. The real escapes are {Unaware} (layer 6 returns '
      + 'printed stats) and attribute stripping. ⚠⚠ ORCHESTRATOR VERIFIED INDEPENDENTLY, and this '
      + 'is the verification worth reading. In a scratch copy of the engine OUTSIDE the repo the '
      + 'owner\'s LITERAL wording was implemented — `if (statAttrs.includes(\'Tough\')) t = 0;` '
      + 'immediately after layer 5, i.e. "tough + inverted always kills the unit". EXACTLY ONE test '
      + 'reddened — "the special case his wording misses — a SHRUNK unit survives, at 2·|Δ|" — and '
      + 'the other fourteen stayed green. That is the best evidence in this round that a guard is '
      + 'aimed at what it claims to guard: the false generalisation the test exists to prevent is '
      + 'the only thing it objects to. The agent reported the same result from its own break table; '
      + 'the two were obtained by different hands and agree.',
    status: 'done',
  },
  {
    id: 101,
    area: 'coverage',
    severity: 'major',
    title:
      'Nothing stops an open ticket or a pending question from re-litigating a CLOSED ruling',
    detail:
      'A settled ruling can be re-opened, re-asked and REVERSED with nothing in the repository '
      + 'objecting. This is not hypothetical and it nearly happened on 2026-08-28. R157 §17 '
      + '(2026-08-25) ruled Torrential Reclamation "Already correct". Four days later CT-91 carried '
      + 'it as a MAJOR OPEN BUG, 182-correctness-sample recorded the engine as WRONG on it, and '
      + 'docs/questions-round28.md Q1 re-asked the owner the settled question WHILE RECOMMENDING '
      + 'THE OPPOSITE ANSWER. He happened to answer consistently with his earlier ruling. Had he '
      + 'taken the recommendation, R157 §17 would have been silently reversed and the suite would '
      + 'have stayed green.',
    evidence:
      'Found by the round-29 reconciliation of the owner answer sheets against the repo — from '
      + 'OUTSIDE the suite, exactly like every finding in docs/13 §5, and not by any test. ⚠ THE '
      + 'GAP IS STRUCTURAL AND THE ADJACENT GUARDS ALL MISS IT BY DESIGN: 184-ruling-register '
      + 'checks that a CITED R-number EXISTS, and R215 checked that a USED ruling is REGISTERED. '
      + 'Neither asks the other direction — whether an OPEN item contradicts a CLOSED ruling. That '
      + 'direction has never been checked.',
    fix:
      'A guard that cross-references open work against the ruling register: for every open '
      + 'card-todo entry naming a card, and every unanswered ANSWER: block in a '
      + 'docs/questions-*.md, fail if a ruling already names that card or settles that question. ⚠ '
      + 'The hard part is the MATCH, not the sweep — start with the cheap, high-precision version '
      + '(an open ticket whose `cards` intersect a ruling section\'s cards) and let it be '
      + 'noisy-but-reviewable rather than clever and silent. ⚠ It needs a POSITIVE CONTROL (docs/13 '
      + '§7.4): feed it the CT-91/R157 §17 pair and prove it convicts, or it is another checker '
      + 'reporting sight it does not have.',
    proof: null,
    verify:
      'Re-filing a settled question fails the suite by name, and the guard is demonstrated to '
      + 'convict on the CT-91 / R157 §17 pair that motivated it.',
    guards: [
      '202-settled-rulings-not-reopened.test.ts::no OPEN todo entry says a card is broken that a ruling calls',
      '202-settled-rulings-not-reopened.test.ts::no UNANSWERED question re-asks something a ruling already settled',
      '202-settled-rulings-not-reopened.test.ts::the guard convicts the CT-91 / R157 §17 pair that motivated it',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R234, and the positive control convicts the REAL '
      + 'near-miss rather than a fixture. `202-settled-rulings-not-reopened.test.ts` runs the '
      + 'register BACKWARD toward the open work — the direction neither existing guard covers. '
      + '184-ruling-register asks whether a CITED number RESOLVES; R215 asked whether a USED ruling '
      + 'is REGISTERED. Both run from the code toward the register; the direction in which a '
      + 'decision gets UNDONE had never been checked. THE SIGNAL, chosen narrow on purpose: a '
      + 'ruling section saying "Already correct" is the register asserting the engine needs no '
      + 'change about the cards it names. An OPEN ticket calling such a card broken, or an '
      + 'UNANSWERED question asking about one, is a contradiction on its face. Matching "is this '
      + 'the same QUESTION" is a judgement no test can make, so the guard does not try; it takes '
      + 'the shape that actually happened. High precision, deliberately low recall — a noisy guard '
      + 'is switched off within a round, after which the real case walks through anyway. ⚠⚠ THE '
      + 'FALSE POSITIVE ON ITS VERY FIRST RUN IS THE MOST VALUABLE THING HERE. The first version '
      + 'matched any occurrence of a card name and immediately convicted round-27 Q8 — which asks '
      + 'whether a region-scoped effect can reach a player outside the region and names "Big '
      + 'Glimpse Card" in a PARENTHETICAL — against R157 §18, which settled a completely different '
      + 'question about the same card. Same card, different question, and the guard could not tell. '
      + 'That single false positive produced the rule that makes it survivable: THE CARD MUST BE '
      + 'THE SUBJECT — bolded, or in the heading — which is how these documents name what they are '
      + 'about. True of both real cases (round-28 Q1 bolds it, Q2 heads with it), false of the '
      + 'parenthetical. The false-positive shape is now PINNED IN THE TEST so nobody simplifies the '
      + 'subject check back to a bare includes(). ⚠ IT IS NOT A BAN. If a card really has regressed '
      + 'since a ruling, that is a legitimate open ticket: name the ruling and say what changed, '
      + 'and the guard steps aside. The escape hatch is the point — it forces the contradiction to '
      + 'be ACKNOWLEDGED rather than merely to exist. ORCHESTRATOR VERIFIED AGAINST HISTORY, NOT A '
      + 'FIXTURE: blanking Q1\'s ANSWER line reconstructs docs/questions-round28.md exactly as it '
      + 'stood on 2026-08-26, and the guard convicts — naming the question, the card, and the '
      + 'ruling that had already settled it. Restored byte-identical, 3/3 green. It also carries '
      + 'the control every checker in this repo needs and most lacked: it asserts its subject set '
      + 'is NON-EMPTY, that it can still see R157 §17 specifically, and that it does NOT convict a '
      + 'ticket about an unruled card.',
    status: 'done',
  },
  {
    id: 102,
    area: 'coverage',
    severity: 'minor',
    title:
      'docs/13 quotes numbers the suite prints, and nothing re-reads them',
    detail:
      'docs/13-assessment.md §1② and §3 quoted 392/439, 278/316 and "38 claims across 37 cards" '
      + 'with an EVENTLESS bucket, while 84-card-semantics printed 393/439, 279/316, "37 across 36" '
      + 'and no EVENTLESS. The doc had been wrong for two days. ⚠ THE PART THAT MAKES THIS WORTH A '
      + 'TICKET: the stale paragraph sits directly above a warning box which says this line was got '
      + 'wrong three times in one day and ends "The tally the suite prints has been right every '
      + 'single time. Quote it; do not re-derive it." NOBODY RE-DERIVED IT. It was copied once and '
      + 'never re-read, and R219 (7864bb8) moved a claim underneath it.',
    evidence:
      'Measured 2026-08-28 by running 84-card-semantics and diffing its printed tally against the '
      + 'document. This is a FIFTH failure mode for docs/13 §5, and the most uncomfortable, because '
      + 'it needs no faulty instrument at all: a CORRECT instrument, printing CORRECTLY, into a '
      + 'document nobody re-read. Every other entry in §5 is a checker that went blind; this one is '
      + 'a checker that worked perfectly and was ignored.',
    fix:
      'A test that reads docs/13-assessment.md, extracts the numbers it quotes, and asserts they '
      + 'equal what the suite computes — so the document cannot drift from its own sources. Same '
      + 'shape as CT-101. ⚠ Extract by IMPORTING the tally from the semantics module rather than '
      + 're-deriving it here, and parse the DOC not the test: docs/13 §5 catalogues stripCode going '
      + 'blind three separate times, and a fragile doc-scrape that silently matches nothing would '
      + 'fail exactly the way this ticket is about.',
    proof: null,
    verify:
      'Changing a number in docs/13 away from what the suite prints fails the suite, and the '
      + 'check is shown to fail when the document is edited to a wrong value.',
    guards: [
      '201-assessment-numbers.test.ts::docs/13 quotes the CURRENT precondition partition',
      '201-assessment-numbers.test.ts::docs/13 quotes the CURRENT unreached CARD count',
      '201-assessment-numbers.test.ts::CT-102 POSITIVE CONTROL: the reader can see',
    ],
    closed:
      '✔ CLOSED 2026-08-28 (round 29) as R233, and the control convicts the REAL drift rather '
      + 'than a synthetic one. `201-assessment-numbers.test.ts` reads docs/13 and compares it to '
      + '`UNREACHED` at RUNTIME via Object.keys — never a scrape, because the scenario queue\'s '
      + 'first version regexed UNREACHED out of a source file and read 32 keys where the object has '
      + '37 (five card names are bare JS identifiers), and two independent scrapes agreed on 32 '
      + 'because they shared the assumption rather than the answer. ⚠ WHAT IS NOT GUARDED, SAID OUT '
      + 'LOUD: the 393/439 and 279/316 promise counts. They need the whole-pool drill '
      + '84-card-semantics already pays for once, and reproducing it to check a document would '
      + 'double the suite\'s most expensive minute. IF THOSE DRIFT AGAIN THIS FILE WILL NOT CATCH '
      + 'IT. Naming the hole is the price of not shipping a checker that implies more coverage than '
      + 'it has — which is the exact failure this ticket is about. ORCHESTRATOR VERIFIED BY '
      + 'BREAKING WITH THE HISTORICAL DEFECT: restoring the precise line that shipped for two days '
      + '— `EVENTLESS 1` and `38 claims across 37 cards` — reddens BOTH assertions by name; '
      + 'restored byte-identical and 3/3 green. The positive control additionally proves the reader '
      + 'finds a partition it is handed, NOTICES a stale one, and returns null on prose rather than '
      + 'inventing one — because a doc-scrape that silently matches nothing passes every comparison '
      + 'it is asked to make, and that is the shape docs/13 §5 is a catalogue of. THE LESSON, WHICH '
      + 'IS THE RULING: A WARNING BOX IS NOT A CONTROL. The stale paragraph sat directly beneath a '
      + 'box recording that this same line had been got wrong three times in one day, ending "Quote '
      + 'it; do not re-derive it." Nobody re-derived it. Prose addressed to a future reader assumes '
      + 'there is one.',
    status: 'done',
  },
  {
    id: 105,
    area: 'coverage',
    severity: 'major',
    title:
      'The client driver still lies about hover, and half-fixing it would replace one lie with '
      + 'two',
    detail:
      'THE THIRD INSTANCE OF THE CT-75 FAMILY, and the second to produce a real bug that shipped. '
      + 'R230 fixed ONE of ui-driver.ts\'s two hover-related fictions — `clearTimeout` is real now — '
      + 'but the driver still fires NO `scroll` event when `scrollTop` is assigned, so the client\'s '
      + 'own scroll is invisible to it. ⚠ AND FIXING ONLY THAT WOULD MAKE THINGS WORSE, which is '
      + 'why it was deliberately left: `#preview` and `#hovertip` are in the driver\'s ABSENT set, '
      + 'so `paintFocus` bails and the client\'s scroll never happens there at all; '
      + '`classList.contains` returns a flat false for non-markup elements; there is no `mouseover` '
      + 'dispatch; and the new listener needs an `Element` global. A driver that fired `scroll` '
      + 'into that would report a hover story that is confidently wrong in a new way.',
    evidence:
      'Report #110 passed in the driver and failed in EVERY browser, at three viewports out of '
      + 'three. The CT-75 note already recorded that this class \'had already produced one wrong '
      + 'ticket\'; #110 is the second. ⚠ Note what closing the FIRST half proved: making '
      + '`clearTimeout` real reddened NOTHING — 211 tests across 15 driver-driven files still pass. '
      + 'So no test was living on that particular lie, which is mildly reassuring and says nothing '
      + 'about the others.',
    fix:
      'The honest ticket is the whole job, not the scroll event: real `#preview`/`#hovertip` '
      + 'nodes, a stateful `classList`, `mouseover` dispatch, and async `scroll`. ⚠ Expect it to '
      + 'redden tests — a driver that starts telling the truth is ALLOWED to break tests that were '
      + 'passing on a lie, and each one that reddens is a finding rather than a regression. Budget '
      + 'for triaging them. ⚠ Until it is done, a hover or nested-element behaviour MUST be '
      + 'verified in a real browser over CDP; the driver\'s green is not evidence. R230\'s header '
      + 'says so already so the next agent cannot walk into it.',
    proof: null,
    verify:
      'A hover bug that fails in a browser also fails in the driver — demonstrated by reverting '
      + 'R230\'s client fix and watching a driver-only test redden.',
    closed:
      '✔ FIXED 2026-08-29 (round 30) as BL-32. `handDockTucked()` is true while a draft pack or '
      + 'the constructed bottom-two choice is open, and `.handdock.tucked .zone` clips the row to '
      + 'an 18px strip that `:hover` gives back — so the battlefield gets the space and the cards '
      + 'stay reachable. '
      + '⚠ BOTH TRAPS THIS ENTRY NAMED WERE REAL, AND THE SECOND IS SHARPER THAN IT SAYS. It is '
      + 'not only that UNMOUNTING the dock breaks card flights: `ui/anim.ts` `real()` requires '
      + 'width AND height > 0, so a dock clipped to ZERO height drops every flight into and out of '
      + 'your hand just as silently. 18px is a real box in a real place, and it is the only reason '
      + 'this is a CSS change rather than an animation bug. The first trap costs nothing here — '
      + 'the tuck is pure CSS keyed off state, so there is no toggle to lose when `$app.innerHTML` '
      + 'is replaced wholesale, and no transition that could never run. '
      + 'VERIFIED BY BREAKING: unmounting the dock instead of tucking it reddens '
      + '216-menu-scoping §4a and §4b by name.',
    guards: [
      '216-menu-scoping.test.ts::§4a the duplication the report describes is real, and measured',
      '216-menu-scoping.test.ts::§4b TUCKED, NOT UNMOUNTED — the flight anchor survives',
      '216-menu-scoping.test.ts::§4c the dock comes back the moment the choice ends',
    ],
    status: 'done',
  },

  {
    id: 106,
    area: 'engine',
    severity: 'minor',
    title:
      '`actionCount` is served live to both seats, so a modified client can see WHEN its opponent '
      + 'acted inside a hidden step',
    detail:
      'R236 closed the haste step\'s readiness tell in server/view.ts, and while measuring it the '
      + 'agent found the channel underneath. `actionCount` is served live and ticks on EVERY action '
      + '— measured on the real wire as 2 → 3 → 6 across a single haste step. So a modified client '
      + 'can still see THAT its opponent acted and WHEN, inside a step whose whole purpose is that '
      + 'it cannot. ⚠ IT IS NOT HASTE-SPECIFIC: identical in the resource step and in deployment, '
      + 'and it PREDATES all of R224/R228/R236 — this round did not introduce it, it made it '
      + 'visible. It is invisible in the SHIPPED client, so no honest player can exploit it today; '
      + 'the exposure is to a modified one.',
    evidence:
      'Measured on a real server over CDP with a raw socket as the second seat, not inferred from '
      + 'code. `205-*.test.ts` §3d asserts its EXACT size — which is the useful part: the test does '
      + 'not merely record the leak, it pins the residual so that a SECOND leaking field reddens '
      + 'the suite. A named, measured residual with a guard on it is worth more than an unnamed '
      + 'one, and docs/13 §5 is a catalogue of what happens to the unnamed kind.',
    fix:
      '⚠ IT CANNOT BE CLOSED IN view.ts, and the agent proved why rather than guessing: freezing '
      + '`actionCount` inside a segment jams the client\'s own one-intent-per-state latch, so the '
      + 'obvious fix breaks the client. Closing it needs a PER-SEAT action counter in engine.ts or '
      + 'rooms.ts. ⚠ THAT IS A DESIGN DECISION FOR THE OWNER, not a patch: it costs a state field '
      + 'on every game and touches the replay/forensic stack, which is keyed on the action index '
      + '(R200). Ask before building. The honest framing for him: \'a cheating client can currently '
      + 'tell when you acted during a hidden step; closing it costs a per-seat counter and touches '
      + 'replay.\'',
    proof: null,
    verify:
      'Two seats acting inside a hidden simultaneous step cannot distinguish each other\'s action '
      + 'timing from any field the server serves — demonstrated on the real wire, not in the '
      + 'driver.',
    closed:
      'WONTFIX by the owner, 2026-08-29, round-31 question sheet Q2: "Since all they get is very '
      + 'minimal information, I am not worried about this." '
      + 'This entry asked before building, which was right — the fix cannot be done in view.ts '
      + '(freezing the counter jams the client one-intent-per-state latch) and needs a per-seat '
      + 'counter in engine.ts/rooms.ts, touching the replay and forensics stack keyed on action '
      + 'index (R200). That is a large change to the most safety-critical part of the server, '
      + 'against a threat model — an opponent running a modified client — this client does not '
      + 'defend against anywhere else. '
      + 'NOT CLOSED AS FIXED, and there is deliberately no guard: nothing changed, so nothing can '
      + 'regress. If the threat model ever changes, the measurement is in this entry and still '
      + 'stands (2 → 3 → 6 across one haste step, on the real wire).',
    status: 'wontfix',
  },

  {
    id: 107,
    area: 'engine',
    severity: 'major',
    title:
      'OWNER RULING NEEDED: the log has no region dimension, so R239 stops effects but not '
      + 'INFORMATION',
    detail:
      'R239 (the owner, 2026-08-28) is stronger than target legality: "Only players that are in '
      + 'the region as an effect can even see that it exists. So anything that happens in a region '
      + 'where a player or unit currently isn\'t is 100% IGNORED, as if that effect didn\'t exist." '
      + 'The effects half is now fixed. The SEEING half is not, and cannot be without a decision. '
      + '`E.ev` builds {type, msg, data} and NEVER STAMPS A REGION — there is no field a redactor '
      + 'could gate on — and server/view.ts::visibleToSeat gates only on `data.privateTo`. So a '
      + 'player outside the region reads every line of what happened there.',
    evidence:
      'Found by the R239 agent while implementing the effects half, and correctly NOT built on '
      + 'its own reading — this is the seat-redaction layer, where this repo has already shipped '
      + 'two genuine information leaks that 153 test files could not see. types.ts:1675 states '
      + 'outright that "R12 exists to stop information crossing regions", so the intent is on '
      + 'record and only the plumbing disagrees.',
    fix:
      '⚠ ASK BEFORE BUILDING, and the question is not "should we hide it" — it is WHAT IS PUBLIC. '
      + '`viewFor` currently ships ALL regions\' board state to both seats, so a hidden LOG over a '
      + 'visible BOARD would be incoherent: you would read nothing and then see the result. So the '
      + 'owner has to answer two things together: (a) is a region\'s log hidden from a player who is '
      + 'not in it, and (b) is a region\'s BOARD still public? Answering (a) yes and (b) yes is '
      + 'contradictory. Building needs an EngineEvent region stamp (engine.ts) plus a redaction '
      + 'rule, and it touches the replay stack.',
    proof: null,
    verify:
      'A player outside a region cannot learn from the log what happened in it — and what they '
      + 'can see of the board is consistent with what they can read.',
    guards: [
      '219-region-scoped-all.test.ts::§2a the log redactor gates on privateTo, and on nothing else',
      '219-region-scoped-all.test.ts::§2b an event from a region you are not in is still yours to read',
      '219-region-scoped-all.test.ts::§2c privateTo still hides what it always hid',
    ],
    closed:
      '✔ RULED 2026-08-29 — NO CODE CHANGE, and that is the answer rather than an omission. The '
      + 'owner: "Regions do NOT scope information." So the behaviour this entry reported as a '
      + 'possible leak is correct: `visibleToSeat` gates on `data.privateTo` and on nothing else, '
      + 'and a player outside a region may read every line of what happened there. '
      + 'THE ENTRY ASKED THE RIGHT QUESTION AND THE RULING DISSOLVES IT RATHER THAN OVERRULING IT. '
      + 'It insisted (a) and (b) be answered together — is the LOG hidden, is the BOARD still '
      + 'public — and it was right that answering yes to both is contradictory, because `viewFor` '
      + 'ships every region board state to both seats. "Hide the log" was never available without '
      + 'also hiding the board. No to both is the coherent pair. '
      + 'Registered as R243 §2, and guarded: a region test appearing in the redactor now reddens, '
      + 'because the next reader will otherwise fix what was ruled not to be broken.',
    status: 'done',
  },
  {
    id: 108,
    area: 'card',
    severity: 'minor',
    cards: ['Bloppert', 'The Mighty Doot', 'Finality'],
    title:
      'OWNER RULING NEEDED: does a GLOBAL superlative respect R25 region scoping?',
    detail:
      'Three cards loop `g.s.players` GLOBALLY rather than asking the region: Bloppert, The '
      + 'Mighty Doot, and Finality. R239 settled that an effect cannot REACH a player outside its '
      + 'region — but these do not reach anybody, they COMPARE everybody, and then act on the '
      + 'winner. "The player with the most life", "more life than you" and similar superlatives are '
      + 'the shape. If the comparison is global but the effect is regional, a player who is not in '
      + 'the region can still DETERMINE the outcome inside it.',
    evidence:
      'Flagged by the R239 agent as a live unruled neighbour rather than swept up with the '
      + 'fallback family, which was the right call: the fallback cards REACHED a seat that was not '
      + 'there (a defect under R239), while these READ a seat that is not there (an ambiguity R239 '
      + 'does not name). Keeping them apart stopped a ruling being extended by an agent to a case '
      + 'the owner had not been asked about. ⚠⚠ AND THIS TICKET WAS CAUGHT BY CT-101\'S OWN GUARD ON '
      + 'ITS FIRST RUN, which is worth recording because it is the guard earning its keep against '
      + 'its author. 202-settled-rulings-not-reopened convicted it: BOTH Bloppert and The Mighty '
      + 'Doot already carry rulings marked *Already correct* — R157 §19 ("A tie on Bloppert does '
      + 'nothing" — "Nothing happening is good") and R157 §6 ("You" on a {Virus} [Augment] is the '
      + 'unit\'s CONTROLLER). THE ORCHESTRATOR DID NOT KNOW EITHER RULING EXISTED when filing this. '
      + '⚠ THIS ENTRY DOES NOT CONTRADICT EITHER OF THEM AND IS NOT A CLAIM THAT THEY REGRESSED. '
      + '§19 is about what a TIE does; §6 is about whose "you" a donated augment reads. Neither was '
      + 'asked whether the comparison that produces the tie, or the life totals being compared, may '
      + 'include a player outside the region. Same cards, different question — the exact shape that '
      + 'made the guard\'s question-half fire falsely on round-27 Q8 and produced its '
      + 'subject-vs-mention rule. The TICKET half has no such signal available, so it uses the '
      + 'acknowledgement escape hatch instead, and that is the correct outcome: the guard\'s job '
      + 'here was to force this paragraph to be written, not to block the ticket.',
    fix:
      '⚠ ASK. R239\'s words — "100% ignored, AS IF THAT EFFECT DIDN\'T EXIST" — point at regional '
      + 'comparison: a player who does not exist for the effect should not be able to define its '
      + 'outcome. But a superlative is not an effect reaching anyone, and narrowing it changes '
      + 'three cards\' power level, so this is not the same question and must not be answered by '
      + 'extension. Once ruled, derive the class from the pool (docs/13 §7.2) rather than fixing '
      + 'these three.',
    proof: null,
    verify:
      'A superlative resolves against exactly the set of players the ruling says it can see, on '
      + 'every card that prints one.',
    guards: [
      '219-region-scoped-all.test.ts::§1a no card reads the whole table — it asks the region',
      '219-region-scoped-all.test.ts::§1b the derivation really had teeth',
      '219-region-scoped-all.test.ts::§1d a seat that is not in the region is not counted',
      '219-region-scoped-all.test.ts::§1e ONE helper for the pool — the local copies are gone',
    ],
    closed:
      '✔ RULED AND FIXED 2026-08-29 as R243 §1. The owner: "they do scope global things (every card '
      + 'that says all is actually all in this region)". '
      + '⚠ THIS ENTRY CARDS LIST WAS WRONG IN BOTH DIRECTIONS, which is the reason its own `fix` '
      + 'said to derive the class. It named three (Bloppert, The Mighty Doot, Finality); the scan '
      + 'found TEN sites across nine cards, and The Mighty Doot was NOT among the ones a name-scan '
      + 'finds — its global read lives in a shared `dootBonus` helper above the card. '
      + 'Enforced structurally instead of card by card: `E.seatsHere(region)` is the one way to ask '
      + 'who is present, and no file under src/cards may mention `g.s.players` at all. NO EXEMPTION '
      + 'LIST (CT-83 is an open ticket about exactly that failure) — a card that genuinely needs the '
      + 'whole table needs a ruling, and reddening the test is how that starts. '
      + '⚠ THE GUARD EARNED ITS KEEP ON ITS FIRST RUN, against its own author: it found that SIX '
      + 'files had each grown a local `presentSeats` helper and that they DID NOT AGREE — five '
      + 'ordered initiative-first, batch-hybrids-ld-a took the raw array. Two cards in one region '
      + 'could iterate seats in different orders, which is a replay hazard as well as a rules one. '
      + '⚠ TWO CARDS CHANGED POWER and both are consequences of the ruling, recorded in R243 so they '
      + 'are decisions rather than surprises: The Mighty Doot gives no bonus during deployment (a '
      + 'home region lists only its owner, so no opponent is present to lead you — the standing R25 '
      + 'treatment of every "each opponent" card), and Wake the Dead reaches the enemy bin only '
      + 'where the enemy is, which for a {Battle} spell is everywhere it can legally be cast.',
    status: 'done',
  },

  // ══ ROUND 31 — the fifteen reports the snapshot was behind on ═══════════
  // Filed 2026-08-29 from issues.jsonl rows 116-130 (YFUE, VYTV, DSVQ). All
  // three rooms replay FAITHFUL at HEAD, so every one of these is checkable
  // against a real game rather than reasoned about.
  {
    id: 109, area: 'client', severity: 'minor', reportId: 116,
    title: 'the stack shows you that YOU are choosing, and never that your opponent is',
    detail:
      'A trigger that asks its controller to choose targets flashes on the stack for the seat doing '
      + 'the choosing. The opponent sees a stack that just sits there, with no indication anyone is '
      + 'being asked anything — so a pause reads as a hang.',
    evidence: 'Report #116, room YFUE 2026-08-28, actionIndex 92 (an Alluring trigger).',
    fix:
      'Give the waiting seat the same lightly-flashing stack affordance, driven by whose decision is '
      + 'outstanding. The information is already public (that a choice is pending is not hidden — '
      + 'WHAT is chosen is), so this is presentational, not a view-redaction change.',
    proof: null,
    verify:
      'Two clients, one room. Put a targeted trigger on the stack for seat 0 and look at seat 1 '
      + 'while seat 0 chooses: nothing on the stack moves today.',
    guards: [
      'server/test-pending-ask.ts::THE LEAK: the stub introduces no value this seat did not already hold',
      'server/test-pending-ask.ts::none of the asker-only values reaches the watcher',
      'server/test-pending-ask.ts::THE LEAK: the card name never reaches the other seat',
      'server/test-pending-ask.ts::no stub is published while the opponent half of the world is served frozen',
      '50-ui-inspect.test.ts::R247: the pause bar names the effect an opponent is answering, off the server stub',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R247, and MOST OF IT WAS NOT A CLIENT BUG AT ALL. Measured on '
      + 'the report own {Alluring} board: at the moment the question is open the opponent view '
      + 'holds decision null, stack empty, resolving null, legal empty. server/view.ts nulls the '
      + 'decision before it arrives, and an {Alluring} target is chosen while the trigger is being '
      + 'PUT ON the stack, so there was no stack item to flash on either screen — the thing this '
      + 'entry asked for could not be built where it asked for it. '
      + 'Shipped in two halves: the waiting bar breathes (the lightly-flashing ask), and a new '
      + 'SeatView.pendingAsk carries the seat plus an optional source that is an EntityId, NOT a '
      + 'card name — a value the receiver already holds, so the stub leaks nothing BY CONSTRUCTION '
      + 'rather than by redaction. Decision kind is deliberately withheld: it narrows what is about '
      + 'to happen. '
      + '⚠ REUSING state.decision AS THE STUB, WHICH THE BRIEF PROPOSED, WOULD HAVE BROKEN THE '
      + 'CLIENT — main.ts gates the bar on !s.decision and renders the decision bar unconditionally '
      + 'beneath it, and hotseat has no redaction at all. '
      + 'The guard is a LEAK TEST, not a feature test: every primitive leaf of the watcher view is '
      + 'walked against the rest of that seat own view, and the asker-only residue is checked to '
      + 'reach nobody. Eleven invariance checks pin that changing prompt, kind, options, labels, '
      + 'targets and ids moves nothing on the wire.',
    status: 'done',
  },
  {
    id: 110, area: 'client', severity: 'minor', reportId: 117,
    title: 'an allured unit carries no badge',
    detail:
      'Allured is a state the rules care about, and there is nothing on the unit that says a unit is '
      + 'in it. The player has to remember what happened.',
    evidence: 'Report #117, room YFUE 2026-08-28, actionIndex 105.',
    fix:
      'A badge on the unit, alongside the other state markers. ⚠ DERIVE the badge from the state the '
      + 'engine actually keeps, not from the card that applied it — the same rule that made the '
      + 'Glimpse guard cover 11 cards instead of 5.',
    proof: null,
    verify: 'Allure a unit and look at it. Nothing distinguishes it from any other unit.',
    guards: [
      '225-stack-readout.test.ts::§2a a lured unit wears a badge, and an unlured one does not',
      '225-stack-readout.test.ts::§2b the badge marks exactly the units the ENGINE would refuse to attack with',
      '225-stack-readout.test.ts::§2c the must-block half is only claimed for the round that lured it',
    ],
    closed:
      'FIXED 2026-08-29. Derived exactly as this entry asked: the badge reads Entity.allured, which '
      + 'IS the rule — apply.ts refuses an attack on the bare presence of the field. The guard does '
      + 'not restate that rule; it asserts the badge marks EXACTLY the units the engine would '
      + 'refuse, so the two cannot drift. The must-block half is claimed only while allured.round '
      + 'matches the current battle round, which is a distinction the report did not ask for and '
      + 'the rule requires.',
    status: 'done',
  },
  {
    id: 111, area: 'client', severity: 'major', reportId: 118,
    title: 'reminder text is the client own prose, and it leaks R-numbers at players',
    detail:
      'The Rules page and the reminders under units are more verbose than the printed reminder text '
      + 'and cite R-numbers, which are internal ruling ids that mean nothing to anyone outside this '
      + 'repo. The owner names Piercing as edited.',
    evidence: 'Report #118, room YFUE 2026-08-28, actionIndex 128.',
    fix:
      'Reminder text should be the wording the game itself provides. ⚠ CHECK ui/glossary.ts FIRST — '
      + 'report #106 established that the Glimpse instance of exactly this defect was glossary prose, '
      + 'not printed data, so a fix aimed at printed.json would have missed. Derive from printed data '
      + 'where the text exists so a new card extends it for free, and assert no player-facing string '
      + 'matches /R[0-9]+/.',
    proof: null,
    verify: 'Open the Rules page and read the Piercing entry, then compare it with the printed reminder.',
    guards: [
      '227-reminder-text.test.ts::R248: no string a renderer can reach off a glossary row carries an R-number',
      '227-reminder-text.test.ts::R248: no module that imports the glossary touches its citation field',
      '227-reminder-text.test.ts::R248: rendering every card in the pool leaks no R-number',
      '227-reminder-text.test.ts::R248/R252: a row no channel reminds a player about keeps its full authored rule',
      '177-glossary-conformance.test.ts::R248: a row the pool prints a reminder for SHOWS that reminder, verbatim',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R248. '
      + '⚠ THIS ENTRY SENT THE AGENT TO THE WRONG SURFACE. It said to check glossary.ts first, '
      + 'which was right, but the leak it pointed at (cardpanel.ts rendering the citation field) is '
      + 'the CARD BROWSER panel — not the Rules page and not under units. Those are main.ts '
      + 'glossRow, which never touched the field. The R-numbers the owner saw were typed into the '
      + '{Haste} row prose. Fixing the named line alone would have closed the report with the '
      + 'quoted string still on screen. '
      + 'The rows are kept byte-identical and SPLIT at export instead: text becomes the pool '
      + 'printed reminder verbatim where one exists, and the authored generalisation moves to '
      + 'rule. main.ts needed no edit at all. Three independent channels now agree on which 15 '
      + 'attributes carry a printed reminder — the Attr union, the pool attrs arrays, and the live '
      + 'registry — which is the different-mechanism check derive-never-enumerate asks for. '
      + '⚠ LEFT FOR THE OWNER, on the round-31 sheet: THREE printed reminders are NARROWER than '
      + 'this client model and now win on screen — {Flying} (printed says only flying units block '
      + 'flying units; the client blocks by COLUMN), {Pure} (no R61 {Feeble} carve-out) and '
      + '{Electric} (no controller-picks-the-path, no {Piercing} interaction). All three are '
      + 'preserved in rule and asserted; showing the printed sentence is exactly what was asked '
      + 'for, but it now contradicts how the client actually plays.',
    status: 'done',
  },
  {
    id: 112, area: 'engine', severity: 'major', reportId: 119,
    title: 'OWNER RULING NEEDED: a response window between a trigger and its effect',
    detail:
      'The owner expected to be able to cast Cosmic Reversal on his own unit AFTER an Eminence unit '
      + 'trigger went on the stack but BEFORE its effect resolved. Whether that window exists is a '
      + 'rules question, not a bug.',
    evidence: 'Report #119, room YFUE 2026-08-28, actionIndex 200 (seat 1).',
    fix:
      'ASK THE OWNER BEFORE BUILDING ANYTHING. On the round-31 question sheet. Related: R198 '
      + '(response window mid-resolution) is the nearest existing ruling and may already settle it — '
      + 'read it before asking, so the question is the part R198 does not answer.',
    proof: null,
    verify: 'Rules question — nothing to observe until it is ruled.',
    progress:
      'ROUND 31, MEASURED 2026-08-29 — AND THE QUESTION IS NOT THE ONE THIS ENTRY ASKS. '
      + 'The owner answered Q1 "Yes, all triggers are respondable", and that is TRUE everywhere the '
      + 'game hands out priority at all: pushItem resets passes and hands priority to the non-actor, '
      + 'and 229 pins BOTH answers on the same trigger of the same card. '
      + '⚠ BUT THE MOMENT IN THE REPORT WAS INSIDE THE COMBAT DAMAGE STEP, where there is no window '
      + 'to be respondable IN. At YFUE [197]/[198] the state is priority null, stack empty, '
      + 'legalActions(seat 1) EMPTY — she was never offered a window, rather than refused a spell. '
      + 'processTriggerQueue leaves battleMode false while battle.damageStep is set, so a trigger '
      + 'fired there takes the immediate resolve branch and never reaches the stack. '
      + 'THAT IS R3, the owner own ruling of 2026-07-16: "no priority window between damage '
      + 'sub-steps". Deployment (R144) is the other windowless place. '
      + '⚠ SO THIS CANNOT BE BUILT WITHOUT OVERRULING R3, which reopens R3, R117 and R157 §5. Put '
      + 'back to the owner as a second question rather than built. '
      + 'Separately: the two things the report BLAMED were both innocent. There is no castability '
      + 'restriction on Cosmic Reversal and never was (offered at eleven indices with an empty '
      + 'stack), and what she wanted to DO is now possible under R250. Only the timing is open.',
    guards: [
      '239-damage-triggers-after-combat.test.ts::R261: a combat-damage trigger is announced INSIDE the damage step and pushed to the stack AFTER it',
      '239-damage-triggers-after-combat.test.ts::R261: the other seat holds priority over a combat-damage trigger and can actually respond to it',
      '239-damage-triggers-after-combat.test.ts::R261 THE SWEEP: over every unit in the pool that triggers on combat damage, nothing resolves inside the damage step',
      '239-damage-triggers-after-combat.test.ts::R3 STILL STANDS: a unit killed in the Swift sub-step deals no normal damage, and only the trigger queue waits',
    ],
    closed:
      'FIXED 2026-08-30 as R261, and the round-31 progress note above called it exactly right: it '
      + 'could not be built without overruling R3, so it was put back to the owner rather than '
      + 'built. He answered round-32 Q1: "The ruling is correct, but WHERE the trigger goes is '
      + 'wrong ... all triggers that are caused by damage get moved to After combat, along with '
      + 'anything that triggers then", with an official RAQ showing damage triggers and after-'
      + 'combat triggers interleaved on ONE stack, initiative seat first. '
      + 'R3 SURVIVES, NARROWED: no priority window between damage sub-steps is still true — only '
      + 'the reading that a TRIGGER resolves inside the damage step is superseded. R117/R157 §5 '
      + 'keep their gate and lose the ordering claim; R121 is widened, because combat-damage '
      + 'triggers now arrive as battle-mode triggers and Crevice Lurker printed "during battle" '
      + 'always covered them. '
      + '⚠ THE FIX IS THREE LINES AND THE COLLATERAL WAS ~58 TESTS ACROSS ~22 FILES. One '
      + 'correction from the agent: holding the queue in pumpCombatDamage is not enough, because '
      + 'doDecide resumes an R120 election and an R121 pay answer straight into settle() with a '
      + 'sub-step half-run — the hold has to live in settle(). VERIFIED BY BREAKING BY THE '
      + 'ORCHESTRATOR: restoring the defect needs all THREE reverts (any two deadlock, because the '
      + 'pump returns on a non-empty stack and nothing has priority), and with all three back 8 of '
      + '9 redden while R3 STILL STANDS survives as its control.',
    status: 'done',
  },
  {
    id: 113, area: 'client', severity: 'major', reportId: 120,
    title: 'the expended icon shows [Switch1] or [once] rather than the one the unit has',
    detail:
      'The two markers are different effects that look functionally similar. The client picks one and '
      + 'shows it for both, so the expended indicator is wrong for whichever it did not pick. An '
      + 'earlier fix swapped WHICH one was wrong instead of making it follow the unit.',
    evidence:
      'Report #120, room YFUE 2026-08-28, actionIndex 238 — explicitly a re-report ("has now flip '
      + 'flopped").',
    fix:
      'Read the marker off the card and show that one. ⚠ THE GUARD MUST COVER BOTH, derived from '
      + 'printed text — a guard written for whichever case is broken today is what let this flip '
      + 'rather than close. Same shape as the #46 / #60 / #75 chain.',
    proof: null,
    verify:
      'Find a unit with [once] and one with [Switch1], expend each, and compare the icon shown with '
      + 'the marker the card prints.',
    guards: [
      '228-spent-marker.test.ts::R249: a spent bounded GRAFT ability wears the [Switch1] its own card prints',
      '228-spent-marker.test.ts::R249: a spent [once] ability wears [Once] — the same code, the other card',
      '228-spent-marker.test.ts::R249: every card in the pool with a bounded ability gets the marker it prints',
      '228-spent-marker.test.ts::R249: no card prints both markers, and none has two bounded abilities',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R249, WHICH OVERTURNS ONE CLAUSE OF R135 — the owner was right '
      + 'and the previous ruling was wrong here. Two reasons, neither of them in this entry: '
      + '(1) R135 rule that "a line never repeats what its own TAG already says" is about the '
      + 'augment and graft lines, whose tags are ICONS; the note line tag is the word spent, with '
      + 'no symbol, so there was never a duplicate to remove. (2) The markers are not two spellings '
      + 'of one thing: [Switch1] is the bounded GRAFT marker and its clause TRANSFERS when grafted, '
      + '[once] transfers nothing. R135 other two clauses stand. '
      + '⚠ AND THE PRESCRIBED FIX WAS NOT AVAILABLE. cardtext.ts own header says printed prose and '
      + 'abilities[] do not line up 1:1, and that guessing a mapping makes the box confidently '
      + 'wrong — there is no per-ability clause to read off. It works only because the POOL has no '
      + 'card with two bounded abilities and none printing both markers, so the guard is those '
      + 'INVARIANTS rather than a mapping, and it fails the day a card breaks them. '
      + 'Derived over the pool: 88 bounded cards, 64 print [Switch1], 22 print [once], 0 both; 113 '
      + 'bounded graft donors all print [Switch1]. FOUR emit sites, not the three the brief named. '
      + 'Both historical defects redden the new tests in OPPOSITE directions, which is what proves '
      + 'the flip-flop is over rather than reversed again.',
    status: 'done',
  },
  {
    id: 114, area: 'card', severity: 'major', reportId: 121, cards: ['Cosmic Reversal'],
    title: 'Cosmic Reversal: unverified against spell units in play, and the log cannot settle it',
    detail:
      'Printed: "Recall all other spell effects and spell units. (Negate them and put them into their '
      + 'controller hands.)" The owner cast it intending to catch spell units on the board, there '
      + 'were none, and the log gave him no way to tell whether it would have.',
    evidence: 'Report #121, room YFUE 2026-08-28, actionIndex 264.',
    fix:
      'Two separate things and both are owed: (1) a semantic test that a spell unit IN PLAY is '
      + 'recalled, which nothing asserts today; (2) the log line should say what the sweep considered, '
      + 'which is the auditability half of #125.',
    proof: null,
    verify:
      'Put a spell unit in play, cast Cosmic Reversal, and see whether it returns to its controller '
      + 'hand.',
    guards: [
      '229-cosmic-and-control.test.ts::R250: Cosmic Reversal recalls a spell unit in play to its controller hand',
      '229-cosmic-and-control.test.ts::R250 whole pool: every printed Spell Unit is recalled off the board',
      '229-cosmic-and-control.test.ts::R250: an ordinary unit in the same region is left alone',
      '229-cosmic-and-control.test.ts::R250: the log names both halves of the sweep, whether or not it found anything',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R250. The owner: "It returns all spell effects on the stack '
      + '(anything currently on the stack with type spell goes to the owners hand) and recalls all '
      + 'spell units FROM THE BOARD." '
      + 'THE REASON THE OLD CODE COULD NEVER HAVE WORKED, which this entry had not spotted: in play '
      + 'a spell unit is an ordinary unit ENTITY, and recallKinds is a set of STACK ITEM kinds — so '
      + 'the sweep had to ask the card REGISTRY, not the entity. The new half derives the set from '
      + 'the registry rather than naming any of the 14 printed Spell Units. '
      + 'The auditability half shipped too: the log now names what BOTH halves considered, found or '
      + 'not, which was the second thing the owner noticed. '
      + '⚠ R243 SCOPES IT — the board half is ctx.region, so an attacker spell unit left at home is '
      + 'out of reach of a {Battle} spell. That is the ruling, not a gap, and it is pinned by name.',
    status: 'done',
    progress:
      'MEASURED 2026-08-29 and BOTH OWNER OBSERVATIONS ARE CORRECT. The card never looks at the '
      + 'board: batch-water-a.ts iterates g.s.stack and nothing else, and recallKinds is a set of '
      + 'STACK ITEM kinds. Driven directly — a Jelly (printed Spell Unit) in play, Cosmic Reversal '
      + 'cast with an empty stack — the Jelly is untouched and the log says only "there is no other '
      + 'spell effect on the stack, nothing is recalled". So the log genuinely cannot tell a player '
      + 'what the sweep considered, which is the auditability half of CT-118. '
      + '⚠ THIS NOW NEEDS AN OWNER RULING, NOT A PATCH, and the evidence cuts both ways: "(Negate '
      + 'them and put them into their controller hands)" is stack language and you cannot negate a '
      + 'resolved permanent — but "all other spell effects" ALREADY covers a spell unit on the '
      + 'stack, so naming spell units separately is real evidence for the owner reading. On the '
      + 'round-31 question sheet — ANSWERED THERE THE SAME DAY. The two tests that pinned the old '
      + 'behaviour without blessing it were removed with the fix, and 229 replaced them.',
  },
  {
    id: 115, area: 'client', severity: 'major', reportId: 122,
    title: 'the client auto-sends doneHaste, the engine refuses it, and the player sees the error',
    detail:
      'Engine strings "not the haste step" (apply.ts doDoneHaste) and "not your haste step" surface '
      + 'as error toasts for an action the CLIENT generated, not the player. main.ts runAutoPass '
      + 'sends doneHaste, and the hasteAutoAt latch documented beside it prevents a repeat LOOP but '
      + 'not the first refusal.',
    evidence: 'Report #122, room VYTV 2026-08-28, actionIndex 20. Room replays 265/265 FAITHFUL.',
    fix:
      'Two parts, and only doing the second is a cover-up: (1) stop planning a doneHaste against a '
      + 'state where the step is already closed; (2) a refusal of a CLIENT-INITIATED automatic action '
      + 'must not reach the error toast a human action uses. Almost certainly one root cause with '
      + 'CT-116 — same room, four minutes apart, both auto-pass.',
    proof: null,
    verify: 'Play a networked game with auto-pass on and watch the top of the screen through a haste step.',
    guards: [
      '223-client-legality.test.ts::[122] one automatic doneHaste per unanswered send, however many states arrive',
      '223-client-legality.test.ts::[122] the latch comes down when the SERVER says the answer landed',
      '223-client-legality.test.ts::[122] a refusal of an action the CLIENT chose to send is not the player refusal',
      '223-client-legality.test.ts::[122] a refusal that follows a real click is still the player refusal',
    ],
    closed:
      'FIXED 2026-08-29 as R245 (b) and (c). '
      + '⚠ THIS ENTRY PRESCRIBED FIX (1) WAS A DESCRIPTION OF A STATE THE CLIENT NEVER SEES. '
      + 'autoHasteDone reads the authoritative state and legal list, and its two guards ARE '
      + 'doDoneHaste two need() clauses — the FIRST send is legal by construction. The defect is '
      + 'the SECOND: a hidden simultaneous segment pushes this seat a fresh state for every action '
      + 'the OPPONENT takes, each with a new actionCount, while this seat own doneHaste is still on '
      + 'the wire or parked as deferred by arrivalVerdict. An actionCount STAMP structurally cannot '
      + 'express "my intent is unanswered" — an unanswered intent is precisely what has not moved '
      + 'it. Replaced by an outstanding-intent latch lowered only by a server state showing the '
      + 'answer landed. '
      + '⚠ AND IT DOES NOT SHARE A ROOT CAUSE WITH CT-116, which this entry asserted it almost '
      + 'certainly did. Same feature area, different mechanisms; no path was found from Pass-all to '
      + 'these errors. Part (2) of the fix stands and shipped: an automatic refusal now goes to a '
      + 'toast and a log line rather than the red bar and error cue a refused CLICK earns.',
    status: 'done',
  },
  {
    id: 116, area: 'client', severity: 'major', reportId: 123,
    title: 'Pass All stops passing, for the third time',
    detail:
      "The owner: 'Pass All still isn't working right.' Report #68 was closed by moving every reason "
      + 'the chip comes off into ui/battle.ts passAllRelease, which was supposed to make this one '
      + 'answerable rather than recurring.',
    evidence: 'Report #123, room VYTV 2026-08-28, actionIndex 56.',
    fix:
      'DO NOT FIX THE CASE IN THE REPORT — docs/13-assessment.md §7.2. Derive the release set and '
      + 'assert it, so a new reason to stop passing extends the guard for free. The word "still" is '
      + 'the repo known signature of a one-case fix for a class (#46 → #60 → #75).',
    proof: null,
    verify:
      'Arm each of the three pass buttons in a networked game and note what makes it drop. (Was '
      + '"Arm Pass all…" when there was one button; R251 made it three with different answers.)',
    guards: [
      '230-pass-modes.test.ts::[123] an item that was on the stack when the chip was armed is never a change',
      '230-pass-modes.test.ts::[123] pass through stack finishes when the stack it was armed on has resolved',
      '230-pass-modes.test.ts::[123] pass all does not hand priority back for a new item or a new option',
      '230-pass-modes.test.ts::[123] pass all ends at the phase it was armed in, and the phase is read off the arm',
      '230-pass-modes.test.ts::[123] pass all still stops on the one pass that would erase castable spell tokens',
    ],
    closed:
      'ANSWERED AND FIXED 2026-08-29 as R251, after being deliberately left open through the first '
      + 'half of round 31 because only the owner could name the narrower promise. He named three: '
      + 'Pass, Pass through stack, Pass all. '
      + '⚠ THE REAL DEFECT WAS NOT IN passAllRelease, WHERE BOTH THIS ENTRY AND R245 WERE LOOKING. '
      + 'It was the R245 RE-TAKE in main.ts: the snapshot was retaken at every declined window, so '
      + '"new" meant "new since the last window I passed" — a running diff with no fixed scope. '
      + 'Nothing could ever finish, which is why the chip could only stop at the end of the battle '
      + 'and why the middle option was not expressible at all. Removing the re-take creates the '
      + 'scope; the new done release is that scope running out. The old chip became PASS THROUGH '
      + 'STACK. '
      + '⚠ The tokens release stays in Pass all on purpose: passEndsBattlePhase is true only of a '
      + 'pass that LEAVES the phase, so it fires AT the terminus rather than before it, and '
      + 'dropping it would re-open report #66 (irreversible R11 token loss, no undo).',
    status: 'done',
    progress:
      'ROUND 31 — ⚠ NOT FIXED AS REPORTED, AND DELIBERATELY LEFT OPEN. VYTV was replayed and the '
      + 'real release function evaluated at every pass window in the game. Around action 56, where '
      + 'the report was filed, the chip released because Rashi put two items on the stack — which '
      + 'is exactly what the button promises. Closing this on the two fixes below would be the '
      + 'false closure this repo keeps catching. '
      + 'TWO REAL DERIVATION FAILURES WERE FOUND AND FIXED in the same code: activationKeys was '
      + 'EMPTY at all 107 pass windows of that game, so that release clause could not have fired on '
      + 'the reported behaviour at all (the #37/#46 shape), while six spell tokens and a castable '
      + 'card came out of resolutions and moved nothing; and the stack clause compared HEIGHTS, so '
      + 'a batch resolving the top and pushing a new item at the same height was invisible — three '
      + 'times for seat 0 in that game. The release set is now derived by exclusion. '
      + '⚠ DERIVING MAKES THE CHIP NOTICE MORE, NOT LESS. If the complaint is that it stops too '
      + 'often, the fix is a NARROWER PROMISE, and only the owner can name it: does a TRIGGER count '
      + 'as "something new is played", and should the chip keep passing once the player has said "I '
      + 'am done acting this battle"? Round-31 question sheet, Q6 — ANSWERED THERE THE SAME DAY, and '
      + 'the answer was three promises rather than a narrowed one. See `closed` above: it turned out '
      + 'the reason the middle promise could not be expressed was the R245 re-take, not any release '
      + 'clause, so this entry two "real derivation failures" were both true and neither was the '
      + 'headline. Leaving it open for one round to get the owner answer was the right call.',
  },
  {
    id: 117, area: 'client', severity: 'major', reportId: 124, cards: ['The Everywhere'],
    title: 'The Everywhere: naming a card is a full-pool list, and nothing records what was named',
    detail:
      'Printed: "[Augment] During [Haste] name a card. My last named card loses all abilities." The '
      + 'picker shows every card in the game as a flat list, and after the choice nothing on the unit '
      + 'says what it named — so the ability that depends on the name is unreadable at the table.',
    evidence: 'Report #124, room DSVQ 2026-08-29, actionIndex 71.',
    fix:
      'Reuse ui/cardsearch.ts — the card browser query language the owner is describing already '
      + 'exists, and writing a second search is how two projections of one idea start disagreeing '
      + '(ui/deckstats.ts header says exactly this). Then show the last named card on the unit.',
    proof: null,
    verify: 'Augment The Everywhere and try to name a card.',
    guards: [
      '226-log-and-naming.test.ts::§2a a 400-option naming menu is not 400 card scans',
      '226-log-and-naming.test.ts::§2b the default is what is standing on the board',
      '226-log-and-naming.test.ts::§2c every option the engine offered is still takeable',
      '226-log-and-naming.test.ts::§2d the whole-pool toggle widens the shopfront without touching the menu',
      '226-log-and-naming.test.ts::§2e a unit that has named a card says which one',
    ],
    closed:
      'FIXED 2026-08-29, and NO ENGINE FILE WAS TOUCHED. '
      + '⚠ THE CARD WAS NOT WRONG: batch-light-a.ts offering the whole pool is CORRECT — you may '
      + 'name any card — so the menu this entry called a bug is the rule. What was wrong is that '
      + 'the CLIENT rendered 490 card scans into a prompt bar. '
      + 'The filtered menu is triggered by the SHAPE of the question (more than 14 card-valued '
      + 'options), not by card name or decision kind, so every future name-a-card effect inherits '
      + 'it. ui/cardsearch.ts parser is reused over a pool built from that decision own options; '
      + 'the default is what is standing on the board, with a whole-pool toggle, and per BL-18 '
      + 'every option stays takeable in an expander. The second half shipped too: a unit wearing '
      + 'Entity.named says what it named, and "released a naming" reads differently from "never '
      + 'named".',
    status: 'done',
  },
  {
    id: 118, area: 'client', severity: 'major', reportId: 125,
    title: 'the game log is written for the engine, not for the players',
    detail:
      'The owner: it "almost seem[s] more like the game is clarifying things to itself rather than '
      + 'being useful to the players".',
    evidence: 'Report #125, room DSVQ 2026-08-29, actionIndex 85.',
    fix:
      '⚠ DO NOT JUST DELETE LINES. The detail is load-bearing for replay-room.ts forensics and for '
      + 'this ledger — several entries were settled by reading exactly these lines. A player-facing '
      + 'default with the forensic detail behind a toggle. And note CT-114, which says the log is not '
      + 'detailed ENOUGH where a player wants to audit what a card considered: readable is not shorter.',
    proof: null,
    verify: 'Play a turn and read the log as a player rather than as an engineer.',
    progress:
      'ROUND 31 — THE TOGGLE IS BUILT, THE VOCABULARY CUT IS NOT, AND THAT IS DELIBERATE. Shipped: '
      + 'Story (default) / Everything, h.log untouched, per-browser preference, a count of what is '
      + 'folded, and FAIL-OPEN on any line the client cannot classify — which is the whole backlog '
      + 'a networked client receives on join, so failing closed would have blanked it. The curtain '
      + 'is a per-EventType table beside the existing LOG_EVENT_CLASS, and the criterion is the '
      + 'owner own words: ECHOES (stackPushed / resolved / targeted / attacked / blocked — three '
      + 'lines for one ability) and step markers byte-identical every turn. '
      + '⚠ resourceActivated (19% of lines), recycle (14%), draw and phase were deliberately NOT '
      + 'curtained. Measured over three fuzzed games (3750 lines) they are 60% of the VOLUME, so '
      + 'cutting them is where the remaining win is — but each records a distinct thing a player '
      + 'did, which is not "the game clarifying things to itself". That is a vocabulary decision '
      + 'and it is Q3 on the round-31 sheet.',
    guards: [
      '226-log-and-naming.test.ts::§1a nothing is deleted — the story view is a strict subset of everything',
      '226-log-and-naming.test.ts::§1b the substantive lines of a real game all survive the curtain',
      '226-log-and-naming.test.ts::§1c the curtain fails open — a line the client cannot classify is always shown',
      '226-log-and-naming.test.ts::§1d the curtain says how much it is holding, and lifts on one click',
    ],
    closed:
      'ANSWERED AND CLOSED 2026-08-29. The owner on the round-31 sheet: "The toggle is fine, I '
      + 'think." So the curtain as built is the whole answer, and the deliberate omission is '
      + 'RATIFIED rather than outstanding: resourceActivated (19%), recycle (14%), draw and phase '
      + 'stay visible even though they are 60% of the volume, because each records a distinct thing '
      + 'a player did. The agent was right to stop rather than cut them.',
    status: 'done',
  },
  {
    id: 119, area: 'client', severity: 'minor', reportId: 126,
    title: 'no auto-stack for triggers whose order does not matter, and the chooser is a button list',
    detail:
      'Ordering N simultaneous triggers costs N decisions that usually do not matter, and the chooser '
      + 'is a list of extended buttons rather than the cards themselves.',
    evidence: 'Report #126, room DSVQ 2026-08-29, actionIndex 90.',
    fix:
      'An auto-stack button, and a click-the-card chooser. ⚠ RELATED TO BL-18 IN THE OPPOSITE '
      + 'DIRECTION: BL-18 is about suppressing shortcuts the client takes without asking, so the auto '
      + 'button must stay opt-in per decision and never become a default.',
    proof: null,
    verify: 'Get three triggers onto the stack at once and order them.',
    guards: [
      '225-stack-readout.test.ts::§3a the ordering bar offers auto-stack, and it sends the order the game listed',
      '225-stack-readout.test.ts::§3b auto-stack is opt-in — nothing goes out until it is clicked',
      '225-stack-readout.test.ts::§3c the ordering options are drawn as the cards they came from',
    ],
    closed:
      'FIXED 2026-08-29, and the BL-18 warning in this entry was held to. Auto-stack is opt-in PER '
      + 'DECISION — never a preference, never armed — latched by ui.orderAutoFor so a repaint '
      + 'cannot re-fire it, and §3b is the guard that says nothing goes out until it is clicked. '
      + 'The ordering options render as the CARDS they came from, derived from the same '
      + 'triggerQueue filter the engine builds AND answers the question with (R245), and are '
      + 'refused unless lengths and labels still match — so a stale paint falls back to labels '
      + 'rather than pinning a click to the wrong trigger.',
    status: 'done',
  },
  {
    id: 120, area: 'client', severity: 'major', reportId: 127,
    title: 'the attack UI offers attackers the engine then refuses',
    detail:
      'The owner saw the opponent apparently able to attack with units that had not been declared, '
      + 'then filed a retraction 37 seconds later: "it did not let her". So the ENGINE was right and '
      + 'the client drew a board that was not legal.',
    evidence:
      'Reports #127 and #128, room DSVQ 2026-08-29, actionIndex 92-93. The room replays 174/174 '
      + 'FAITHFUL, which is itself the evidence the engine was right.',
    fix:
      'Find where the attack affordance is computed and make it agree with legalActions. Same class '
      + 'as CT-115: the client model of legality and the engine disagree, and the player is the one '
      + 'who finds out.',
    proof: null,
    verify: 'Declare a partial attack and look at what the opponent client draws as attackable.',
    guards: [
      '223-client-legality.test.ts::[127] the attack affordance names exactly the units the engine would take',
      '223-client-legality.test.ts::[127] a unit the engine would refuse is not ringed and does not pick up on a click',
      '223-client-legality.test.ts::[127] the block step is the same question, asked of the defender',
      '223-client-legality.test.ts::[127] the region a formation leaves from has one derivation, not three',
    ],
    closed:
      'FIXED 2026-08-29 as R245 (a): an affordance is a claim about legality and it must be true. '
      + 'This entry was RIGHT, and the log confirms it exactly — DSVQ action 84 sent only entity 4, '
      + 'so round two attackerPool is [4], but canClick asked only step === declare && controller '
      + '=== attacker and lit her whole army. WIDER THAN THE REPORT: "Attack all" silently omitted '
      + 'the {Alluring} clause, and the region a formation leaves from had THREE derivations. '
      + 'ui/battle.ts formationCandidates is now the single answer, mirroring validFormation and '
      + 'checkBlocks, read by the ring, the unit click and Attack all alike. The block step is the '
      + 'same question asked of the defender and is guarded too. '
      + 'The guards never state a rule: they sweep every unit and every legal action and check the '
      + 'client against the ENGINE OWN VERDICT, each with a positive control.',
    status: 'done',
  },
  {
    id: 121, area: 'engine', severity: 'major', reportId: 129,
    title: 'a mod trash is credited to the mod owner, not the controller of the unit it is on',
    detail:
      'A mod is part of the unit it augments. DSVQ logged "Rashi trashes Malformed Monstrosity (from '
      + 'play)" for a Virus mod dying on BEN unit. engine.ts computes the trashing seat as '
      + 'modBin(m) = opts.binTo ?? m.owner and hands it to noteTrashed, which bumps the per-battle '
      + 'trashed:<seat> counter and fires the card own when-I-am-trashed trigger — so Muck Rummager '
      + '("When you trash a card during battle") and Dropslime ("the number of cards trashed in this '
      + 'battle") count for the wrong player. The bin DESTINATION is a separate question and owner '
      + 'still looks right there.',
    evidence:
      'Report #129, room DSVQ 2026-08-29, actionIndex 117, confirmed in the replay log: "Malformed '
      + 'Monstrosity augments The Everywhere (Ben) — it is now Unstable" then "Rashi trashes '
      + 'Malformed Monstrosity (from play)" then "Malformed Monstrosity is erased from the bin".',
    fix:
      'Attribution follows the HOST controller. And per R244 a mod erased with an Unstable host is '
      + 'not trashed at all — it never had a presence of its own. ⚠ R137 IS THE BOUNDARY AND IT '
      + 'STANDS: the BODY of an Unstable unit that dies is still trashed (that is what closed report '
      + '#93, and it overruled the printed reminder text and a direct Caleb ruling on purpose). Only '
      + 'the mods change. Derive the affected card set from printed text, never from the two cards in '
      + 'the report.',
    proof: () => /binnedMods\)\s*this\.noteTrashed\(modBin\(m\)/.test(ENGINE_SRC),
    guards: [
      '224-mod-trash.test.ts::R244: a nontoken mod erased with its Unstable host is not trashed at all',
      '224-mod-trash.test.ts::R244: a mod trashed on a recall is trashed by the host controller, not by its owner',
      '224-mod-trash.test.ts::R244 whole pool: no nontoken mod is trashed by its host death, and the body always is',
      '224-mod-trash.test.ts::R137 GUARD: the BODY of an Unstable unit that dies is still trashed, mods or no mods',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R244. '
      + '⚠ THIS ENTRY NAMED THE WRONG FIX SITE, and the agent said so rather than editing it. The '
      + 'death loop at engine.ts ~4646 only runs under keepBinned (Pull Under), which always passes '
      + 'binTo — so attribution and destination were ALREADY identical there and changing it is a '
      + 'no-op. The attribution half bites in afterDespawn, the RECALL and CACHE routes, which this '
      + 'entry never mentioned. '
      + '⚠ AND DROPSLIME WAS NEVER AN ATTRIBUTION CASE: it reads the battle-wide trashed counter, '
      + 'not trashed:<seat>. It is affected by the OTHER half — its damage now drops by one per '
      + 'nontoken mod on a dying modded unit. '
      + '⚠ THE TRAP THE PLAN HID: noteTrashed seat argument also computed R131 bin ref. Splitting '
      + 'attribution from destination naively would look for the card in the TRASHER bin, where an '
      + 'innocent older copy of the same name would answer and Cthyrian Rector would recall IT — '
      + 'R140 bug, one seat over. Hence an explicit binSeat that stamps nothing when the two differ. '
      + 'R137 is amended rather than left alone: R244 overrules its "The mods ride with it" section, '
      + 'which R137 had flagged as reasoning stated so it could be overruled cleanly. The BODY '
      + 'ruling and report #93 stand, and a guard reddens if the body stops trashing. '
      + 'Blast radius over 492 cards: 203 can become a nontoken mod, 200 of 200 lose the trashed '
      + 'event on host death, 200 of 200 change attribution on recall; four self-trashing graftable '
      + 'cards stop firing when their host is erased. '
      + 'Four existing test files asserted the old behaviour and were updated. In 35-rot-debt-trash '
      + 'the ORIGINAL TEST TITLE had to be restored: playtest-ledger.ts names it as report #93 guard '
      + 'by name, so renaming it reddened 70-playtest-ledger. That title is load-bearing. '
      + 'SURFACED, NOT FIXED, and worth a ruling one day: the BODY trash is attributed to u.owner '
      + 'while its mods are now attributed to u.controller, so an R8-stolen unit that dies trashes '
      + 'in its owner name and its mods in its controller name. No card in the pool distinguishes '
      + 'them today.',
    status: 'done',
  },
  {
    id: 122, area: 'client', severity: 'major', reportId: 130,
    title: 'a DERIVED X is never shown — on the stack or anywhere else',
    detail:
      'Retribution Thing prints "I deal X damage to target unit, where X is the life you have [lost '
      + 'or gained] in this battle". X is computed from game state, so there is no cast-time choice '
      + 'to echo, and the card sits on the stack promising an unknown number.',
    evidence: 'Report #130, room DSVQ 2026-08-29, actionIndex 141.',
    fix:
      '⚠ NOT COVERED BY THE #85 WORK EVEN THOUGH IT LOOKS IDENTICAL. #85 was Soul Siphon, a PAID X, '
      + 'previewed in hand by 96-x-preview.test.ts. This is a different family. The owner quantifier '
      + '("All cards with an X in them") is the class: derive the list from printed text rather than '
      + 'naming Retribution Thing, and show the current value on the stack.',
    proof: null,
    verify: 'Cast Retribution Thing and look at it on the stack.',
    guards: [
      '225-stack-readout.test.ts::§1a Retribution Thing wears its X on the stack, and it is the number it will deal',
      '225-stack-readout.test.ts::§1b the declared mode narrows the forecast to the half that was chosen',
      '225-stack-readout.test.ts::§1c a paid X still wins — the forecast never doubles it',
      '225-stack-readout.test.ts::§1d CENSUS — every card that can forecast an X forecasts it ON THE STACK too',
      '225-stack-readout.test.ts::§1e INVENTORY — every printed X is paid, worn by a token, forecast, or listed here',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R246 — a forecast is not a commitment, and a commitment always '
      + 'wins. This entry was RIGHT that it is a different family from #85, and WRONG about the '
      + 'seam: previewNote (which the brief suggested) is keyed on a live Entity, and a stack item '
      + 'is not one. The right hook was xPreviewRows — the one #85 already added for the hand chip '
      + '— now parameterised by the item own region, so there is ONE definition rather than a '
      + 'parallel mechanism. inspect.ts stackItemX was not wrong either: it reports what an item '
      + 'COMMITTED, and Retribution Thing commits nothing, so it correctly had nothing to say. '
      + 'The class is held two ways: a CENSUS over the pool, and an INVENTORY of the 18 printed Xs '
      + 'that are neither paid nor forecast, each carrying its reason plus a liveness test — so a '
      + 'new X card is caught rather than silently uncovered.',
    status: 'done',
  },

  {
    id: 123, area: 'client', severity: 'minor',
    title: 'the skip chip is invisible exactly while the throttle is holding',
    detail:
      'R150 HOLDS an update the player cannot act on, and a held update triggers no render at all. '
      + 'The "catching up (n) — ⏭ skip" affordance is drawn by that render, so while a standing '
      + 'pass is armed and the throttle is holding, the one control that would let you skip ahead '
      + 'is not on screen until something else happens to repaint. The S key still works, so the '
      + 'capability is present and only the affordance is missing.',
    evidence:
      'Found by the R251 agent while building test/230-pass-modes.test.ts — it made two of its own '
      + 'tests read the previous state until it added an explicit assertion that the throttle was '
      + 'empty. Not reported by the owner; surfaced by a test that had to work around it.',
    fix:
      'A held update should still be allowed to paint the throttle chip, or the hold should repaint '
      + 'once when it starts holding. ⚠ THE CONSTRAINT THAT MAKES THIS NON-TRIVIAL: R150 holds '
      + 'precisely so the client is never painting an old board while asking a live question, so a '
      + 'repaint here must draw the chip WITHOUT drawing the held state behind it. Read R150 before '
      + 'touching this — a naive render defeats the whole mechanism.',
    proof: null,
    verify:
      'Arm Pass all in a networked game during a long resolution and watch for the catching-up chip '
      + 'while the log is behind. The S key works; the chip is not drawn.',
    guards: [
      '237-live-while-held.test.ts::R258 the skip chip is on screen while the throttle is holding it back',
      '237-live-while-held.test.ts::R258 the held count is re-read at every arrival, not only at a release',
      '237-live-while-held.test.ts::R258 a held update moves the live slots and NOTHING else on the board',
      '237-live-while-held.test.ts::R258 the chip drawn during the hold really drains the throttle',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R258, and BOTH OF THIS ENTRY OWN GUESSES ABOUT THE CONSTRAINT '
      + 'WERE WRONG. (1) Staleness is not the hazard. R150 invariant is about asking a live '
      + 'question over a stale board, and a live question is un-holdable and FLUSHES first — so a '
      + 'repaint during a hold repaints the state already on screen. (2) The entry warned that a '
      + 'naive render would defeat the mechanism, and the brief said the reason was runAutoPass '
      + 'sending an action. It cannot: [59]/R245 latch it to one send per actionCount and a held '
      + 'update does not move actionCount. MEASURED — a render-instead-of-paint build puts nothing '
      + 'extra on the wire. What is actually wrong with a render there is what a render IS: a '
      + 'whole-page innerHTML plus hideHoverTip (which closes the card box the player is reading, '
      + 'once per held arrival at machine speed), gcStaleUi, planAutoPass, maybeCancelChain, '
      + 'publishBuilding, viewport snapshot/restore/rewire and a full motion/sound/beat pass, at '
      + 'exactly the rate R150 exists to stop. Telling the two candidate fixes apart needed a '
      + 'RENDER COUNTER in the driver — markup equality cannot do it. '
      + '(3) NO WAKE NEEDED BOOKING. The brief asked for one at the start of a hold; unnecessary, '
      + 'because pumpPace is where an ARRIVAL lands too (onMsg calls it straight after queueing), '
      + 'so patching there makes the chip appear synchronously with the hold. That also dodged the '
      + 'ui-driver setInterval trap entirely rather than working around it. '
      + 'THE FIX IS A LIVE SLOT: render() emits stable EMPTY host nodes and paintLive() writes '
      + 'them from pumpPace/flushPace, calling nothing. Blind time at every arrival rate measured '
      + 'goes to ZERO; at the 900ms gap the chip went from drawn ZERO times to nine. '
      + 'THE SIBLING IN THE SAME CLASS WAS PRESENCE (CT-133), fixed with it. '
      + 'VERIFIED BY BREAKING TWICE BY THE ORCHESTRATOR, and the second one is the one that '
      + 'matters: removing paintLive from pumpPace reddens six of seven (the seventh is a '
      + 'characterisation control and stays green); putting render() there instead — THE NAIVE FIX '
      + 'THIS ENTRY WARNED ABOUT — reddens exactly the two tests that assert a held update moves '
      + 'the live slots and nothing else. The guard can tell the right fix from the wrong one.',
    status: 'done',
  },
  {
    id: 124, area: 'client', severity: 'major', reportId: 131,
    title: 'the game log should be hidden by default and opened from the right-click menu as a modal',
    detail:
      'The log panel is always on screen. The owner wants it hidden, with a "View game log" item on '
      + 'the generic right-click menu opening a modal that functions exactly as the current log '
      + 'does. ⚠ THIS IS A MOVE, NOT A CUT: report #125 own Story/Everything filter was ratified '
      + 'this round ("The toggle is fine, I think", questions-round31.md Q3) and goes WITH the log '
      + 'into the modal.',
    evidence: 'Report #131, room PUCG 2026-08-29, actionIndex 123.',
    fix:
      'MEASURED 2026-08-29 by the round-32 audit. ⚠ THIS ENTRY OWN FIRST CLASS HINT WAS FALSE: it '
      + 'said the R150 "catching up — skip" chip lives in or beside the log panel. It does not. '
      + 'The chip is main.ts:4429 inside .topbar > .stickytop > .main (the LEFT column); the log '
      + 'panel is main.ts:4465 inside .side (the RIGHT rail). They share no ancestor below #app '
      + 'and hiding the log does not touch the chip. CT-123 is independent of this ticket. '
      + 'THE REAL CLASS IS 13, derived from the render template plus every CSS rule naming the log '
      + 'selectors. Inside #log: the h3 heading (a test anchor), the round-31 Story/Everything '
      + 'toggle (main.ts:4467, handler :6361, pref logVerbose :3801 — this MOVES with the log), '
      + 'the log rows, the .logcard spans carrying data-prev (ONE attribute feeding hover preview, '
      + 'long-hover text and RIGHT-CLICK INSPECT — the log is itself a right-click surface, so a '
      + 'modal must keep data-prev live inside it), and the .logcurtain footer. Beside it: the '
      + '.preview focus viewer sized against the log, the scenario panel, the .sidehead clocks and '
      + 'nine chrome buttons, the #app grid columns, and .glimpsenotice. '
      + 'THE MENU ENTRY POINT IS NOT IN main.ts. R241 puts the decision in inspect.ts:653 '
      + 'boardMenuEntries(); main.ts:7091 boardMenuItems() only renders it. Attaching only in '
      + 'main.ts reddens 216-menu-scoping.test.ts, which asserts label equality between the two. '
      + 'Add a third kind to BoardMenuEntry (inspect.ts:630) plus a go branch. '
      + '⚠ THREE THINGS THAT MAKE THIS BIGGER THAN IT LOOKS. (1) style.css:1119 makes the log the '
      + 'rail ONLY flex filler and .side is overflow:hidden — remove it and nothing absorbs the '
      + 'slack, which is the dead-space regression style.css:1053 records as already fixed once. '
      + '(2) .overlay.mainonly (style.css:650) exists so a dialog leaves the rail readable; that '
      + 'premise dies with the panel, and mainonly is the wrong modifier for a log modal anyway. '
      + '(3) THERE IS NO REUSABLE MODAL — ten call sites hand-write the same three classes, and '
      + 'each must also be hand-added to three parallel non-derived lists: the render slot list '
      + '(main.ts:4483), the Escape ladder (:7010) and overlayUp (:7039, which gates the S-skip '
      + 'and Space-pass hotkeys). This grows the eleventh. Model on helpOverlayHtml (:2653). '
      + '🔴 AND FIX A LATENT CRASH WHILE YOU ARE HERE: main.ts:4589 does '
      + 'getElementById("log")! unguarded on every paint, and test/ui-driver.ts:94 ABSENT does '
      + 'NOT list "log", so the stub returns an object and the suite stays green while a real '
      + 'browser throws. Guard 4589 AND add "log" to ABSENT, or the suite keeps hiding it.',
    proof: null,
    verify: 'Start a game: the log panel should not be on screen; right-click the field and choose "View game log".',
    guards: [
      '232-log-modal.test.ts::§1 the board no longer carries the log, and the rail is still a rail',
      '232-log-modal.test.ts::§2 the generic right-click menu opens it, and the menu decides that',
      '232-log-modal.test.ts::§2b Escape and Close both put it away',
      '232-log-modal.test.ts::§3 every affordance the modal emits is a live one',
      '232-log-modal.test.ts::§3b a card named only in the log is still right-clickable from inside the modal',
      '232-log-modal.test.ts::§4 the story toggle and its footer moved into the modal, both working',
      '232-log-modal.test.ts::§5 the rail did not become dead space, and the modal is still painted',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R253. ALL THIRTEEN of the class were carried; none dropped. '
      + 'The panel body was extracted WHOLE — same .logpanel, same #log, same heading, same '
      + 'Story/Everything toggle, same typed rows, same data-prev spans, same curtain footer — and '
      + 'wrapped in an overlay, so it is a move and not a re-authoring. The menu entry went into '
      + 'inspect.ts boardMenuEntries() per R241, which is WHY 216-menu-scoping needed no edit at '
      + 'all: its assertions are derived from that function, so the entry propagated into the '
      + 'bare-table menu and stayed out of the card menu by itself. '
      + '⚠ TWO PREMISES IN THE BRIEF WERE WRONG. (a) .overlay.mainonly is the RIGHT modifier, not '
      + 'the wrong one. Every card name in the log is a data-prev, and the hover preview those '
      + 'spans drive paints into #preview, WHICH IS IN THE RAIL — a full-bleed overlay would have '
      + 'the log own card-hover writing into a panel it was covering. Width comes from .logbox '
      + 'instead: 820px against the 290px column it left. (b) 226 logLines() was BROKEN, not '
      + 'merely mislocated: it sliced to the end of the document and only worked because whatever '
      + 'followed the panel happened to start with a div. In the modal the next thing is the Close '
      + 'button, and "Close" was landing on the end of the TAIL LINE — the line every one of those '
      + 'tests reads. '
      + '🔴 AND THE UNGUARDED getElementById("log")! WAS NOT POLISH. Measured three ways: guarded '
      + 'plus log on ABSENT passes 7; the unguarded ! plus log on ABSENT — which is what a real '
      + 'browser does — throws TypeError on every paint; the unguarded ! with log OFF ABSENT '
      + 'passes 7. That third row is the state the repo was in: GREEN OVER CODE THAT THROWS IN A '
      + 'BROWSER. Independently reproduced by the orchestrator. A second driver hole was found the '
      + 'same way — ui/anim.ts elFor uses CSS.escape and the fake page had no CSS global, reached '
      + 'only by the second and later beats of a paced batch. '
      + 'VERIFIED BY BREAKING BY THE ORCHESTRATOR: removing the menu entry reddens 13 tests across '
      + 'four files; dropping the log own data-prev reddens §3 and §3b — and §3 is the derived one, '
      + 'enumerating every data- attribute in the modal from the markup and firing each, so it '
      + 'convicts WITHOUT ANYTHING NAMING data-prev. '
      + 'TWO THINGS LEFT AND TICKETED RATHER THAN LOST: CT-134 (the log was the fallback surface '
      + 'for announcements with none of their own, and CT-55 is now behind a click — owner Q7) and '
      + 'CT-135 (this grew the ELEVENTH hand-maintained overlay; deriving the three parallel lists '
      + 'is real work because they are three different kinds of list and render order encodes '
      + 'z-stacking).',
    status: 'done',
  },
  {
    id: 125, area: 'client', severity: 'major', reportId: 132,
    title: 'a run of burst spells does not say how many are left or what sizes they are',
    detail:
      'Owner verbatim: "When casting a bunch of burst spells, it is very hard to tell how many you '
      + 'have left and of which sizes they are." {Burst} requires playing every token of the same '
      + 'name at once (Manual, TOKEN CARDS legend p.15), so a burst play is a run of identical '
      + 'things and the player loses count inside it.',
    evidence: 'Report #132, room PUCG 2026-08-29, actionIndex 132.',
    fix:
      'MEASURED 2026-08-29 by the round-32 audit, AND THIS ENTRY OWN FRAMING WAS WRONG TWICE. '
      + '(1) "Burst spells" IS NOT A SUB-FAMILY: burst === true and kind === "spellToken" return '
      + 'THE SAME THREE CARDS (Fireball, Poison, Crystal), so this is the whole spell-token '
      + 'surface and there is nothing to scope to. main.ts contains the string "burst" zero times. '
      + '(2) "OF WHICH SIZES" IS NOT MANA OR P/T — all three print mana 0 and 3/3. The varying '
      + 'quantity is X, carried PER ENTITY, and 29 printed cards mint them at X of 1, 2, 3, 5, 6 '
      + 'and five derived formulas. apply.ts:1006 groups the cast chain on t.card and IGNORES t.x, '
      + 'so Fireball 1 / 1 / 3 / 7 burst together as one uninterruptible chain of four '
      + 'differently-sized spells. That is the report exactly. '
      + 'TWO INDEPENDENT DEFECTS, not one: the token strip (main.ts:2153) is an unsorted filter in '
      + 'entity-id order under one aggregate count over three mixed names; and on the rules stack '
      + 'the X rides at the RIGHT end of .stacktag (main.ts:4014) which is the end the next card '
      + 'covers — from about six deep (main.ts:3952 step math, 30.4px sliver) every buried X is '
      + 'hidden. '
      + '⚠ DO NOT INVENT A BURST COUNTER. The answer already exists in this repo TWICE and has '
      + 'never been applied to an in-play zone: the ride-along chips (main.ts:3621) are a flat '
      + 'non-overlapping "name X=n" list, reachable only in declare-attack; and the deck-layout '
      + 'stacking (decklayout.ts:141 stackLayers/needsCountBadge, zero call sites in main.ts) '
      + 'draws copies as offset ghosts. Apply the existing pattern. Sibling surfaces with the same '
      + 'defect, derived: unit tokens created in multiples (no count at all — Spectrogenesis, '
      + 'Primordial Coalescence, Ralph, Legion of the Depths, Floral Singularity), the {Shard} '
      + 'resource row, bin thumbs, the invader strip and the incoming/sent strip.',
    proof: null,
    verify: 'Cast a burst spell with several tokens and look for a remaining count and their sizes.',
    guards: [
      '233-burst-count-and-size.test.ts::§1a every burst name you hold gets its own row, named, counted',
      '233-burst-count-and-size.test.ts::§1b a group of one name at different sizes prints every size — the report verbatim',
      '233-burst-count-and-size.test.ts::§1c the tiles are ordered so a burst group is contiguous and reads smallest first',
      '233-burst-count-and-size.test.ts::§1f a spell token that is NOT burst gets a row that does not claim the chain',
      '233-burst-count-and-size.test.ts::§2b every buried card wears its X where the overlap cannot reach it',
      '233-burst-count-and-size.test.ts::§2c the depth chip counts the run, so you can see how many are left',
      '233-burst-count-and-size.test.ts::§0a the spell-token KIND is a superset of burst — the container is not the rule',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R254. Both defects addressed: the token strip now sorts tiles '
      + 'name then X then id so a burst group is contiguous, with a tally above it reading '
      + '"Fireball x3 · X=1 x2 · X=3"; and the stack X moved out of .stacktag — where the kind '
      + 'word alone spent the 30.4px sliver visible at six deep — into its own left-anchored '
      + '.stackx. The depth chip reads "6 deep ↢ · Fireball x6" from the SAME tally. The string '
      + '"burst" appeared in main.ts zero times before this. '
      + '⚠ A PREMISE IN THIS ENTRY WAS FALSE AND IT IS THE REPO SIGNATURE BLINDNESS AGAIN. This '
      + 'entry said burst===true and kind===spellToken return THE SAME THREE CARDS. They are 3 vs '
      + 'FOUR: apply.ts registers a synthetic spell-token-kinded card, Alluring Attribute '
      + '(burst: false), so a rules-owned attribute effect is a registered card the retargeting '
      + 'spells can reach. It is INVISIBLE to a probe that imports only cards/registry.ts — the '
      + 'pool is 494 there and 495 once apply.ts has run — which is how the audit measured 3 and 3 '
      + 'twice and read that as confirmation. Two readings that share a premise are ONE piece of '
      + 'evidence. Independently re-measured by the orchestrator. '
      + 'IT CHANGED THE FIX: the strip filters on the KIND, so the row asks the CARD via isBurst() '
      + 'rather than assuming the container. Not a live bug today (that card never becomes an '
      + 'entity) but the row sentence would have been false about it. §0a is the tripwire, §1f the '
      + 'guard. '
      + 'Also corrected: 27 printed cards mint burst tokens, not 29; the literal X values in the '
      + 'pool are 1, 2, 5, 6 plus four derived formulas — there is no literal 3. '
      + 'SIX SIBLING SURFACES DELIBERATELY LEFT, with reasons: the tally wording is chain-specific '
      + '("clicking one casts ALL n"), so pasting it onto units or resources would state a rule '
      + 'that is false there. Each needs its own sentence and its own ticket. '
      + 'VERIFIED BY BREAKING BY THE ORCHESTRATOR: dropping the tally call reddens §1a, §1b and '
      + '§1f; dropping .stackx reddens §2b. The characterisation tests (§0a-§0d, §2a) stay green '
      + 'through both, which is what makes them controls rather than assertions.',
    status: 'done',
  },
  {
    id: 126, area: 'client', severity: 'minor', reportId: 133,
    title: 'the targeting arrow lands on top of the number it is pointing at',
    detail:
      'Owner verbatim: "When an effect is targeting a player, the arrow covers up their life '
      + 'total, making it impossible to read."',
    evidence: 'Report #133, room PUCG 2026-08-29, actionIndex 305.',
    fix:
      'MEASURED 2026-08-29 by the round-32 audit, in a real headless browser against the real '
      + 'style.css. arrowGeometry (anim.ts:485) is CENTRE TO CENTRE and HEAD_INSET is 7 '
      + '(anim.ts:456), so the opaque head occupies the band 7-17px back from the destination '
      + 'bounding-box CENTRE. The life pill is 52x24 with symmetric padding and its only content '
      + 'is the heart and the number, centred — the head cannot escape it horizontally. At 20 life '
      + 'the character at the geometric centre is a digit and the head covers a glyph from 8 of 8 '
      + 'incoming directions; at 100 life, always. '
      + '⚠ THE CLASS IS THREE OCCLUDING ENDPOINT KINDS, NOT ONE, and the rule that generalises is '
      + 'THE ARROW OCCLUDES WHATEVER TEXT A TARGET ELEMENT CENTRES. Every element that puts its '
      + 'number in a CORNER is 30-46px out and safe — a normal card .stats is 37.5px from centre, '
      + 'the cache count 30.8px, the bin count 46.2px. The three that centre their text: .life '
      + '(the report), .artfallback (a no-art card centres its NAME — style.css:454), and '
      + '.stackface (inset:0 and centred — for a triggered or activated ability that name is its '
      + 'ONLY label, and .stacktag is 44px away). The wrapping .promptbar is a partial fourth. '
      + 'A fix that nudges only the player arrow leaves the other three. '
      + '⚠ NOT THE HIGHLIGHT: every candidate highlight is an outline or outward box-shadow '
      + '(style.css:142, :56, :1486, :808) and covers no text. This is arrow-only. '
      + '⚠ TRIPWIRE: 70-playtest-round15.test.ts:243 asserts HEAD_INSET < 30 with the comment "an '
      + 'inset that could reach a card border is the old bug again" — it exists to defeat the '
      + 'naive "inset more" fix, and :226 pins the endpoints as exact centres.',
    proof: null,
    verify: 'Target a player with any effect and try to read their life total.',
    guards: [
      '234-arrowhead-clears-text.test.ts::[R255] every measured endpoint has an arrowhead that clears its text',
      '234-arrowhead-clears-text.test.ts::[R255] the head stops just short of the label, never far from the thing it points at',
      '234-arrowhead-clears-text.test.ts::[R255] arrowGeometry keeps aiming at the exact centre, and reports its own inset',
      '234-arrowhead-clears-text.test.ts::[R255] the fixtures are the bug: at the old inset the head sits on their text',
      '234-arrowhead-clears-text.test.ts::[R255] an endpoint with nothing legible in the middle is not moved at all',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R255, entirely inside anim.ts — no main.ts or style.css hunk '
      + 'was needed after all. Measured over CDP against the real style.css and a real demo board, '
      + 'independently of the audit run. '
      + '⚠ TWO PREMISES IN THIS ENTRY WERE WRONG AND THE BROWSER CORRECTED BOTH. (a) A STACK ITEM '
      + 'IS ONLY AN OCCLUDER WHEN ITS ART IS MISSING — .stackface measures a text rect on every '
      + 'stack card, but where the scan has loaded it is painted over and there is nothing '
      + 'legible. A stylesheet-only reading would have backed EVERY stack arrow off 12-19px on an '
      + '82px tile whose neighbours overlap it by about 39px, reintroducing the [26] ambiguity. '
      + 'That is why the fix HIT-TESTS rather than reads CSS. (b) THE BIN ZONE IS A FIFTH '
      + 'OCCLUDER, not safe at 46.2px as this entry claimed: the seat-1 bin measures 96x95.4 with '
      + 'its label ending 7px above centre. The taller seat-0 region does clear. '
      + 'THE RULE: the AIM never moves — the endpoint is still the destination exact centre, which '
      + 'is the owner own ZQPC decision that [26] pins. Only where the head STOPS moves, back just '
      + 'far enough to clear the text the destination actually shows, capped at one head-length '
      + 'past that element border; if the label cannot be cleared, HEAD_INSET wins, because '
      + 'pointing at the right thing beats parking outside it. An endpoint with nothing legible '
      + 'near its middle — every card with art — returns exactly HEAD_INSET and is untouched. '
      + 'Two-arg arrowGeometry is byte-identical, so [26] and its HEAD_INSET < 30 tripwire were '
      + 'not edited at all. '
      + 'VERIFIED BY BREAKING BY THE ORCHESTRATOR: making headStop return HEAD_INSET '
      + 'unconditionally reddens exactly the three assertions and leaves the three controls green, '
      + 'and 70-playtest-round15 stays green throughout. ⚠ ONE HONEST LIMIT, RECORDED BY THE '
      + 'AGENT: deleting the elementFromPoint filter reddens NO node test — it is browser-only, '
      + 'and the symptom is stack arrows backing off on art-loaded tiles.',
    status: 'done',
  },
  {
    id: 127, area: 'card', severity: 'major', reportId: 134,
    cards: ['Boon of Protection'],
    title: 'Boon of Protection can be aimed at an effect its printed text does not allow',
    detail:
      'Printed: "Negate target effect that targets an allied effect, player or unit." The '
      + 'qualifier is a property of the TARGET OWN targets, which is visible at cast time — the '
      + 'R64/R65 restriction seam (TargetSpec.restrict, slotRestricts, apply.castable, '
      + 'E.canFillSlot) exists to express exactly this. batch-wood-a.ts:195 instead lets any stack '
      + 'effect be chosen and makes the illegal case a no-op AT RESOLUTION, by deliberate comment '
      + 'citing a "Graxxlid/Minor Kraken precedent".',
    evidence: 'Report #134, room PUCG 2026-08-29, actionIndex 353.',
    fix:
      'MEASURED 2026-08-29 by the round-32 audit on a clean harness. THE PRECEDENT IS REAL AND THE '
      + 'COMMENT HAS IT BACKWARDS. R88 (docs/digital-rules.md:3673), from report #70, converted '
      + 'Graxxlid FROM a resolution check TO TargetSpec.restrict and states the general rule: '
      + '"the printed restriction is part of what makes a target LEGAL, not a condition checked '
      + 'once the spell resolves" — and it names Boon of Protection explicitly as asking the '
      + 'neighbouring question. Both cards the comment cites now do the opposite of what it '
      + 'claims: Graxxlid (batch-earth-a.ts:509) and Minor Kraken (batch-water-a.ts:927) each '
      + 'carry BOTH a cast-time restrict AND a resolution re-check. Boon of Protection has only '
      + 'the second half. '
      + 'NOT A REGRESSION. git log -S: the card and its comment landed together in fc8c9c6 '
      + '(2026-08-18); Minor Kraken gained restrict in 140de9b (R64, 08-21); Graxxlid in f15ed40 '
      + '(R88, 08-23); Boon was never revisited. Nothing to do with round 31 R244/R250, and the '
      + 'PUCG fork caveat is moot because it reproduces from a clean board. '
      + 'CLASS COMPUTED over 456 source blocks: 56 cards carry a qualifying clause on a target. 28 '
      + 'enforce it with a cast-time predicate, 25 have it carried by the target KIND or by '
      + 'cross-slot distinctness, 2 are if-clauses on the verb, and ONE is a resolution no-op on a '
      + 'relative clause. THE POOL SPLITS ON GRAMMAR: a relative clause modifying the target noun '
      + 'is a targeting restriction (28 of 29), an if-clause modifying the verb is a conditional '
      + 'effect (2 of 2). Boon of Protection is the single card on the wrong side of that line — '
      + 'the last member of a family already converted twice and missed. '
      + 'FIX: hoist the existing allied predicate into TargetSpec.restrict and KEEP the resolution '
      + 'check (R88: redirects and spent parts can break the restriction after cast; '
      + '85-silent-branches.test.ts:262 STACK_GONE must still speak). Fix the misleading comment '
      + 'at batch-wood-a.ts:190 — it is why this survived four rounds. THE GUARD IS THE PART THAT '
      + 'PAYS: a derived assertion in 68-target-conformance.test.ts over the whole pool, with the '
      + 'two if-clause cards as reasoned exemptions. 23-wood-a.test.ts:98 pins today no-op and '
      + 'must be rewritten to assert the target is not offered.',
    proof: null,
    verify: 'Cast Boon of Protection with a stack effect present that targets nothing of yours, and see whether it is offered.',
    guards: [
      '23-wood-a.test.ts::Boon of Protection: negates an effect aimed at something allied; an unallied one is not offered',
      '23-wood-a.test.ts::Boon of Protection: a Virus being applied to an allied unit IS an allied target',
      '68-target-conformance.test.ts::R256: every printed occurrence of target is read, not skipped',
      '68-target-conformance.test.ts::R256: a restrictive clause on a target noun is enforced at CAST',
      '68-target-conformance.test.ts::R256: the if-clause exemptions are exactly the cards that print one',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R256. Reproduced from a clean board first: the illegal stack '
      + 'item was the ONLY candidate offered, the mana was spent and the card binned for nothing. '
      + 'The fix hoists the allied predicate into TargetSpec.restrict and KEEPS the resolution '
      + 'check per R88, and replaces the comment that caused this — it claimed a '
      + '"Graxxlid/Minor Kraken precedent" for resolution-only enforcement when both those cards '
      + 'carry BOTH halves and R88 names this card explicitly. '
      + '⚠ THE FIX AS BRIEFED WOULD HAVE MADE A DOCUMENTED GAP PERMANENT. doAugment builds a Virus '
      + 'with parts: [], so the old parts[].targets read said a Virus targets nothing. Adding a '
      + 'restrict over that predicate unchanged would have stopped Boon of Protection being '
      + 'OFFERED against a Virus on your own unit — and R88 quotes the designer naming this exact '
      + 'card ("so you could Graxxlid or Boon of Protection it as well?" — "Yep! They are fully '
      + 'interactible."). The agent found it and added the Virus arm plus a test. '
      + 'THE GUARD IS THE PART THAT PAYS AND IT GENERALISES. It reads every printed occurrence of '
      + '"target" in the pool, strips the head noun, strips clauses the declared KIND already '
      + 'carries, and requires a cast-time predicate for what remains; the two if-clause cards '
      + '(Null Drone, Stellarspore Harvester) are asserted to be EXACTLY the exemption list, both '
      + 'directions. Against the blindness of a scrape that reads less than it should, a companion '
      + 'test asserts all 163 occurrences were CLASSIFIED with zero residue, and the list was '
      + 'cross-checked against a grep of restrict:/slotRestricts: — a different mechanism. '
      + 'VERIFIED BY BREAKING THREE TIMES BY THE ORCHESTRATOR. Deleting Boon own restrict reddens '
      + 'the guard and the card test by name. Removing the Virus arm reddens the Virus test. AND '
      + 'THE DECISIVE ONE: reverting Minor Kraken and Graxxlid to their PRE-RULING state — the '
      + 'literal historical code R64 and R88 were written to fix — reddens the same guard naming '
      + 'both. Written properly it would have caught all three reports on the day each ruling '
      + 'landed. '
      + 'One honest hole opened and named rather than hidden: the synthetic rig in '
      + '65-effect-conformance cannot build a stack that satisfies the new predicate, so Boon '
      + 'joins UNJUDGED with its reason — the same shape as the existing Riftwalker entry, which '
      + 'is R64 same case.',
    status: 'done',
  },
  {
    id: 128, area: 'coverage', severity: 'major',
    title: 'nothing notices when a question the owner has already answered still reads as open',
    detail:
      'questions-round31.md opened by listing five round-27 questions as unanswered. FOUR OF THEM '
      + 'HAD BEEN ANSWERED THE DAY BEFORE — Q2 by R237, Q5 by R238, Q6 by R240, Q8 by R239 — and '
      + 'R237 and R238 each name the question by number in their own first line. The sheets own '
      + 'ANSWER lines were never backfilled, so every list built by looking for a blank answer '
      + 'kept reporting them open. Round 32 opened believing two questions blocked it; the real '
      + 'number was five.',
    evidence:
      'Found by the round-32 orchestrator checking the carried-forward question list against the '
      + 'register before re-asking anything. Not reported by the owner — the cost falls on him '
      + 'silently, as attention spent twice or work parked for nothing.',
    fix:
      'A new guard, not a wider net on 202-settled-rulings — that file matches on CARD NAMES in a '
      + 'section marked "Already correct" and all four of these rulings are about MECHANICS, so it '
      + 'has nothing to match. Two halves: a DERIVED check that a ruling naming its question is '
      + 'believed by the sheet, and an INVENTORY of the remaining blanks so a person judges each '
      + 'one once.',
    proof: null,
    verify:
      'Blank an ANSWER line the register claims to have settled and run 238; it names the sheet, '
      + 'the question and the ruling line that contradicts it.',
    guards: [
      '238-question-sheets.test.ts::R259 §1: every question a ruling claims to answer has a non-blank ANSWER on its sheet',
      '238-question-sheets.test.ts::R259 §2: the blank answers on every sheet are exactly the inventory, no more and no fewer',
      '238-question-sheets.test.ts::R259 §3: every R-number an ANSWER line cites is a ruling that exists',
      '238-question-sheets.test.ts::R259 §4: the guard convicts the HISTORICAL state — round-27 Q2 blank while R237 claims it',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R259, the mirror of R234 / CT-101. R234 came from round 28 '
      + 'Q1, which re-asked a settled question and recommended reversing it, and stated the lesson '
      + 'as "a question sheet is not proof a thing is unruled". R259 states the other half: a '
      + 'BLANK ANSWER LINE IS NOT PROOF OF IT EITHER. '
      + '⚠ THE DERIVED HALF ONLY REACHES TWO OF THE FOUR, and that is the finding rather than a '
      + 'shortfall: a ruling is not obliged to say which question it answers, and R239 and R240 '
      + 'name none. So the INVENTORY carries the rest, and its second direction is the load-bearing '
      + 'one — when the owner answers something the file goes red and names it, which is the '
      + 'reminder to backfill the sheet. '
      + 'All four sheets are backfilled. The genuinely open list is five, not nine: round-27 Q4 and '
      + 'Q7, round-28 Q3, round-31 Q8, and the R250 zones question — re-asked together as '
      + 'docs/questions-round32.md. VERIFIED BY BREAKING BY THE ORCHESTRATOR against the HISTORICAL '
      + 'state: reverting round-27 Q2 to the bare word ANSWER in a scratch copy reddens §1 by name, '
      + 'quoting R237 own line back, and reddens §2 alongside it.',
    status: 'done',
  },
  {
    id: 129, area: 'client', severity: 'major', reportId: 118,
    cards: ['Brough'],
    title: 'the card browser attaches glossary rows off the TYPE LINE only, so an attribute granted in the text box shows no rules text',
    detail:
      'Owner verbatim, in the second half of the Q7 answer that R248 and R252 acted on: "Not all '
      + 'cards are done properly anyway: Brough … [Augment] Everything is balanced. (The power and '
      + 'defense of balanced units are equal to the greater of the two.) … Balanced is not '
      + 'actually in the text here." '
      + 'cardpanel.ts:119 filters GLOSSARY on r.attrs and r.keywords, and BOTH come from the type '
      + 'line: r.keywords is attrs plus augmentAttrs plus mechanicsOf(), and mechanicsOf '
      + '(cardindex.ts:144) is a FIXED NINE-ITEM list off booleans and two bracket regexes. It '
      + 'never scans the text box for an attribute name. Brough has empty attrs and grants '
      + '{Balanced} as a static from its text box, so the browser renders one row (Augment) while '
      + 'the in-game inspector renders two (Balanced, Augment) — the client has TWO glossary paths '
      + 'and the browser uses the wrong one.',
    evidence:
      'docs/questions-round31.md Q7 ANSWER, 2026-08-29. ⚠ NEVER TICKETED: round 31 built R252 from '
      + 'the first paragraph of that answer and left this paragraph and the Rot one on the floor. '
      + 'Measured by the round-32 audit; docs/17-oracle-text-audit.md §11 explicitly CLEARS '
      + 'Balanced printed wording, because it read printed text and never looked at the attach.',
    fix:
      'ONE LINE: switch cardpanel.ts:119 to the text-driven glossaryHits([r.type, r.text], '
      + '{skip: r.attrs}) that main.ts:2740 already uses in game. The panel has THREE hosts so the '
      + 'defect is on three pages — cards.ts:373, decks.ts:432, meta.ts:386. '
      + 'CLASS DERIVED TWO INDEPENDENT WAYS AND THEY AGREE AT 12: every card whose text names an '
      + 'attribute it does not carry on its type line. Brough (Balanced), Rotspore Herald '
      + '(Deadly), Emberflame Enlightener (Powerful), Envoy of Lightning (Electric), Auric '
      + 'Ascendant / Galerider Eel / Nimbus Eel (Flying), Pernicious Photosynthesis / Protective '
      + 'Adaptations / Blob of the Dark Order / Unrelenting Horror (Piercing), Inexorable Miasma '
      + '(Poisonous). Three of those print no reminder of their own, so the browser shows NOTHING '
      + 'about the attribute at all. Wider still: 358 cards name a glossary term in the text box '
      + 'but not the type line, the browser shows 328 and MISSES 141, and TEN glossary rows are '
      + 'never drawn on any card in the browser ever — Rot, Cache, Glimpse, Trash, Battle, Haste, '
      + 'Once, Recycle, Shard, Prismite. '
      + 'A NESTED 4-CARD SUB-CLASS IS WHAT THE OWNER PHRASING ACTUALLY NAMES: nine of the twelve '
      + 'tag the word with the {g} keyword marker (cardtext.ts:862, colour only, adds no row); '
      + 'FOUR do not tag it at all and render it as plain lowercase prose — Brough (balanced), '
      + 'Blob of the Dark Order, Inexorable Miasma, Unrelenting Horror. That half is an oracle-data '
      + 'change, not a client one. '
      + '⚠ AND THE IRONY BELONGS IN THE FIX: Brough is the ONLY card in the pool printing a '
      + '{Balanced} reminder, so R248 asShown took Brough own sentence as the game words for '
      + '{Balanced} — the browser now shows Brough sentence on Child of Aether and refuses to show '
      + 'it on Brough. '
      + '⚠ THE BUDGET A FIX INHERITS: 52-ui-glossary.test.ts:268 pins a pool-wide readability '
      + 'budget on glossaryHits (worst <= 8 rows, mean < 3). Measured, the switch takes the pool '
      + 'from 488 to 784 rendered rows, worst 4 (Bripp), mean 1.46 — it fits. '
      + '⚠ AND THE TEST THAT SHOULD HAVE CAUGHT THIS CANNOT: 227-reminder-text.test.ts:189 is the '
      + 'only whole-pool run of the panel and it only sweeps for leaked R-numbers behind a '
      + 'non-vacuity floor of 200 against a current 373 — it would stay green if the panel dropped '
      + 'every attribute row. Fix that floor too.',
    proof: null,
    verify: 'Open Brough in the card browser: it shows only the Augment row. The in-game inspector shows Balanced as well.',
    guards: [
      '236-browser-glossary-reach.test.ts::CT-129: the browser panel never explains less than the in-game inspector',
      '236-browser-glossary-reach.test.ts::CT-129: an attribute a card grants from its text box gets a reminder row',
      '236-browser-glossary-reach.test.ts::CT-130: every glossary row is reachable somewhere in the card browser',
      '236-browser-glossary-reach.test.ts::CT-130: rot is explained on every card that mentions it',
      '236-browser-glossary-reach.test.ts::R257: the panel is a UNION — the text scan is added to the type line, never swapped for it',
      '227-reminder-text.test.ts::R248: rendering every card in the pool leaks no R-number',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R257 — ONE LINE in cardpanel.ts glossaryFor, and it closes '
      + 'CT-130 with it rather than growing a second mechanism. Measured over the whole pool: the '
      + 'browser went from 488 reminder rows on 373 cards to 791 on 479, and from TEN glossary '
      + 'rows unreachable in the browser (Rot, Cache, Glimpse, Trash, Battle, Haste, Once, '
      + 'Recycle, Shard, Prismite) to ZERO. Worst card is still 4 rows (Bripp), mean 1.47, so the '
      + '52-ui-glossary readability budget of 8 and 3 is met with room. '
      + '⚠ THE BRIEF SAID SWITCH TO THE TEXT-DRIVEN PATH AND THAT WOULD HAVE BEEN A REGRESSION. '
      + 'The fix is a UNION: Prophecy on six cards and Debt on Hyper Beam reach the panel off a '
      + 'mechanicsOf boolean with the word nowhere in the printed text, so replacing the type-line '
      + 'path would have traded one blind spot for another — seven card/term pairs lost. '
      + 'AND THAT REASONING WAS UNGUARDED WHEN FIRST DELIVERED: the orchestrator planted the pure '
      + 'replacement and all seventeen tests passed, so the guard was sent back for. It now '
      + 'asserts the SUPERSET PROPERTY, derived each run, and additionally asserts that the '
      + 'type-line-only set is non-empty — so if that ever reaches zero the guard says it can no '
      + 'longer tell a union from a replacement, rather than passing. '
      + '⚠ THE CLASS IS 16 PAIRS, NOT THE 12 THE BRIEF DERIVED. Twelve is right for pure '
      + 'attributes; the other four (Abyssal Evocation and Spell Excavation for {Unstable}, Rook '
      + 'for {Virus}, Beyond Codex Incarnate for {Inverted}) have boolean paths, but these cards '
      + 'GRANT the term to something else so the boolean is off. Confirmed through two channels '
      + 'with different mechanisms — the registry through the glossary own matcher, and raw '
      + 'printed.json through a plain word-boundary regex with no engine — which differ by exactly '
      + 'one registry-only synthetic face. '
      + 'VERIFIED BY BREAKING THREE TIMES BY THE ORCHESTRATOR: the historical type-line-only filter '
      + 'reddens five tests by name; the pure replacement reddens the union guard and only it, '
      + 'naming its own seven pairs; the shipped union is green both times it is restored.',
    status: 'done',
  },
  {
    id: 130, area: 'client', severity: 'minor', reportId: 118,
    title: 'the {Rot} glossary row is never shown on any card in the browser, on any of its three pages',
    detail:
      'Owner verbatim, same Q7 answer: "Rot cards also do not have rules text yet." Measured: Rot '
      + 'is a PLAYER COUNTER (glossary.ts:277, ruling R38), not an attribute, subtype or card '
      + 'family. A glossary row exists and is correct — CT-80 audited its wording and cleared it. '
      + 'Fifteen cards mention rot in printed text and NONE carries Rot in attrs, which is exactly '
      + 'why the type-line attach never fires. The ? rules overlay shows it and the in-game '
      + 'inspector shows it on 15 of 15; the card browser, deck page and published-deck panel show '
      + 'it on 0 of 15.',
    evidence: 'docs/questions-round31.md Q7 ANSWER, 2026-08-29 — never ticketed. Measured by the round-32 audit.',
    fix:
      'THE DISPLAY HALF IS FIXED FOR FREE BY CT-129 — the text-driven attach finds Rot in the text '
      + 'box. Do not build a second mechanism. '
      + '⚠ ONE HALF NEEDS THE OWNER AND CANNOT BE ENGINEERED AROUND: 231-manual-text.test.ts:284 '
      + 'pins Rot at ZERO occurrences in the Algomancy Manual, and Rot is not an attribute so '
      + 'PRINTED_REMINDERS cannot see it either. The authored glossary.ts row is the ONLY statement '
      + 'of the Rot rule this repository has. If the report means "the browser never shows it", '
      + 'CT-129 closes it today. If it means "replace our words with the game words", there are '
      + 'none to substitute and he would have to write one. On the question sheet as round-32 Q6.',
    proof: null,
    verify: 'Open any of the 15 rot cards in the card browser and look for a Rot row. There is none.',
    guards: [
      '236-browser-glossary-reach.test.ts::CT-129: the browser panel never explains less than the in-game inspector',
      '236-browser-glossary-reach.test.ts::CT-129: an attribute a card grants from its text box gets a reminder row',
      '236-browser-glossary-reach.test.ts::CT-130: every glossary row is reachable somewhere in the card browser',
      '236-browser-glossary-reach.test.ts::CT-130: rot is explained on every card that mentions it',
      '236-browser-glossary-reach.test.ts::R257: the panel is a UNION — the text scan is added to the type line, never swapped for it',
      '227-reminder-text.test.ts::R248: rendering every card in the pool leaks no R-number',
    ],
    closed:
      'FIXED 2026-08-29 by R257 / CT-129, with no Rot-specific code at all — the text-driven attach '
      + 'finds Rot in the text box, which is the whole point of not building a second mechanism. '
      + 'The browser went from 0 of 16 index rows to 16 of 16. '
      + '⚠ ONLY THE DISPLAY HALF IS CLOSED. Whether the authored Rot sentence should be replaced by '
      + 'the game words is unanswerable here — 231-manual-text pins Rot at ZERO occurrences in the '
      + 'Algomancy Manual and Rot is not an attribute, so no printed reminder exists either; the '
      + 'glossary.ts row is the only statement of the rule this repository has, which is already '
      + 'the settled policy for the 21 rows in that position (R252 §3). That half is round-32 Q6 '
      + 'on the question sheet and needs the owner to write a sentence if he wants one.',
    status: 'done',
  },
  {
    id: 131, area: 'coverage', severity: 'major',
    title: 'the cross-ledger guard treated partial as live, so a half-fixed report could not be recorded honestly',
    detail:
      'playtest-ledger.ts has carried partial from the beginning, documented as "some of the report '
      + 'is done". But 83-card-todo cross-ledger check folded partial in with live on BOTH arms, so '
      + 'a report with one half done and one half open — the definition of partial — could not be '
      + 'expressed. Report #118 hit it: CT-111 shipped done with five guards while two observations '
      + 'in the same owner message sat uncaptured, and THE ONLY WAY TO KEEP THE SUITE GREEN WAS TO '
      + 'CALL THE WHOLE REPORT FIXED AND LOSE THE OPEN HALF. That is this repo signature failure — '
      + 'part of a complaint fixed, marked closed, the rest of the sentence lost, the #46 / #60 / '
      + '#75 chain — being actively recommended by a guard.',
    evidence:
      'Hit by the round-32 orchestrator while filing CT-129 and CT-130, which are the two halves of '
      + 'report #118 that round 31 left on the floor. Not reported by the owner.',
    fix:
      'Asymmetric arms: open todo plus fixed report is still a contradiction; done todo plus LIVE '
      + 'report is still a contradiction and now says so ("if only PART is done, the report is '
      + 'partial, not live"); done todo plus PARTIAL report is normal. Plus an earn-the-word check '
      + 'so partial cannot become a parking space.',
    proof: null,
    verify:
      'Restore the folded arm and CT-111 / report #118 convicts by name; close CT-112 and partial '
      + 'report #119 convicts under the earn-the-word check.',
    guards: [
      '83-card-todo.test.ts::every unanswered owner report is carried into the todo list, and none is invented',
    ],
    closed:
      'RULED AND FIXED 2026-08-29 as R260. ⚠ THE FIRST DRAFT OF THE EARN-THE-WORD CHECK WAS WRONG '
      + 'AND WAS CAUGHT WITHIN A SECOND OF RUNNING: it demanded a partial report have a done todo '
      + 'item of its own. Report #119 is legitimately partial at 0 done / 1 open, because what the '
      + 'owner wanted to do became possible under R250 but that work is booked under report #121 '
      + 'ticket. A REPORT CAN BE PART-FIXED BY WORK TRACKED ELSEWHERE. Demanding a same-report done '
      + 'entry would have forced either a lie or an invented bookkeeping ticket — a guard '
      + 'generating the paperwork it was supposed to check. The weaker true check survived: a '
      + 'partial must have something OPEN citing it. Second round running that a false positive on '
      + 'first run was worth more than the rule it produced (R234 was the other). '
      + 'VERIFIED BY BREAKING TWICE BY THE ORCHESTRATOR against the historical state.',
    status: 'done',
  },
  {
    id: 132, area: 'card', severity: 'minor',
    cards: ['Brough', 'Blob of the Dark Order', 'Inexorable Miasma', 'Unrelenting Horror'],
    title: 'four cards name an attribute in their text box without the {g} keyword marker, so it renders as plain prose',
    detail:
      'cardtext.ts:861 turns {g}word into a coloured keyword span. Twelve cards name an attribute '
      + 'they do not carry on their type line; EIGHT tag it with {g} and four do not, so the same '
      + 'word is a keyword on one card and lowercase prose on another. Brough "Everything is '
      + 'balanced", Blob of the Dark Order and Unrelenting Horror "piercing", Inexorable Miasma '
      + '"poisonous". {g} is colour only and adds no glossary row, so this is presentation '
      + 'consistency, NOT the missing-rules-text bug.',
    evidence:
      'Surfaced by the R257 agent while fixing CT-129, and it is the literal words of the owner '
      + 'Q7 answer — "Balanced is not actually in the text here" — once the rules-text half is '
      + 'discounted. Report #118 is closed and its rules-text halves are fixed; this is the '
      + 'cosmetic residue. Counted as EIGHT tagged, not the nine an earlier derivation claimed '
      + '(8 + 4 = 12).',
    fix:
      'An ORACLE DATA change, not a client one — tag the four words in the printed text. ⚠ DO NOT '
      + 'special-case them in a renderer; the whole point of {g} is that it is in the data. '
      + 'Derive the list rather than typing these four: every card whose text names a glossary '
      + 'term it does not carry on its type line, partitioned by whether the occurrence is already '
      + 'inside a {g} span. A guard written for these four goes stale the day a card is added.',
    proof: null,
    verify: 'Open Brough and Emberflame Enlightener side by side: one attribute word is coloured, the other is not.',
    status: 'open',
  },
  {
    id: 133, area: 'client', severity: 'major',
    title: 'a disconnect was throttled like game news, so the opponent could show as connected for twelve seconds after leaving',
    detail:
      'R150 holdable() answers exactly one question — could the player act on this? — and it never '
      + 'consulted peers. A disconnect arrives as an ordinary holdable update, so "opponent '
      + 'connected" could stand for up to PACE_MAX_HELD x PACE_MS = 12 SECONDS after they had '
      + 'gone. The presence dot and the "waiting for opponent" share banner are two surfaces of '
      + 'one source (main.ts:443), so both were wrong together. Presence is SESSION truth, not '
      + 'game news, and freezing it is not what the throttle is for.',
    evidence:
      'Found by the R258 agent while deriving the class for CT-123 — the question "what else '
      + 'freezes wrongly during a hold" had exactly one other answer. Not reported by the owner; '
      + 'the twelve-second window makes it easy to misread as the opponent thinking.',
    fix:
      '⚠ NOT BY WIDENING holdable(). Making a disconnect un-holdable would FLUSH THE ENTIRE '
      + 'BACKLOG — spending the pacing the player is relying on, for a reason unrelated to the '
      + 'game. R150 already gives them a skip for that and the client should not take it for '
      + 'them. Instead m.peers is hoisted into the un-held prefix beside m.clock, m.names and '
      + 'm.scenario, and painted by the same live-slot patcher as the skip chip.',
    proof: null,
    verify: 'Have the opponent close their tab during a long resolution with a standing pass armed; the dot should go dark at once.',
    guards: [
      '237-live-while-held.test.ts::R258 a disconnect that arrives while the throttle is holding is on screen at once',
      '237-live-while-held.test.ts::R258 a disconnect is not queued behind the backlog it arrived into',
    ],
    closed:
      'FIXED 2026-08-29 as part of R258, the sibling of CT-123 in the same class. The design call '
      + '— patch the slot rather than widen holdable — was the agent own and is argued in the '
      + 'ruling: holdable() is R150 whole safety argument and it should keep answering one '
      + 'question. VERIFIED BY BREAKING BY THE ORCHESTRATOR: removing paintLive from pumpPace '
      + 'reddens both guards above by name, and so does putting a full render() there instead for '
      + 'the first of them.',
    status: 'done',
  },
  {
    id: 134, area: 'client', severity: 'minor',
    title: 'the log was the fallback surface for announcements with no notice of their own, and it is now hidden',
    detail:
      'Report #131 hid the game log behind the right-click menu, which is what the owner asked '
      + 'for. But the log was ALSO where anything without a surface of its own ended up. CT-55 / '
      + 'report #66 was, in the owner words, about putting the unused-spell-token warning "in '
      + 'front of the player who lost the tokens", and the log is the only surface it was ever put '
      + 'on. The line still reaches the screen and 165-token-loss-warning still holds it down — '
      + 'what no longer holds is the phrase IN FRONT OF. Exactly one thing was ever promoted off '
      + 'the log for this reason: CT-78 glimpse, which got its own .glimpsenotice.',
    evidence:
      'Found by the R253 agent while moving the panel, and flagged in the CT-55 test body rather '
      + 'than papered over. Not reported by the owner — it is a cost of granting his own request.',
    fix:
      'BLOCKED ON AN OWNER RULING — round-32 Q7. Three options are on the sheet: leave it (one '
      + 'click away, minor case), give this one line its own notice the way the glimpse got one, '
      + 'or decide what a "the log is hidden but you need to see this" tier IS and move the handful '
      + 'of lines that qualify onto it. ⚠ DO NOT INVENT THE SECOND SURFACE UNASKED: which '
      + 'announcements deserve one is a product call, and getting it wrong means either a silent '
      + 'loss or a client that interrupts constantly.',
    proof: null,
    verify:
      'Lose spell tokens to regroup as a round-2 defender whose attacker declined: the '
      + 'announcement is only in the log, and the log is now shut.',
    guards: [
      '244-log-is-not-the-only-surface.test.ts::the decline route really did announce the loss to the log and to nothing else',
      '244-log-is-not-the-only-surface.test.ts::the loss is put in front of the player who lost it, in the promptbar area',
      '244-log-is-not-the-only-surface.test.ts::the pass route was never log-only: report 66 warning is already a promptbar confirm',
    ],
    closed:
      'FIXED 2026-08-30 as R266, and the owner answer went well past this ticket: "no warnings '
      + 'should only exist in the log. In fact, NOTHING should only exist in the log. Everything '
      + 'should be clear in the UI. The log is for checking past things." '
      + '⚠ HALF THIS ENTRY WAS WRONG, and it explains why the owner opened with "I do not know '
      + 'what warning you are talking about". The warning has TWO routes and only one was '
      + 'log-only. The PASS route has been a .promptbar confirm since R194, with Go back / Pass '
      + 'anyway — it was already in "the normal warning and choice area" he asked for. The DECLINE '
      + 'route was the log-only one: a round-2 attacker who declines goes doDeclareAttack -> '
      + 'endBattleRound -> startRegroup with no priority window, so there is no pass to hang a '
      + 'confirm on, and R194 ev(erased) reaches no other surface BY CONSTRUCTION — E.ev only '
      + 'feeds the R65 erased pile when the event carries cards, and a spell token is not a card. '
      + 'It is the one erase in the engine that reaches nothing. '
      + 'The notice identifies it BY SHAPE, not prose: erased + numeric seat + non-empty ids + NO '
      + 'cards. The missing key is the identifier, and it is the R65 gate itself. '
      + 'THE GENERAL SWEEP IS CT-142: 38 announcements are log-only, 20 of them costly, and 19 '
      + 'remain. Which of those deserve a surface is still a product call and was not guessed.',
    status: 'done',
  },
  {
    id: 135, area: 'client', severity: 'minor',
    title: 'a new overlay must be hand-added to three parallel lists, and nothing checks that it was',
    detail:
      'There is no reusable modal in this client: eleven call sites hand-write the same '
      + 'overlay/overlaybox markup, and each must ALSO be added by hand to three separate '
      + 'non-derived lists — the render slot list, the Escape ladder, and the overlayUp disjunction '
      + 'that gates the S-skip and Space-pass hotkeys. Miss the second and Escape does not close '
      + 'it; miss the third and a hotkey fires through it into the game.',
    evidence:
      'Named by the R253 agent, which grew the ELEVENTH entry rather than fixing this — correctly, '
      + 'since deriving them is not a side-effect of a ticket about the game log.',
    fix:
      '⚠ NOT A SIMPLE SWEEP, and the agent reason for stopping is the reason to read before '
      + 'starting: the three lists are three different KINDS of list — markup order, priority '
      + 'order, and a boolean disjunction — and the render slot order encodes z-stacking, so a '
      + 'naive single source of truth would silently restack the dialogs. Derive what can be '
      + 'derived and assert the rest; a guard that says "every overlay appears in all three" is '
      + 'worth having even if the lists stay separate.',
    proof: null,
    verify: 'Add a new overlay and forget the Escape ladder: nothing fails, and Escape does not close it.',
    status: 'open',
  },
  {
    id: 137, area: 'engine', severity: 'minor',
    title: 'three per-seat destinations still read owner while their neighbour read controller',
    detail:
      'R250 ruled that a trashed stolen card goes to the CONTROLLER bin, and deliberately left '
      + 'recall (to hand), cacheUnit (to cache) and eraseMod (to the R65 erased pile) reading '
      + 'owner, because each is a power change rather than a tidy-up. One seam reading owner while '
      + 'its neighbour reads controller is how a card that can finally tell them apart gets it '
      + 'wrong once and quietly.',
    evidence:
      'Round-32 Q2, the owner: "(a) All four follow control — one rule, no seam. Only exception is '
      + 'that owner in constructed is always the person who brought the card to the game."',
    fix: 'Change the three defaults to u.controller / mod.controller. Leave opts.to alone — it is '
      + 'how a card whose PRINTED text names a destination says so (Cosmic Reversal).',
    proof: null,
    verify: 'Steal a unit, recall it, and check it lands in the thief hand.',
    guards: [
      '246-zones-follow-control.test.ts::R262 §1: a stolen unit recalled goes to the THIEF hand, not the owner',
      '246-zones-follow-control.test.ts::R262 §5: the erased pile files a stolen mod under the THIEF',
      '246-zones-follow-control.test.ts::R262 §4 CONTROL: an unstolen unit is unchanged, so the sweep is not a no-op rewrite',
    ],
    closed:
      'FIXED 2026-08-30 as R262. ⚠ THE WHOLE SUITE STAYED GREEN AFTER THE CHANGE AND THAT WAS NOT '
      + 'GOOD NEWS: for any unit nobody has stolen owner === controller, so every existing test is '
      + 'a positive control for the case that did NOT change and none covered the case that did. A '
      + 'change no test can see is a change nothing will keep — the next person to simplify it back '
      + 'would have got a clean run. 246 is the file that makes it visible; every fixture builds a '
      + 'real theft through E.giveControl and asserts owner !== controller before testing anything. '
      + 'VERIFIED BY BREAKING: each default reverted individually reddens exactly its own section '
      + 'and leaves the three controls green.',
    status: 'done',
  },
  {
    id: 138, area: 'card', severity: 'minor',
    title: 'a card played mid-resolution carried no source zone, so Proph and Stalwart Sentinel fired for nobody',
    detail:
      'R49 gives a played card a `from` marker so "when you play a card from anywhere other than '
      + 'your hand" is a field read rather than a log scan. playInline, the shared helper for a '
      + 'mid-resolution play, threaded it on neither of its two paths, so those plays carried a '
      + 'blank — read as neither hand nor elsewhere, firing for nobody rather than for someone.',
    evidence:
      'Round-32 Q3 (carried from round-27 Q4), the owner: "It matters WHERE they come from. If the '
      + 'card originates in the hand, it is played from the hand. If it originates from the cache '
      + 'or bin or somewhere else, it is not played from the hand."',
    fix: 'Thread the originating zone through playInline and set it at each call site.',
    proof: null,
    verify: 'Play Tides of the Cosmos with a Proph out; Proph should draw.',
    guards: [
      '241-played-from-zone.test.ts::R263 §1: every mid-resolution play names the zone it came out of',
      '241-played-from-zone.test.ts::R263 §5: Tides of the Cosmos plays off the top of the deck, so Proph draws and the Sentinel grows',
      '241-played-from-zone.test.ts::R263 §7: an effect-created token carries no zone at all, so neither watcher fires',
    ],
    closed:
      'FIXED 2026-08-30 as R263. TWO CORRECTIONS FROM THE AGENT, both worth keeping. (1) It is '
      + 'THREE cards, not the four the brief named — Spell Excavation stopped being a '
      + 'mid-resolution play at R197, which turned it into a GRANT, and there was nothing to fix '
      + 'there. (2) A FIFTH ZONE was needed: Tides of the Cosmos plays off the REVEALED TOP OF THE '
      + 'DECK, which none of hand/cache/bin covers, and the owner "or somewhere else" reaches it. '
      + 'The agent refused to force it into one of the three and asked for the union to be widened '
      + 'instead; the orchestrator widened types.ts and spawnUnit and deleted the local cast that '
      + 'had been bridging the gap. `from` is now a REQUIRED field of a REQUIRED opts parameter, so '
      + 'the compiler asks the fourth caller the question rather than a hand-typed list of names.',
    status: 'done',
  },
  {
    id: 139, area: 'engine', severity: 'minor',
    title: 'two gates asked the ally question with a spec they built themselves, and agreed only by luck',
    detail:
      'R64/R65 turn on ONE predicate being asked in every place that judges a target. Two places '
      + 'broke that: the Ambush legality gate hand-built { what: allyUnit } instead of asking '
      + 'ambushEffect(name).targets, and ui/inspect.ts activationNeedsConfirm re-asked '
      + 'targetCandidates WITHOUT sourceId while apply.ts abilityUnusable passes it. Neither is '
      + 'visible today: the generated Ambush spec has no restrict, and nothing in the pool is both '
      + 'irreversible-cost and source-sensitive.',
    evidence:
      'Found by the R265 agent while measuring the ally family for round-32 Q5. Not reported by the '
      + 'owner and not visible to a player — which is exactly how long it could have sat.',
    fix: 'Ask the real spec through specForSlot in both gates, and thread unit.id in inspect.ts.',
    proof: null,
    verify: 'Give the ambush spec a restriction; the mode should stop being offered when no ally passes it.',
    guards: [
      '243-ally-and-enemy-scope.test.ts::R265 §4a the ambush legality gate asks for the same ally the ambush effect will',
      '243-ally-and-enemy-scope.test.ts::R265 §4b2 the irreversible-cost warning reads the source the real gate reads',
    ],
    closed:
      'FIXED 2026-08-30 alongside R265. ⚠ THE AGENT GUARDS DID NOT HOLD ITS OWN FIXES, and the '
      + 'orchestrator only found that by planting the historical defect: both §4a and §4b were '
      + 'TRIPWIRES over the pool (assert the spec has no restrict; assert no card is on both sides '
      + 'of the seam) and each passed IDENTICALLY before and after the fix. A guard that cannot '
      + 'tell the fixed engine from the broken one is not holding anything. Both were rewritten as '
      + 'BEHAVIOURAL checks that plant a restriction in memory and watch the real gate answer, and '
      + 'each was then confirmed red against HEAD and green against the fix. Writing §4a also '
      + 'reproduced the failure it is about: the first draft asserted `offered >= 0` on a '
      + 'deployment board, which is true of every number, so it passed against the unfixed engine '
      + 'too — an empty subject set reading exactly like a working check, in the very file whose '
      + 'subject is two places agreeing for the wrong reason.',
    status: 'done',
  },
  {
    id: 140, area: 'client', severity: 'major', reportId: 66,
    title: 'the unused-spell-token loss reached the game log and no other surface',
    detail:
      'Report #131 hid the log behind a right-click menu item. The log had been the client fallback '
      + 'surface for any announcement with no notice of its own, and the decline route of the '
      + 'unused-spell-token warning was relying on it: a round-2 attacker who declines goes '
      + 'doDeclareAttack -> endBattleRound -> startRegroup with no priority window, so there is no '
      + 'pass to hang a confirm on. R194 ev(erased, ...) went to the log and nowhere else — by '
      + 'construction, since E.ev only feeds the R65 erased pile when the event carries cards, and '
      + 'a spell token is not a card.',
    evidence:
      'Round-32 Q7, the owner: "no warnings should only exist in the log. In fact, NOTHING should '
      + 'only exist in the log. Everything should be clear in the UI. The log is for checking past '
      + 'things. So this warning about spell tokens should be in the normal warning and choice '
      + 'area, where all the normal buttons are."',
    fix: 'Identify the announcement by SHAPE, not prose, and render it in the prompt slot.',
    proof: null,
    verify: 'Decline a round-2 attack with unused spell tokens; a notice should appear by the buttons.',
    guards: [
      '244-log-is-not-the-only-surface.test.ts::the decline route really did announce the loss to the log and to nothing else',
      '244-log-is-not-the-only-surface.test.ts::the loss is put in front of the player who lost it, in the promptbar area',
      '244-log-is-not-the-only-surface.test.ts::one of the thirty-eight now has a surface, and the client really draws it',
    ],
    closed:
      'FIXED 2026-08-30 as R266. ⚠ HALF THE PREMISE WAS WRONG AND IT EXPLAINS THE OWNER OWN '
      + 'CONFUSION. He answered "I do not know what warning you are talking about" — because the '
      + 'PASS route was never log-only: it has been a promptbar confirm since R194, with Go back / '
      + 'Pass anyway. Only the DECLINE route was log-only, and it is the one erase in the engine '
      + 'that reaches no existing surface. Supersedes CT-134. The agent also found the type-level '
      + 'sweep gives the WRONG ANSWER — erased has non-log consumers, so a per-EventType inventory '
      + 'scores it surfaced and loses the exact case the ruling is about; the workable unit is the '
      + 'call site. See CT-142 for the 19 that remain.',
    status: 'done',
  },
  {
    id: 141, area: 'client', severity: 'major', reportId: 118,
    title: 'the glossary could only see the game words in one of the two places the pool writes them',
    detail:
      'printedReminders() recognised a {i}(...) span as a reminder for term T only when THE SPAN '
      + 'CONTAINS T. The pool has a second convention, where the keyword is printed as the ability '
      + 'and the parenthetical explains it without repeating the word — "Glimpse 1 {i}(Reveal the '
      + 'top card ...)". Three rows sat behind their own cards. Separately, both R248 and R252 '
      + 'channels are BASE-GAME channels, so every Light and Dark row was structurally certain to '
      + 'fall through to the authored sentence whatever the game said.',
    evidence:
      'Round-32 Q6, the owner: "Rot has now been added. So this question should[nt] exist since it '
      + 'is answered." Round 32 had told him, in bold, that there were no game words for Rot to be '
      + 'added FROM. There were.',
    fix: 'Teach the scan the second convention, derive the candidate set, review each verdict, and '
      + 'add the card-library channel for the rows neither the pool nor the manual speaks to.',
    proof: null,
    verify: 'Open the card browser on Foretell; the {Glimpse} row should read the card own words.',
    guards: [
      '245-printed-reminder-reach.test.ts::R267: every convention-B candidate the pool produces has a reviewed verdict',
      '245-printed-reminder-reach.test.ts::R267: each accepted convention-B reminder is printed on a real card, verbatim',
      '245-printed-reminder-reach.test.ts::R267: every card-library sentence is quoted verbatim from the file it cites',
      '245-printed-reminder-reach.test.ts::R267: the four channels partition the glossary, and the split is pinned',
    ],
    closed:
      'FIXED 2026-08-30 as R267. Four rows moved: {Glimpse} (R252 §3 had called it "the ONLY '
      + 'statement of the rule this repository has" — four cards print one), {Unstable} (R252 §4 '
      + 'read the MANUAL, judged it inadmissible, and never asked whether a card printed one — two '
      + 'do), {Ambush} (R252 §1 took the manual sentence while six cards print a shorter one, and '
      + 'R252 own PRINTED BEATS MANUAL hands it to the cards), and {Rot}. THE LESSON: a list of '
      + '"things the game is silent about" is a claim about a SCAN, not about the game. 231 '
      + 'OCCURRENCES map recorded Glimpse: 0 and Rot: 0 and those zeros were read for three rounds '
      + 'as "the game says nothing" when all they meant was "the MANUAL says nothing". Sharper '
      + 'still: 227 silent-row check opens with a comment boasting DERIVED, not enumerated, and '
      + 'then hard-types eleven terms as a control, one of which was {Unstable}. The derived half '
      + 'was right the whole time; the typed control was the wrong half.',
    status: 'done',
  },
  {
    id: 142, area: 'client', severity: 'major',
    title: 'nineteen announcements still reach the game log and no other surface, and they cost the player something',
    detail:
      'Derived over the 193 structural ev() sites in engine.ts and apply.ts: 38 reach no surface '
      + 'but the log, of which 20 were ranked as costing the player something irreversible. One was '
      + 'fixed as R266. The remaining 19, worst first: a spell FIZZLES (x2 — and main.ts:4349 '
      + 'labels a fizzled stack item "resolved", so the client says the opposite of the truth); a '
      + 'cost cannot be paid so that effect is SKIPPED (x5); a trigger prevented by a tax (x2); a '
      + 'declined [cost] and a copy not made (x2); no legal target so it does nothing; a paid-for '
      + 'discount expiring unused (Deferral Drone); life lock (x2); no damage through a column; '
      + 'nothing is lured.',
    evidence:
      'Derived by the R266 agent from the owner ruling that NOTHING should only exist in the log. '
      + 'The type-level sweep is the wrong unit and gives the wrong answer — 26 of 48 announcing '
      + 'EventTypes have a non-log consumer, including erased, so it scores the R266 case as '
      + 'surfaced. The escape hatch is `info`: no colour, no curtain, no consumer.',
    fix:
      '⚠ WHICH OF THE 19 DESERVE A SURFACE IS A PRODUCT CALL AND WAS DELIBERATELY NOT GUESSED. The '
      + 'owner ruling is absolute in principle; the question he has not been asked is whether that '
      + 'means 19 new notices, a toast tier they share, or something between. Ask before building. '
      + 'The fizzled-item mislabel is the exception — the client asserting "resolved" about a thing '
      + 'that fizzled is wrong on its own terms and needs no ruling. ITS ROUTE, scoped '
      + '2026-08-30 and deliberately NOT built in the same round as seven rulings: '
      + 'ui/main.ts:4329 reads `r.flashing ? (it.negated ? "answered" : "resolved") : ""`, so '
      + 'a fizzle — which is not a negation — falls through to "resolved". Both engine fizzle '
      + 'sites (engine.ts:8498 and :8584) already emit ev(fizzled, ..., { id: item.id }), the '
      + 'SAME shape the negated event emits, so the template is exactly ui/flash.ts negatedIds '
      + 'plus negatedFlashItems: a fizzled item has LEFT the stack, so the client must draw it '
      + 'from `seen` — its memory of what it last drew — and stamp the copy, the way E.negate '
      + 'stamps its own detached copy. Needs a third row state beside flashing/resolving/'
      + 'negated, a .fizzled class in style.css, and a guard that the states stay mutually '
      + 'exclusive.',
    proof: null,
    verify: 'Fizzle a spell by removing its only target in response; the stack entry reads "resolved".',
    status: 'open',
  },
  {
    id: 143, area: 'engine', severity: 'minor',
    title: 'a card played mid-resolution in place fires no cardPlayed at all, so the wide watchers are deaf to it',
    detail:
      'R198 says a card played mid-resolution goes on the stack and is respondable. playInline in-'
      + 'place path predates that and still spawns in place, firing spellPlayed and spawned but no '
      + 'cardPlayed — so R129 wide watchers (Void Mandible, Bloomcaster) never hear the play. R207 '
      + 'recorded the divergence; R263 threaded the source zone through the same path and left it '
      + 'standing.',
    evidence: 'Flagged by the R263 agent, which declined to fix it: "changes which cards trigger on '
      + 'plays nobody ruled on this round".',
    fix: 'Making it an item is a much larger change than it looks — a spawn is not a cast and there '
      + 'is no cast window to declare it in. Read R207 before starting.',
    proof: null,
    verify: 'Play a unit out of a bin during battle with a Void Mandible up; it cannot answer.',
    status: 'open',
  },
  {
    id: 144, area: 'engine', severity: 'major',
    title: 'the ruling-register guard had a hand-set ceiling that switched it off for seventeen rulings',
    detail:
      'test/184-ruling-register.test.ts citedRulings ended `.filter(n => n >= 1 && n <= 250)`, with '
      + 'a comment saying the ceiling was "the register own highest number". That stopped being '
      + 'true at R251, so every citation of R251 through R267 — the whole of rounds 31, 32 and 33 — '
      + 'was dropped BEFORE it reached the "a cited number must resolve" check. The guard did not '
      + 'fail; it had nothing left to look at.',
    evidence:
      'Found by the R261 agent while checking whether its own ruling number resolved. Proven '
      + 'immediately on fixing: 184 went red naming R261 as a dangling citation, which it had been '
      + 'unable to see a moment earlier.',
    fix: 'Bound it at 999, the most the \d{1,3} regex can produce, so there is nothing left to keep '
      + 'in step. A citation ABOVE the register max is not "out of range" — it is precisely the '
      + 'dangling reference the file exists to catch.',
    proof: null,
    verify:
      'Cite a three-digit ruling number far above the register max in a source comment; 184 '
      + 'should name it as a new gap. (Writing that number literally HERE trips the same guard — '
      + 'which is the shortest possible demonstration that the ceiling is gone.)',
    guards: [
      '184-ruling-register.test.ts::R215 §2: every R-number cited in the tree resolves to a register entry, or is on the ledger',
    ],
    closed:
      'FIXED 2026-08-30. A hand-set bound that has to be maintained is a bug even while it is '
      + 'correct — this is the empty-subject-set failure of docs/13 §5 wearing a different hat, and '
      + 'it had been silently true for two whole rounds of rulings.',
    status: 'done',
  },
  {
    id: 145, area: 'engine', severity: 'minor',
    title: 'the R117 sub-step gate is dead code and no test can tell',
    detail:
      'E.strikesInCurrentSubStep is the gate R117 and R157 §5 are written on: it answers "does my '
      + 'column strike in the sub-step that is running?" and is asked from when(), at event time. '
      + 'Replace its body with `return true` and NOTHING in the tree notices — not '
      + '134-column-and-substep, the file named after it, not 53-playtest-round7, not '
      + '115-literal-light, not 239. Measured across the FULL suite with the gate disabled and '
      + 'again with it restored: 25 failures either way, the same 25 titles. '
      + '⚠ THE BEHAVIOUR IS CORRECT, and that is the point — R195 gave the aggregated lifeLost a '
      + 'per-column breakdown, and faceDamageDealtBy answers "is this my sub-step" on the way to '
      + '"is this my damage". Either mechanism alone holds R117; only removing BOTH moves a '
      + 'number. So the gate is redundant, not wrong.',
    evidence:
      'Found by the agent converting the tests R261 broke, and confirmed by the orchestrator with '
      + 'two full-suite runs. R261 first shipped with a paragraph justifying R117 by pointing AT '
      + 'this gate; that attribution has been corrected in the ruling.',
    fix:
      '⚠ NOT "delete it" — decide which mechanism is the spec, then make the other checkable. A '
      + 'guard belongs in 134-column-and-substep that fails when the method stops discriminating: '
      + 'the cheapest honest one asserts the method itself returns false for a column that is NOT '
      + 'striking, which no current test asks it. If the R195 breakdown is the real spec, say so '
      + 'in R117 and leave the gate as belt-and-braces WITH that guard; if the gate is the spec, '
      + 'something has to exercise it through behaviour.',
    proof: null,
    verify: 'Replace the body of E.strikesInCurrentSubStep with `return true` and run the suite: '
      + 'it is entirely green.',
    status: 'open',
  },
  {
    id: 146, area: 'engine', severity: 'minor',
    title: 'R121 now taxes combat-damage triggers, and fixtures that use Crevice Lurker as scenery pass for the wrong reason',
    detail:
      'R261 routes combat-damage triggers through the battle-mode stack, so R121 gateTaxedTrigger '
      + 'now runs for them — correctly, since Crevice Lurker prints "during battle" and combat '
      + 'damage is during battle. The side effect: any fixture that happens to contain a Crevice '
      + 'Lurker now taxes its combat-death triggers [1], and a controller with no mana has the '
      + 'trigger PREVENTED outright rather than delayed. Two tests in 25-wood-c broke this way and '
      + 'were fixed by giving the fixture one resource, with no expected value moved.',
    evidence:
      'Found by the R261 test-sweep agent, which named the risk rather than only fixing its two '
      + 'cases: "Crevice Lurker is used as scenery elsewhere; a fixture that only asserts nothing '
      + 'bad happened now passes for the wrong reason."',
    fix:
      'Derive it: find every fixture that spawns Crevice Lurker, and for each, check whether the '
      + 'test would still fail if its subject trigger were prevented. The ones that only assert an '
      + 'absence are the ones at risk. A cheaper first cut is a guard that fails when a trigger is '
      + 'PREVENTED inside a test that never mentions the tax.',
    proof: null,
    verify: 'Put a Crevice Lurker in a combat fixture with no open mana; the death trigger never happens.',
    status: 'open',
  },
  {
    id: 147, area: 'engine', severity: 'minor',
    title: 'an UNREACHED promise went stale because R261 made it reachable, and nothing sweeps for that',
    detail:
      'test/unreached.ts lists card promises the scenario fixtures cannot reach. R261 gives combat '
      + 'triggers a real stack resolution window, so ownResolution can finally attribute their '
      + 'payload — Cinder Scuttler is now observed delivering, and its UNREACHED entry is a lie. '
      + '84-card-semantics caught exactly this and named the entry, which is the system working; '
      + 'what is missing is that the list only ever gets LONGER by hand.',
    evidence:
      'The R261 sweep agent proved it by experiment rather than inference: sandboxed the tree, '
      + 'restored src/engine.ts from HEAD, and showed 84-card-semantics green on the old engine '
      + 'and red on the new. It left the edit alone because unreached.ts is not a .test.ts and was '
      + 'outside its territory.',
    fix:
      'Delete the Cinder Scuttler entry. Then the real work: 84 already fails when an UNREACHED '
      + 'entry becomes reachable, so the sweep exists — but expect MORE entries to go stale the '
      + 'same way now that combat triggers resolve observably, and check the whole list once '
      + 'rather than one entry per round.',
    proof: null,
    verify: 'Run 84-card-semantics: it names the entry and the precondition that is no longer missing.',
    status: 'open',
  },
];
