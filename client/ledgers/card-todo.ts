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
 *   · `card-ledger.ts`     — the cards with a printed clause that does
 *                            nothing. Referenced by CT-8, not copied. NO COUNT
 *                            IS TYPED HERE ON PURPOSE: it is a work QUEUE and
 *                            its length going down is the metric, so a number
 *                            written here rots the moment the queue moves. It
 *                            has been EMPTY since 2026-08-23; `71-card-ledger`
 *                            reads it live.
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
import '../engine/src/cards/registry.ts';
import { CLOSED } from './card-todo-closed.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from '../engine/src/harness.ts';
import { E } from '../engine/src/engine.ts';
import type { Attr, EntityId, Seat } from '../engine/src/types.ts';
import {
  ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from '../engine/test/util.ts';
import { SRC_DIR } from './card-todo-helpers.ts';

// ── proofs for the comprehensive-rules findings (CT-226 on) ─────────────
// Each finding was re-checked against HEAD before it was filed. A proof
// here either re-runs the verifier's measurement or reads the line the
// finding quotes; when that line is gone the proof goes false and 83 names
// the entry to tick off (or throws, when the code it reads has moved).

/** the client tree, which every path below is relative to */
const CLIENT_DIR = path.resolve(SRC_DIR, '..', '..');
const text = (rel: string): string => fs.readFileSync(path.join(CLIENT_DIR, rel), 'utf8');
/** is any of `needles` still in client/<rel>? (whitespace-normalised) */
function still(rel: string, ...needles: string[]): boolean {
  const t = text(rel).replace(/\s+/g, ' ');
  return needles.some(n => t.includes(n.replace(/\s+/g, ' ')));
}
/** does client/<rel> still match `re`? */
const rx = (rel: string, re: RegExp): boolean => re.test(text(rel));
/** the source from `start` up to `end`; throws when `start` has moved */
function body(rel: string, start: string, end: string): string {
  const t = text(rel);
  const i = t.indexOf(start);
  if (i < 0) throw new Error(`${rel}: "${start}" is gone`);
  const j = t.indexOf(end, i + start.length);
  return t.slice(i, j < 0 ? undefined : j);
}
/** a plain p/t unit token, as the verifier probes make them */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  let id = -1;
  withE(h, g => { id = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] }).id; });
  return id;
}
function toBlocks(h: Harness): void {
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) pass(h);
}

/** CT-226: an Electric effect whose source unit is D's, controlled by A — is the path asked of A? */
function electricAskedOfEffectController(): boolean {
  const h = new Harness(92008);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = tok(h, A, 1, 1), a1 = tok(h, A, 1, 1);
  const b0 = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  toBlocks(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b0] } });
  const asked: Seat[] = [];
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller: A, sourceName: 'Unit Token', sourceId: b0, region: g.homeRegion(A),
    targets: [], event: null, grantedAttrs: ['Electric' as Attr], eraseSelf: () => {},
    choose: (_k: unknown, dec: { kind: string; seat: number; options: { value: unknown }[] }) => {
      if (dec.kind === 'electricPath') asked.push(dec.seat as Seat);
      return dec.options[0]!.value;
    },
  } as never, [{ target: g.entity(a0)!, n: 5 }] as never);
  return asked.length > 0 && asked[0] === A && g.entity(b0)!.controller === D;
}

/** CT-228: 10 Piercing into two 2/4 Oorblaks — both die and only 2 reach the player */
function piercingLeftoverRedirectedTwice(): boolean {
  const h = new Harness(92028);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 10);
  withE(h, g => { g.addTempAttr(g.entity(atk)!, 'Piercing' as Attr); });
  const o1 = spawn(h, D, 'Oorblak'), o2 = spawn(h, D, 'Oorblak');
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  toBlocks(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const lost = life - h.state.players[D]!.life;
  return lost === 2 && !ent(h, o1) && !ent(h, o2);
}

/** CT-229: a stolen unit erased from play lands on its OWNER's erased pile */
function erasedStolenUnitGoesToOwner(): boolean {
  const h = new Harness(70701);
  toDeployment(h);
  const owner = h.state.deployPlayer!;
  const thief = (1 - owner) as Seat;
  const id = spawn(h, owner, 'Just a Unit');
  withE(h, e => { e.giveControl(ent(h, id)!, thief); });
  if (ent(h, id)!.controller !== thief) throw new Error('setup: the theft did not happen');
  withE(h, e => { e.eraseFromPlay(ent(h, id)!, 'probe'); });
  const n = (s: Seat): number => (h.state.players[s]!.erased ?? []).filter(c => c === 'Just a Unit').length;
  return n(owner) === 1 && n(thief) === 0;
}

/** CT-244: spells in printed.json that carry a power or a toughness */
function spellsCarryStats(): boolean {
  const printed = JSON.parse(text('engine/src/cards/printed.json')) as Record<string, { kind: string; power?: number; toughness?: number }>;
  return Object.values(printed).some(c => c.kind === 'spell' && (!!c.power || !!c.toughness));
}

/** CT-254: Bloomcaster played from hand makes no 1/1 for its own play */
function bloomcasterDeafToItself(): boolean {
  const h = new Harness(71401);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'wood', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Bloomcaster') });
  if (!unitsOf(h, p).some(u => u.card === 'Bloomcaster')) throw new Error('setup: Bloomcaster is not in play');
  return unitsOf(h, p).filter(u => u.card === 'Unit Token').length === 0;
}

/** Everything still open. The closed entries — the bulk of the file until
 *  2026-09-03 — live in card-todo-closed.ts, unchanged and still run. */
const OPEN: TodoEntry[] = [
  {
    id: 199, area: "client", severity: "minor",
    title: "undoing a spawn is refused if the opponent cached a card after it: the cached card's uid shifts",
    detail: "In a hidden step: you make a play that allocates entity ids (any spawn), then your opponent caches a card (any glimpse). Undoing your play is refused with \"taking that back would change what a move made after it refers to\". The reference key's zone delta writes the cached card's uid, which comes from the shared entity-id counter and so moves when your play is spliced out. Nothing about the opponent's move actually changed.",
    evidence: "Found by the R312 agent, 2026-10-04; 374 section 5 uses an id-free action to step around it.",
    fix: "Leave cache uids out of the zone delta, or symbolize them like entity ids. The zone-delta format is read by the card ledger's checks against old files, so it needs a format stamp or a new field.",
    proof: null,
    verify: "In deployment spawn a unit, let the opponent glimpse-and-cache, then press undo.",
    status: "open",
  },
  {
    id: 194, area: "client", severity: "minor",
    title: "the stack caption states an effect amount without the attribute that changes it (a Powerful Fireball says \"Deal 9\" and deals 18)",
    detail: "Found with report #188 (UVYZ [149]): the one-line does-text reads \"Deal 9 damage to Flourishing Flora\" while Emberflame Enlightener's granted Powerful doubles it. The owner chose chips only for #188 (2026-10-04) and to leave the caption wording for now, so this is deliberately parked, not forgotten.",
    evidence: "UVYZ replay at [149]; investigator for report #188.",
    fix: "Read E.stackItemAttrs in the does-line renderer and say the real amount (e.g. \"Deal 18 (Powerful)\"), for the attributes that change a number.",
    proof: null,
    verify: "Cast a Fireball with Emberflame Enlightener in play; the stack caption names the unboosted damage.",
    status: "open",
  },
  {
    id: 195, area: "client", severity: "minor",
    title: "a finished game forgotten after an hour answers its link with \"No game with code\", not the game",
    detail: "sweepFinished (server/main.ts) drops a decided, empty room an hour after it ends and its comment says a later reconnect \"finds the room by its file exactly as a restart would\". It does not: joinRefusal answers \"No game with code X\". The idle-room work (CT-193) gave CLOSED rooms a proper sentence; a FINISHED one still gets the typo answer.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04; not reproduced in a browser.",
    fix: "Answer a decided room's link from its file (result + a replay link), or at least say the game is over.",
    proof: null,
    verify: "Finish a game, wait an hour with nobody in it, open its link.",
    status: "open",
  },
  {
    id: 196, area: "client", severity: "minor",
    title: "every restart re-dates the unfinished games still open: history reads the file mtime as the day played",
    detail: "Each boot appends a version stamp to every restored room and persists it, which moves the mtime; history.ts takes the mtime as when the game was played. CT-193 pins the mtime back when a room CLOSES, but a room still open across a restart reads as played on the restart day until it closes.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04.",
    fix: "Date a history row by lastActionAt when the file has it, or pin the mtime on every restore persist.",
    proof: null,
    verify: "Restart the server with an unfinished game open; its history date moves to the restart.",
    status: "open",
  },
  {
    id: 197, area: "client", severity: "minor",
    title: "sandbox rooms restored after a restart escape the 50-room sandbox cap",
    detail: "sandboxCodes lives only in memory, so the cap that deletes the oldest scenario/sandbox rooms does not know about the ones restored at boot, and their files pile up. CT-193 now closes idle sandboxes, which limits the damage, but the cap itself is still blind after a restart.",
    evidence: "Noticed by the CT-193 agent, 2026-10-04.",
    fix: "Rebuild sandboxCodes from the restored rooms (mode or scenario field) at boot.",
    proof: null,
    verify: "Open several scenario rooms, restart, count sandboxCodes against the restored sandboxes.",
    status: "open",
  },
  {
    id: 186, area: 'client', severity: 'minor',
    title: 'constructed draft mode — a drafted pool you build a deck from, before you play it',
    detail:
      'Playtest report #164 (2026-09-14, from the home page, signed out): "Constructed draft '
      + 'mode would be great". The client has a LIVE draft — you draft out of the pack straight '
      + 'into the game you are playing — and a constructed mode where you bring a built deck. '
      + 'What it does not have is the third shape: draft a pool first, build from it, then play '
      + 'that deck.\n\n'
      + '\u26a0 WHAT THE REPORTER MEANT IS NOT SETTLED, and the two readings are different '
      + 'games. "Draft a pool, then build from it" is BL-05 (cube draft into a 30-card '
      + 'constructed tournament) and is already scoped in the backlog. "Bring a constructed '
      + 'deck into a draft pod" is something else entirely. They filed signed out and left no '
      + 'other words, so nobody can tell from the row. ASK BEFORE BUILDING.',
    evidence: 'playtest report #164; the second request for some form of draft-then-build, after '
      + '#163 (the Quick Start rules, which shipped the same night as BL-43).',
    fix: 'Nothing here — it is BL-05\'s. This entry exists so the report is not lost between the '
      + 'playtest ledger and the backlog, which is the gap 83-card-todo\'s report arm was '
      + 'written to close.',
    proof: null,
    verify: 'There is no way to draft a pool and build from it before playing; the home screen '
      + 'offers live draft and constructed only.',
    reportId: 164,
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
    progress:
      '\u26a0 MEASURED AND DELIBERATELY NOT BUILT, ROUND 36. THE REPORTED DEFECT IS NOT '
      + 'REACHABLE, AND THE VERIFY LINE ABOVE IS FALSE TODAY. This entry was written from the '
      + 'CODE — playInline\'s in-place branch really does fire a hand-rolled spellPlayed and no '
      + 'cardPlayed — and not from the reachable behaviour, which R198 had already fixed. '
      + 'MEASURED by instrumenting playInline and running every test file that can reach it '
      + '(each one naming one of its three callers): 41 calls, 38 down R198\'s PUSH path, '
      + 'through E.commitItem, which fires R129\'s cardPlayed with R207\'s item id like any '
      + 'other play. The only three in-place hits are 241-played-from-zone\'s synthetic "R263 '
      + 'test rig" driving the function directly in the deploy phase. No card reaches it, '
      + 'because all three callers can only run inside a battle priority window — which is '
      + 'exactly inlinePlayGoesToStack\'s predicate: Hooba-Pon triggers on [attacked, blocked], '
      + 'and Insidious Invitation and Tides of the Cosmos both print battle timing.\n\n'
      + 'THE ENTRY CONFLATES TWO QUESTIONS AND THEY SEPARATE CLEANLY. Is cardPlayed separable '
      + 'from item-hood? Yes — R207 already built the encoding (no `item` = "this play put no '
      + 'effect on the stack") — but it is MOOT here. A watcher that only needs to KNOW '
      + '(Bloomcaster, "whenever you play a unit, create a 1/1") already hears a mid-resolution '
      + 'play: driven in 169 \u00a76a, where it makes its 1/1. A watcher that needs to RESPOND '
      + '(Void Mandible) needs an item, and has one: the push path pushes a real item, and '
      + '169 \u00a71 already answers a mid-resolution Hooba-Pon play with Dematerialize. So the '
      + 'wide watchers are not deaf and the play IS answerable; making the in-place path an '
      + 'item — the "much larger change" this entry warns about — buys nothing.\n\n'
      + '\u26a0 AND THE SMALL CHANGE IS NOT FREE EITHER, which is the reason it was not made. '
      + 'R207 ruled that a cardPlayed with no `item` means "there is nothing to negate". Firing '
      + 'one from the in-place path therefore makes Void Mandible pay its printed sacrifice for '
      + 'a negate that cannot land — a card interaction nobody has ruled on, invented on a path '
      + 'no card reaches. That is the same trade the R263 agent declined ("changes which cards '
      + 'trigger on plays nobody ruled on this round"), and it should be decided WITH the '
      + 'fourth caller, when there is a real card to rule about.\n\n'
      + 'THREE GUARDS, and each was re-broken. 169 \u00a76a (behavioural, real cards) reddens '
      + 'when the in-place path is forced, alongside five of R198\'s own tests. 169 \u00a76b is '
      + 'THE TRIPWIRE: the playInline call-site census is derived from source and reddens the '
      + 'day a FOURTH caller appears — with the question it has to answer in the failure '
      + 'message — plus the mechanical checks that keep the three in a window (printed timing, '
      + 'trigger events). 169 \u00a76c pins the residue: it asserts the in-place path fires NO '
      + 'cardPlayed, so the silence cannot be changed by accident either, and it says in the '
      + 'test that it records what the code does rather than what is right. Severity stays '
      + 'minor and the entry stays OPEN: the divergence is real, it costs nothing today, and '
      + '\u00a76b is the day it starts costing something.',
    status: 'open',
  },
  {
    id: 173, area: 'attribute', severity: 'minor',
    cards: ['Flame of History', 'Invasive Reassignment'],
    title:
      '{Reaping} never turns off — "It loses reaping until regroup" is unimplemented and '
      + 'nothing in the repo knew the clause existed',
    detail:
      'The four {Reaping} cards all print, identically: "(When a reaping source kills one or '
      + 'more units, draw a card. It loses reaping until regroup.)" That wording was found by '
      + 'reading the card SCANS during the CT-171 audit; it is absent from the oracle '
      + 'transcription because the keyword is a TYPE-LINE ATTRIBUTE and the transcription text '
      + 'field carries ability text only (owner, 2026-08-30). The second sentence is not '
      + 'implemented anywhere: grep for Reaping near regroup or lose in engine/src returns '
      + 'nothing. So a reaping source keeps drawing on every subsequent kill for the rest of '
      + 'the turn, where the card says it reaps once and then stops until regroup. Combined '
      + 'with CT-172 (a draw per body rather than per event) the attribute is substantially '
      + 'stronger than printed.',
    evidence:
      'CT-171 glossary audit, 2026-08-30. ⚠ THE ENGINE SAYS THE OPPOSITE IN A COMMENT: '
      + 'engine.ts carries "{Reaping} \\"When it KILLS a unit, its controller draws a card.\\" (⚠ '
      + 'NOT printed - none of the four {Reaping} cards carries" - a stale belief that is the '
      + 'reason nobody looked for the second sentence. docs/03-mechanics-inventory.md has '
      + 'carried the correct printed wording all along, including this clause, and even files '
      + 'it as undone engine work.',
    fix:
      'Implement the loss (an until-regroup suppression of the attribute on that source) and '
      + 'DELETE the stale "NOT printed" comment in engine.ts in the same change. ⚠ Reachability '
      + 'first: no card GRANTS {Reaping} to a unit - all four printers are kind: spell - so do '
      + 'not build a combat seam for it; a 2026-08-26 round built one on that false premise and '
      + 'it was reverted. The four spells take the effect path, which is where both fixes '
      + 'belong.',
    proof: null,
    verify:
      'Kill with a reaping source twice in one turn. The second kill should draw nothing.',
    progress:
      '⚠ MEASURED AND DELIBERATELY NOT BUILT, 2026-08-30 (R283). The clause is real and '
      + 'printed - verified on the Seismomancy scan - but it is UNREACHABLE in this pool, so '
      + 'building it would be machinery for a case that cannot occur. A one-shot spell resolves '
      + 'once and killRiders fires once per resolving part, so a source that cannot kill twice '
      + 'can never be observed losing anything. It would bite only if a UNIT could carry '
      + '{Reaping}, and nothing can give one: all four printers are kind spell with EMPTY '
      + 'augmentAttrs (so no virus or augment donation under R79), and The Omniphage - the only '
      + 'other card naming the attribute - grants off BIN UNIT cards. A 2026-08-26 round built '
      + 'a {Reaping} combat seam on a premise like this one and had to REVERT it, because no '
      + 'test could fail on a case that cannot happen. This entry stays OPEN rather than closed '
      + 'as built, and severity drops to minor: the gap is real, it costs nothing today, and '
      + '263 §4 is the tripwire that was missing in August - it goes RED the day a printer '
      + 'stops being a spell, gains augmentAttrs, or another card starts naming the attribute. '
      + 'THAT is the day this needs code. Also done here: the stale engine.ts comment asserting '
      + 'no {Reaping} card prints a reminder is replaced by the printed sentence itself.',
    status: 'open',
  },
  {
    id: 178, area: 'coverage', severity: 'minor',
    cards: ['Necromantic Rebuke'],
    title:
      'the owner\'s `slightly off` verdict on Necromantic Rebuke was answered by fixing the '
      + 'MISPLAY, and the branch the scenario exists to reach has still never run',
    detail:
      'var/verdicts.jsonl carries {"scenario":"rebuke-refused","card":"Necromantic Rebuke",'
      + '"verdict":"slightly-off","room":"DWYV","actionIndex":6} dated 2026-08-27T13:00Z. The '
      + 'cause was found and it was a client defect, not the card: the bin menu had collapsed '
      + 'two identical cards into one row without saying so, the owner paid X as 2, and X=2 '
      + 'empties the bin and suppresses the ransom. R220 fixed the menu (DecisionOption.count) '
      + 'and the board is unchanged. ⚠ But that closed the CAUSE OF THE MISPLAY, not the '
      + 'verdict: `rebuke-refused` exists to watch the REFUSAL branch at X=1, and '
      + 'ledgers/unreached.ts records in prose that it "still has not executed". So the card '
      + 'is unverified for the one clause the scenario was built to witness.\n\n'
      + '⚠ THIS TICKET DOES NOT CONTRADICT ANY RULING, and it is worth saying so plainly '
      + 'because 202-settled-rulings-not-reopened convicted an earlier wording of this entry '
      + 'that read as if it did. digital-rules.md §7 ("Necromantic Rebuke\'s X is the printed '
      + 'additional cost") marks the card ALREADY CORRECT and nothing here disputes that. The '
      + 'gap is a COVERAGE gap, which is why the area is `coverage` and not `card`: the '
      + 'engine is believed right and has never been WATCHED being right on this branch. '
      + 'R220 fixed the client defect that caused the misplay; it did not, and could not, '
      + 'witness the refusal.',
    evidence:
      'ROUND 36, found by 264-verdict-loop.test.ts ON ITS FIRST RUN — the guard was written '
      + 'for Vengeance (CT-177) and turned up a second dropped verdict immediately, which is '
      + 'the positive control docs/13 §7.4 asks every new checker for. ⚠ The finding already '
      + 'EXISTED, in a comment on UNWITNESSED_CARDS in ledgers/unreached.ts, where nothing '
      + 'could fail on it. That is the docs/13 §5 shape exactly: a real defect that stops '
      + 'being work the moment its only home is a sentence.',
    fix:
      'Re-open `rebuke-refused` and play it correctly — X = 1, so the bin is not emptied and '
      + 'the ransom is actually offered — then watch the refusal. If it behaves, the card '
      + 'earns a WITNESSED row and leaves UNWITNESSED_CARDS; if it does not, this entry '
      + 'becomes the real ticket. Either way the loop closes on evidence rather than on the '
      + 'assumption that fixing the menu fixed the card.',
    proof: null,
    verify:
      'Open rebuke-refused, pay X = 1, and refuse the ransom. The refusal branch runs and the '
      + 'card does what it prints.',
    status: 'open',
  },
  {
    id: 185, area: 'engine', severity: 'minor',
    title:
      'R286 point 5: "nothing will automatically resolve if you\'re holding ctrl" — the '
      + 'DEPLOYMENT half of full control, which needs a stop on a stack that drains itself',
    detail:
      'CT-183 landed full control as a held Ctrl key over the four things that act for you. '
      + 'One clause of the owner\'s answer is not in it: "Even during deployment, nothing '
      + 'will automatically resolve if you\'re holding ctrl." R286 built the stack that makes '
      + 'the sentence expressible, and CT-183\'s own note scoped this out until it existed. '
      + 'It exists now.\n\n'
      + 'THE OBSTACLE, stated plainly: the deployment stack drains INSIDE `settle()`, in the '
      + 'engine, and full control is a browser key relayed to the server. The engine has '
      + 'never heard of it, and the three other automatics are all outside the engine, which '
      + 'is why they were reachable.',
    evidence:
      'ROUND 37, the one clause of questions-round36 Q5 that CT-183 could not reach. R286 '
      + 'point 5 names it as the case that makes the deployment stack VISIBLE: "A held stop '
      + 'in deployment is only meaningful if there is a stack to stop on." Today a deployment '
      + 'play is pushed and drained within the same action, so no client ever sees the item '
      + 'on the stack at all - `E.pushItem` flashes it precisely because of that.',
    fix:
      '⚠ THE ONLY REPLAY-SAFE SHAPE IS AN ACTION, and that is the whole decision. A saved '
      + 'game is a seed plus an action log; anything that changes what the engine does must '
      + 'be IN that log or the replay diverges. So: a `holdStack` action carrying the seat '
      + 'and on/off, stored in GameState, read by `settle()`\'s deployment drain (which then '
      + 'leaves the seat\'s stack standing), plus a `resolveTop` action and a button for the '
      + 'player to step it. THREE COSTS THE OWNER SHOULD WEIGH BEFORE THIS IS BUILT: (1) '
      + 'every Ctrl press in deployment becomes a row in the action log, so send it ONLY in '
      + 'the deploy phase, where R286 says it is "very rare to matter"; (2) report #86 / '
      + 'CT-22 stamps any deployment action other than Done as "you did something this '
      + 'deployment" - this action must be exempted or holding Ctrl silently marks you as '
      + 'having acted; (3) the client relay stops being a socket message and becomes an '
      + 'action, which incidentally CLOSES CT-183\'s latency gap (a) for the deployment half, '
      + 'because an action is ordered in the log.',
    proof: null,
    verify:
      'In deployment, hold Ctrl and play a spell: it sits on your stack and waits for you. '
      + 'Let go: it resolves. The opponent sees none of it, and their own deployment is '
      + 'unaffected either way.',
    status: 'open',
  },
  // ── the comprehensive-rules export's findings, re-checked at HEAD and filed
  //    2026-10-10 (CT-226..CT-275 are reserved for that project). Each names its
  //    finding ids in data/comprehensive-rules/findings/, which carry the CT back.
  {
    id: 226, area: "attribute", severity: "major",
    title: "the Electric path is asked of the effect's controller, not of the Electric source's controller",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule attr.electric.chooser states the ruling: \"The **Electric source's controller** chooses the path.\" dealEffectDamageAll raises the electricPath decision for ctx.controller, the controller of the EFFECT. The two differ when a spell makes an opponent's unit the damage source (Fight, Battle): the spell's caster then steers the opponent's Electric excess. 05-rulings asserts the source's controller only on a board where the two coincide, so the suite never tells them apart. The Piercing split beside it already asks the source unit's controller.",
    evidence: "Findings F-U20-1 (dup F-U20-5). engine.ts: \"kind: 'electricPath', seat: ctx.controller,\". digital-rules.md: \"The **Electric source's controller** chooses the path.\" 05-rulings.test.ts: \"the Electric SOURCE's controller chooses\" (a board where caster and source controller are the same player). Re-measured 2026-10-10 by the proof below: a D unit as the source of an A effect, and the jump is asked of A.",
    fix: "Ask the electricPath decision of the source unit's controller when the effect has a source unit (the same seat the Piercing split already uses), and of ctx.controller only when there is none. Add a 05-rulings case where the two differ.",
    proof: () => electricAskedOfEffectController(),
    status: 'open',
  },
  {
    id: 227, area: "attribute", severity: "minor",
    cards: ["Oorblak"],
    title: "Oorblak's combat-damage redirect ignores Oorblak's OWN {Pure} and doubles damage onto a Pure Vulnerable Oorblak",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule attr.vulnerable.pure: \"A Pure Vulnerable unit, and a Vulnerable unit in an interaction with a Pure card, is not dealt double damage.\" The redirect hook in batch-earth-b prices Vulnerable as (!info.pure && Vulnerable), where info.pure is the attacking COLUMN's purity only. A Pure Vulnerable Oorblak taking a non-Pure column's damage is therefore dealt it doubled (the pilot probe: 3 power redirected, 6 dealt, Oorblak died). Exotic but reachable, since Oorblak can be given Pure or Vulnerable by mods.",
    evidence: "Finding F-U19-3. batch-earth-b.ts: \"const mult = (!info.pure && g.effAttrs(self).has('Vulnerable')) ? 2 : 1;\". digital-rules.md: \"A Pure recipient takes plain damage from anyone.\" The pilot verifier's probe measured it; the probe is not committed. 290-pure-outside-combat has no Pure-recipient case (see CT-241).",
    fix: "Treat the redirect as an interaction between the column and Oorblak: mult is 1 if the column OR Oorblak is Pure (and pass that purity on to preventUnitDamage). Add a test with a Pure Vulnerable Oorblak under a plain column.",
    proof: () => still('engine/src/cards/sets/batch-earth-b.ts', "const mult = (!info.pure && g.effAttrs(self).has('Vulnerable')) ? 2 : 1;"),
    status: 'open',
  },
  {
    id: 228, area: "engine", severity: "minor",
    cards: ["Oorblak", "Blightsea Polyp"],
    title: "a Piercing leftover that one redirect let through is redirected again by the next holder (two Oorblaks both soak one hit)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules combat.damage.player.redirect, effects.replacement.once.one-applies and attr.piercing.redirect state the designer's answer: Piercing combat damage redirected into Oorblak kills it and the rest reaches the player, \"not redirected again\", because \"replacement effects only apply once in an effect\". replaceCombatDamage offers what one holder lets through to EVERY next holder, so a second Oorblak or a Blightsea Polyp in the region takes the leftover. Measured: 10 Piercing into two 2/4 Oorblaks, both die and the player loses 2 (the ruling: one dies, the player loses 6).",
    evidence: "Findings F-U12-1 (dups F-U15-3, F-U15-5, F-U20-6). raq.ts: \"the other 6 still reach the player, and are not redirected again.\" raq.ts (calebgannon): \"replacement effects only apply once in an effect Unless a new trigger occurs\". engine.ts replaceCombatDamage: \"if (through === left) continue;\" and \"left = through;\" with no stop after a replacement. Re-measured 2026-10-10 by the proof below.",
    fix: "Once one holder has replaced part of a hit, stop offering the leftover to further holders (break after the first holder that returns less than it was given). Keep the decline path (through === left) moving on. Pin it with the two-Oorblak board and an Oorblak + Polyp board.",
    proof: () => piercingLeftoverRedirectedTwice(),
    status: 'open',
  },
  {
    id: 229, area: "engine", severity: "minor",
    title: "a stolen unit erased from play is filed on its OWNER's erased pile; every other route files under the controller",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule zones.general.follow-control. The owner's ruling (R262): \"All four follow control — one rule, no seam\". E.eraseFromPlay emits its erased event with seat: u.owner, so a stolen unit erased by Banishment, Celestial Purge or as a cost lands on the owner's erased pile. Bin, hand, cache, eraseMod and the Unstable-death sweep all use the controller. 246-zones-follow-control covers only the mod route. Also found by the register stage (F-REG-1).",
    evidence: "Findings F-U07-7 (dups F-U07-9, F-REG-1). engine.ts: \"unit: u.id, card: u.card, seat: u.owner, region: u.region,\"; the Unstable route beside it: \"const binSeat = opts.binTo ?? u.controller;\". digital-rules.md: \"**(a) All four follow control** — one rule, no\". Re-measured 2026-10-10 by the proof below.",
    fix: "File the erased-from-play card under u.controller (keep an explicit destination a card prints). Add the erase-from-play case to 246, with a real theft through giveControl.",
    proof: () => erasedStolenUnitGoesToOwner(),
    status: 'open',
  },
  {
    id: 230, area: "coverage", severity: "minor",
    title: "two combat test titles assert the superseded \"no priority between damage sub-steps\" law",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules combat.damage.split.boundary-window and combat.damage.split.state-between. R295 amended R3: a split damage step opens a priority window between the Swift and normal sub-steps, and the trigger queue resolves there. 02-combat still says \"no priority between sub-steps\"; its own board stops at that window, so it proves only the Swift strike. 239 \"R3 STILL STANDS\" takes its \"dealt NOTHING in the normal sub-step\" assertion while paused at the window, before the normal sub-step runs, so it does not assert its title.",
    evidence: "Findings F-U12-2 (dup F-U12-3). 02-combat.test.ts: \"R3/Swift: swift column deals damage first, no priority between sub-steps\". 239-damage-triggers-after-combat.test.ts: \"R3 STILL STANDS: a unit killed in the Swift sub-step deals no normal damage, and only the trigger queue waits\".",
    fix: "Retitle 02-combat to the Swift strike it proves. Rewrite 239 to pass the window, run the normal sub-step and then assert the dead Swift-step unit dealt nothing; retitle it to the amended law.",
    proof: () => still('engine/test/02-combat.test.ts', 'no priority between sub-steps') || still('engine/test/239-damage-triggers-after-combat.test.ts', 'R3 STILL STANDS'),
    status: 'open',
  },
  {
    id: 231, area: "client", severity: "minor",
    title: "three player-facing glossary rows state superseded law: Electric (excess lost), Glimpse (still moddable), Graft (cache)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) ui/glossary.ts is our text and players read it. (1) The Electric row says \"When the chain runs out the excess is lost\"; R317 makes each hop optional and a dead-end remainder dealt to the last unit, never lost, and R340 makes the Piercing dead end elective (CR rules attr.electric.*). (2) The Glimpse row ends \"still moddable out of the zone at full price\"; R303 refuses every verb on an expired glimpse, and the Cache row in the same file already says so (CR rule zones.cache.lapse). (3) The Graft row allows a cached card only \"if a fulfilled prophecy paid for it\", omitting the live glimpse that R303 and R311 allow (CR rule effects.mods.zones.cache). Test 177 cannot see any of them: the rows cite rulings that are still live.",
    evidence: "Findings F-REG-2, F-U07-5 (dup F-U18-2), F-U17-2. glossary.ts: \"When the chain runs out the excess is lost\"; \"still moddable out of the zone at full price\"; \"or from cache, if a fulfilled prophecy paid for it\". digital-rules.md: \"no {Piercing} is read: it stays on the last unit — dealt, never lost\". 315-cache-mod-permission.test.ts: \"R303: an expired glimpse is not a graft, not an augment, not anything\".",
    fix: "Rewrite the three rows from the live rulings and cite them (Electric: R317/R340; Glimpse and Graft: R303). Consider teaching 177 to compare a row's text against the rulings that supersede the ones it cites.",
    proof: () => still('ui/glossary.ts', 'When the chain runs out the excess is lost', 'still moddable out of the zone at full price', 'or from cache, if a fulfilled prophecy paid for it'),
    status: 'open',
  },
  {
    id: 232, area: "card", severity: "minor",
    cards: ["Minor Kraken"],
    title: "Minor Kraken re-checks its own target limit mid-resolution, so an earlier part of the same item can switch it off",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.resolution.recheck.once (R324's encoding): target legality is judged once, as the item begins to resolve, so an earlier part cannot make a later part's target illegal. markIllegalTargets does judge once, but Minor Kraken re-tests its printed \"5 or less defense\" inside its own run. Measured: a composite whose first part puts 11 +1/+1 counters on a 0/2 and whose second part is the Kraken recall does not recall it (without the counters it does). Throw off a Cliff and Leave None Pure re-test a printed limit in run too; they were not measured.",
    evidence: "Finding F-U14-9. batch-water-a.ts: \"if (def <= 5) g.recall(t);\". batch-earth-c.ts: \"if (g.effStats(u)[1] >= 4) g.destroy(u, 'is deleted');\". digital-rules.md: \"the same item therefore cannot make a later part's target illegal\". Measured by the U14 tester probe (not committed).",
    fix: "Drop the in-run re-check where the target spec already carries the restriction (the once-only judgement then covers it), or snapshot the restriction at resolution start. Sweep the cards that re-test a printed restriction inside run.",
    proof: () => still('engine/src/cards/sets/batch-water-a.ts', 'if (def <= 5) g.recall(t);'),
    status: 'open',
  },
  {
    id: 233, area: "engine", severity: "minor",
    title: "ownership is lost once a stolen card passes through the thief's hand: the replay makes the thief its owner",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.players.owner. Zones follow control (R262), so a stolen unit that is recalled goes to the thief's hand. A hand holds bare card names, so when the thief plays it again the new unit's owner defaults to the playing seat: the engine records the thief as owner. The register: \"its OWNER's, always, forever\" and \"Ownership does not move. Only the destination does.\" Low impact while zones follow control, but the owner field stops meaning what the ruling says (bins and the erased pile have the same bare-name shape).",
    evidence: "Findings F-U01-1 (dup F-U01-3). engine.ts: \"const owner = opts.owner ?? seat;\". digital-rules.md: \"| whose card is this? | its OWNER's, always, forever |\" and \"**2. Ownership does not move. Only the destination does.**\" Measured by a verifier probe (not committed): owner = thief after the replay.",
    fix: "Carry the owner with a card in a hand (and bin), or record the original owner when a stolen card enters the thief's zone, and pass it as opts.owner on the replay. A save-format change: needs a format stamp.",
    proof: null,
    verify: "Steal a unit, recall it to the thief's hand, let the thief play it again, and read the new unit's owner.",
    status: 'open',
  },
  {
    id: 234, area: "engine", severity: "minor",
    cards: ["Molten Riftbreaker", "Frosted Denial", "Woodland Warding"],
    title: "OWNER DECISION: the stack, bins and cache are regionless, so some effects reach across regions against print",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.golden.regions states print and Caleb: every effect is specific to its region (Caleb: \"Yes everything in the game is region specific\"). R250 and R265 deliberately keep the stack, bins and cache global, so Frosted Denial, Woodland Warding and Molten Riftbreaker reach across regions. Measured: an effect resolving in one region negated a spell on the stack in another. This is a recorded owner ruling, filed because print and the designer outrank it under the authority order; it waits on the owner's answer to discrepancy D-U01-12.",
    evidence: "Findings F-U01-2 (dups F-U01-4, F-U01-5). digital-rules.md: \"Woodland Warding and Molten Riftbreaker do reach across regions, by ruling and not by defect.\" and \"The STACK is not regional and is deliberately left global; narrowing\". raq.ts: \"Yes everything in the game is region specific.\" Manual: \"Every single effect is specific to the region it takes\". Measured by a verifier probe (not committed).",
    fix: "Ask the owner (D-U01-12). If print wins: give stack items, bin cards and cache cards the region they were played or put in, and filter the stack/bin/cache walks by it. If R265 stands: close this as wontfix with the owner's words.",
    proof: null,
    verify: "With an attack in one region, resolve Molten Riftbreaker in the other region and see whether a spell on the battle region's stack is negated.",
    status: 'open',
  },
  {
    id: 235, area: "coverage", severity: "minor",
    title: "test titles and messages in ten places, and one register row, still state law that a later ruling or the card changed",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Each title below names behaviour the rulings have since changed; most assertions already follow the new law, so only the words mislead (Biomass Devourer's cannot tell the two bins apart at all). (1) 133: \"R157 §20 — …\" titles; R326 reversed §20. (2) 45-hybrids-ld-b: Deferral Drone \"this turn\"; the card and the engine say this phase, and R119's table still lists the clear in E.startTurn. (3) 26-metal-a: a stolen unit dies to its OWNER's bin; R250 sends it to the controller's. (4) 36-cache-prophecy: a cached token \"is erased, not cached\"; R69 has it visit the cache. (5) 178: \"Q3 is OPEN\" and \"the pile is untouched\"; R219 files the pile. (6) 36: prophesying is illegal in the haste step, unqualified; R277 allows a [Haste] banner. (7) util.ts and three tests: the haste step opens only for a payable haste card; R224/R228 open it every turn. (8) 35-rot: \"deployment opens no priority window\"; R286 amended R38. (9) 44: R62 suppression \"is a veto ABOVE copy\"; R328 reversed the veto. (10) 42-dark-b: Afflicting rots \"the owner\"; Umbral Decay prints the controller.",
    evidence: "Findings F-U02-1, F-U04-1, F-U07-1, F-U07-2, F-U07-4 (dup F-U16-1), F-U08-2, F-U08-3, F-U09-1, F-U16-2, F-U20-2. Quotes: \"R157 §20 — with no Stasis Sentry an X spell costs exactly X\"; \"the next card you play this turn costs [3] less\"; \"| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |\"; \"R140: a stolen unit dies — the erase reaches the OWNER\"; \"R46: a TOKEN cached from play is erased, not cached (there is no card)\"; \"Q3 is OPEN\"; \"the host lives, and the pile is untouched\"; \"R42: prophesying is a DEPLOYMENT action — illegal in planning, the haste step and battle\"; \"appears when someone holds a payable haste card) */\"; \"R38: rot damage cannot be responded to — deployment opens no priority window\"; \"R118: R62 suppression is a veto ABOVE copy\"; \"{Afflicting} rots the owner of what it kills\".",
    fix: "Retitle each test to the live ruling and reword the messages. Where the assertion cannot tell old law from new (26-metal-a; 42-dark-b, where owner and controller coincide), add the case that can. Correct the R119 table row.",
    proof: () => still('engine/test/133-x-cost-semantics.test.ts', 'R157 §20 —') || still('engine/test/45-hybrids-ld-b.test.ts', 'the next card you play this turn costs [3] less') || still('engine/test/26-metal-a.test.ts', 'the erase reaches the OWNER') || still('engine/test/36-cache-prophecy.test.ts', 'is erased, not cached (there is no card)', 'illegal in planning, the haste step and battle') || still('engine/test/178-played-item-and-erased-mods.test.ts', 'Q3 is OPEN', 'the pile is untouched') || still('engine/test/util.ts', 'appears when someone holds a payable haste card') || still('engine/test/35-rot-debt-trash.test.ts', 'deployment opens no priority window') || still('engine/test/44-hybrids-ld-a.test.ts', 'suppression is a veto ABOVE copy') || still('engine/test/42-dark-b.test.ts', 'rots the owner of what it kills') || still('docs/digital-rules.md', '| **clear** | `E.startTurn`, beside the `Entity.budgets` wipe |'),
    status: 'open',
  },
  {
    id: 236, area: "coverage", severity: "minor",
    title: "the ruling register and the RAQ ledger still carry open warnings and claims that later work has settled",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Register text only; the engine or client already does the right thing. (1) R158 §1 says Living Vault refuses X cards in hand; 39-light-b asserts it offers them at [0]. (2) R72 says the client does not re-seed its block build when the attack line closes; rekeyBuild does, pinned by 55-ui-formation. (3) R87 asks for a declareBlocks:spellTokens facet; 75-ui-reachability has it. (4) R27 words Embermaw Fledgling's count as units the controller \"owns\"; the card counts by control, which is right. (5) R282 says the inspector states a reminder twice and must be fixed \"before this counts as closed\"; ui/main.ts already drops those rows. (6) R266 says nineteen tier-1 announcements \"remain log-only\"; R276 (CT-142) toasts every one. (7) The RAQ note on the Wispweaver guard still warns it is green \"for the wrong reason\" after the Sandstone case was found to be a fixture error.",
    evidence: "Findings F-U02-2, F-U11-1 (dup F-U24-2), F-U11-2, F-U10-1, F-U24-1, F-U24-4, F-U15-2. digital-rules.md: \"`printedMana` returns `null`, so an X card in hand is never offered); the\"; \"re-seed its preview when `b.columns.length` changes, and it does not yet.\"; \"It wants a `declareBlocks:spellTokens` facet and a\"; \"units the controller owns in `battle.columns` at trigger resolution\"; \"One duplication is left standing and it is in `ui/main.ts`.\"; \"Nineteen tier-1 announcements remain log-only.\" raq.ts: \"Green partly for the wrong reason given the Sandstone defect\".",
    fix: "Mark each warning resolved in place, naming what resolved it (the test or ruling), in the register's existing convention; do not add an R heading for any of them. Update the RAQ note.",
    proof: () => still('docs/digital-rules.md', 'so an X card in hand is never offered); the', 'changes, and it does not yet.', 'It wants a `declareBlocks:spellTokens` facet and a', 'units the controller owns in `battle.columns` at trigger resolution', 'One duplication is left standing and it is in `ui/main.ts`.', 'Nineteen tier-1 announcements remain log-only.') || still('ledgers/raq.ts', 'Green partly for the wrong reason given the Sandstone defect'),
    status: 'open',
  },
  {
    id: 237, area: "engine", severity: "minor",
    title: "a Prismite cannot be exchanged into a Shard, though the printed card says \"a non-prismite resource\"",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.resources.prismite.exchange.element-only. The printed Prismite reads \"Erase me: Create a non-prismite resource, then activate it\", and the Manual says active Prismites \"may be exchanged for other resources\". A Shard is a non-prismite resource. doExchangePrismite accepts only an element of the game, and test 308's title asserts the refusal. No ruling forbids the Shard (R299 rules only the Prismite-into-Prismite case). Low impact: a Shard is never better than an element resource.",
    evidence: "Finding F-U02-3. apply.ts: \"e.need((e.s.elements as string[]).includes(element), 'not an element of this game');\". digital-rules.md: \"Exchanging a Prismite *into* a Prismite stays illegal — an exchange names an element.\" 308-recycle-for-prismite.test.ts: \"R299 what stays illegal: exchanging a Prismite into a Prismite or a Shard\".",
    fix: "Accept a Shard as an exchange target (the action names an element or the shard kind), or get an owner ruling that the Shard is excluded and record it. Retitle 308 either way.",
    proof: () => still('engine/src/apply.ts', "e.need((e.s.elements as string[]).includes(element), 'not an element of this game');"),
    status: 'open',
  },
  {
    id: 238, area: "coverage", severity: "minor",
    title: "two test titles still call a settled ruling an open question (the Wraith self-pick, Abyssal Evocation's timing)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) (1) 37-attrs-wight is titled \"(unconfirmed reading)\" with a warning mark, but R71 item 4 and R265 settled that \"an ally\" may be the unit itself (CR rule concepts.targets.ally.self). (2) 12-fire-a is titled \"⚠ OPEN — a bin-played card obeys its PRINTED timing\" and says the assertion flips if the owner rules otherwise; R157 §12 ruled it (\"Already correct — Abyssal Evocation, Writhing Host.\"), as R197 records. The behaviour is right in both; only the words are stale.",
    evidence: "Findings F-U03-1, F-U07-3 (dups F-U14-4, F-U21-1). 37-attrs-wight.test.ts: \"R71 ⚠: a lone Wraith may pick ITSELF as \"an ally\" (unconfirmed reading)\". 12-fire-a.test.ts: \"Abyssal Evocation: ⚠ OPEN — a bin-played card obeys its PRINTED timing\". digital-rules.md: \"Already correct — Abyssal Evocation, Writhing Host.\"",
    fix: "Retitle both to cite the ruling that settled them, and drop the \"flips if\" comment in 12-fire-a.",
    proof: () => still('engine/test/37-attrs-wight.test.ts', '(unconfirmed reading)') || still('engine/test/12-fire-a.test.ts', '⚠ OPEN — a bin-played card obeys its PRINTED timing'),
    status: 'open',
  },
  {
    id: 239, area: "card", severity: "major",
    cards: ["Gatekeeper of Souls"],
    title: "Gatekeeper of Souls compels targets chosen outside battle, though it prints \"during battle\"",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.targets.must-be-targeted. Printed: \"When a player selects targets for an effect during battle, I must be targeted if able.\" mustBeTargetedIn gathers the holders by region only and never asks whether a battle is on, so in deployment a player whose own Gatekeeper stands in their home region can aim a unit-targeting effect (Overbloom) only at the Gatekeeper. The card file reasons that region scoping is what \"during battle\" amounts to; deployment happens in the home region too, so it is not.",
    evidence: "Finding F-U03-2. Oracle: \"When a player selects targets for an effect during battle, I must be targeted if able.\" batch-light-c.ts: \"// like everything else (R12), which is also what \"during battle\" amounts to:\". engine.ts: \"const gates = this.mustBeTargetedIn(region);\"; mustBeTargetedIn reads no battle state. Measured by the round-1 verifier probe (not committed): the compulsion applies in deployment.",
    fix: "Return no gates from mustBeTargetedIn unless a battle is in progress in that region. Add a deployment case beside the battle one.",
    proof: () => !/battle/.test(body('engine/src/engine.ts', 'mustBeTargetedIn(region: number): Set<EntityId> {', 'return out;')),
    status: 'open',
  },
  {
    id: 240, area: "coverage", severity: "minor",
    title: "three guard tests wrap every assertion in an if that never fires, so they assert nothing",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) (1) 49-playtest-round6 \"R58: Enigmatic Warder cannot redirect an ENEMY into an ally slot\" looks for Fight on the stack after Fight has resolved, so its if (after) branch never runs (CR rule concepts.targets.ally.effect-controller). (2) 393-raq-mods, the Borrower/Reconfigure guard: no real [Augment] unit is a first target, so Reconfigure is never castable and the if (legalActions …) branch is skipped (CR rule card.augment-box.copy). (3) 393-raq-mods, the Borrower copying a Robot token: Download is never offered (plays.length = 0), so the \"Download cannot take\" half is vacuous (CR rule types.tokens.copying-a-token). Each was measured by a verifier.",
    evidence: "Findings F-U03-3, F-U05-2, F-U06-2. 49-playtest-round6.test.ts: \"if (after) {\". 393-raq-mods.test.ts: \"if (legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === rc)) {\" and \"if (plays.length) {\". The never-taken branches were measured by verifier probes (not committed).",
    fix: "Make each play required: build the board so the guarded action is offered, assert that it is, then assert the outcome with no if. Re-break each to see it go red.",
    proof: () => still('engine/test/49-playtest-round6.test.ts', 'if (after) {') || still('engine/test/393-raq-mods.test.ts', "a.type === 'playCard' && a.handIndex === rc)) {", 'if (plays.length) {'),
    status: 'open',
  },
  {
    id: 241, area: "coverage", severity: "minor",
    title: "ten tests (and one RAQ guard) claim more in their titles than their bodies assert",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) Each passes whatever the engine does on the claim in its title. (1) The RAQ guard for \"retargeting can rescue an effect from fizzling\" retargets a still-legal target. (2) 300: the per-seat constructed recycle pile, in a test that asserts the game is NOT constructed. (3) 05-rulings \"R11: regroup runs its exact sequence\" checks only the end state. (4) 18-earth-c: \"an adjacent enemy does not unlock it\" uses a facing blocker, which is not adjacent at all. (5) 21-fixes: \"round 2 … still restricts to the sent counterattackers\" never reaches a round 2. (6) 04-mods: \"mods move with a stolen unit\" assigns u.controller by hand and never reads the mod. (7) 290 §2: \"a Pure recipient's own Vulnerable\" makes the SOURCE Pure. (8) 12-fire-a: \"until regroup ends it\" never reaches regroup. (9) 403: \"dies to the bin\" never kills it; 36: \"both battles tick\" counts one.",
    evidence: "Findings F-U03-4, F-U07-8, F-U09-2, F-U10-2, F-U13-2, F-U17-3, F-U19-4, F-U21-2. raq.ts: \"guards: [\"12-fire-a.test.ts::Gravitational Correction: retargets the effect unless its controller pays [x]\"] },\". 300: \"assert.notEqual(h.state.mode, 'constructed', 'this harness is a shared-deck game');\". 05-rulings: \"R11: regroup runs its exact sequence\". 18-earth-c: \"// an adjacent ENEMY\". 21-fixes: \"round 2 after a real round-1 battle still restricts to the sent counterattackers\". 04-mods: \"u.controller = o;\". 290: \"the cheapest way to make the VICTIM side of the pairing Pure is to make the\".",
    fix: "For each, add the assertion the title promises (a fizzle avoided; a constructed game; an observation of order; an enemy inside the formation; a refused round-2 attacker; giveControl and the mod's controller; a Pure recipient; regroup reached; the death; both battles) or narrow the title to what is asserted.",
    proof: () => still('ledgers/raq.ts', '12-fire-a.test.ts::Gravitational Correction: retargets the effect unless its controller pays [x]') || still('engine/test/300-recycle-mark.test.ts', "this harness is a shared-deck game") || still('engine/test/05-rulings.test.ts', 'R11: regroup runs its exact sequence') || still('engine/test/18-earth-c.test.ts', '// an adjacent ENEMY') || still('engine/test/21-fixes.test.ts', 'still restricts to the sent counterattackers') || still('engine/test/04-mods.test.ts', 'u.controller = o;') || still('engine/test/290-pure-outside-combat.test.ts', 'the cheapest way to make the VICTIM side of the pairing Pure is to make the'),
    status: 'open',
  },
  {
    id: 242, area: "card", severity: "minor",
    cards: ["Mohruung", "Flame Juggle"],
    title: "a graft onto Mohruung attaches before Mohruung's \"becomes targeted\" trigger resolves; the designer says he triggers first",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.targets.becomes-targeted. Designer: \"Applying Graft is 'targeting' effect, so if you try to Graft something underneath the Mohruung, he will trigger first\". The engine fires the targeted event, attaches the graft at once, and only then resolves the queued trigger: the probe log reads \"Flame Juggle grafts onto Mohruung\" before \"Resolving Mohruung: create a Crystal 2\". The RAQ guard (393 point 5) asserts only that a Crystal is made, not the order. Pending discrepancy D-U03-13.",
    evidence: "Finding F-U03-5. raq.ts: \"Applying Graft is 'targeting' effect, so if you try to Graft something underneath the Mohruung, he will trigger first\". apply.ts: \"e.fireEvent('targeted', ev);   // grafting is targeting (Graft 101 §5)\". Measured by the round-2 verifier probe (not committed): the graft is attached when the action returns.",
    fix: "Let the targeted trigger resolve before the graft attaches (put the graft application behind the trigger, or attach through the stack in deployment). Assert the order in 393.",
    proof: null,
    verify: "In deployment graft Flame Juggle onto Mohruung and read the log: the Crystal should be made before the graft attaches.",
    status: 'open',
  },
  {
    id: 243, area: "engine", severity: "minor",
    cards: ["Arbiter of Armistice", "Vengeance"],
    title: "OWNER DECISION: an Ambush escapes imposed \"cards played\" costs (Arbiter of Armistice, Vengeance)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule concepts.costs.modifiers.imposed.ambush. R129 counts an Ambush as a card being played, and Arbiter of Armistice (\"Cards played during battle gain [Pay 2 life]\") and Vengeance print the noun \"Cards\". doAmbush pays only the Ambush line's mana and never consults lifeToPlay or unitsToPlay. Measured: an Ambush under Arbiter pays no life, while a spell card in the same spot is billed 2. R122 records the exclusion as an undecided future decision, so this is a divergence from the printed literal, not from a settled ruling.",
    evidence: "Findings F-U04-2 (dups F-U04-3, F-U04-4). digital-rules.md: \"### (b) 'cardPlayed': a {Battle} unit and an Ambush are cards being played\" and \"printed cost line and today sits outside the R59/R60/R122 play-tax layer\". apply.ts: \"printed cost line and sits outside the R59/R60/R122 play-tax layer alike. */\". Measured by a verifier probe (not committed).",
    fix: "Ask the owner (R122's open decision). If print wins: have doAmbush add lifeToPlay and unitsToPlay for the card, as the hand-cast path does.",
    proof: () => !/lifeToPlay|unitsToPlay/.test(body('engine/src/apply.ts', 'function doAmbush(', '\nfunction ')),
    status: 'open',
  },
  {
    id: 244, area: "engine", severity: "minor",
    title: "spells carry power and toughness in printed.json that no spell prints (91 of 138)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule card.stats.units: stats mark a unit (Rulebook 2023 p.3); a spell prints none. The oracle transcription has power and toughness fields on spell rows and the extractor copies them: Arc Lightning 1/3, Interdiction Rift 4/3, Spectrogenesis 4/5. Suspected harmless. The risk is a path that reads a spell's stats (a copy of a spell, an \"everything\" reach onto spells, Unaware reading printed stats, a card-stats or search surface).",
    evidence: "Finding F-U05-1. printed.json: \"\"name\": \"Arc Lightning\", \"factions\": [ \"fire\" ], \"cost\": \"rr\", \"mana\": 4, \"power\": 1, \"toughness\": 3,\". Oracle: \"\"name\": \"Interdiction Rift\", \"power\": \"4\", \"toughness\": \"3\",\".",
    fix: "Check that nothing reads a spell's power or toughness, then zero them at extraction (npm run extract), not in the oracle, so nothing can start to.",
    proof: () => spellsCarryStats(),
    status: 'open',
  },
  {
    id: 245, area: "card", severity: "major",
    cards: ["Wake the Dead", "The Bonesculptor"],
    title: "Wake the Dead and The Bonesculptor \"play\" units by spawning them in place: no stack item, and a spell unit skips its spell",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules types.spell-units.played-by-effect and effects.priority.mid-resolution. R165 rules Wake the Dead's \"Play up to two units\" is a real play; R198 rules a card played mid-resolution goes on the stack and is respondable; the designer (Hooba-Pon RAQ) says a played spell unit casts its spell and spawns only if it resolves. Both cards spawn through spawnUnit(asPlay) inside their own resolution, so the unit is in play at once, nobody can answer or negate it, and a spell unit (Jelly) arrives with no target asked, no spell effect and no spellPlayed. R165 and R207 record it as left open. Not CT-143: that entry is playInline's in-place path, which these cards do not use.",
    evidence: "Findings F-U06-1 (dups F-U06-3, F-U06-4, F-U14-3, F-U14-6, F-U14-7). batch-dark-a.ts: \"{ owner: c.seat, from: 'bin', asPlay: true });\" and \"// spell's own resolution — the units arrive with no stack item of their own,\". digital-rules.md: \"**A SPELL UNIT raised by Wake the Dead does not cast its spell.**\" raq.ts: \"Yes, the spell part happens and if it resolves, the unit will spawn into formation.\" Measured by verifier probes (not committed): the victim stays 7/5; onStack=false, inPlay=true.",
    fix: "Route these plays through the real play path (playInline, which already pushes in battle), so a spell unit casts its spell and every play gets an item. Read R207 and CT-143 first; replays of old games will drift (see the replay-drift memory).",
    proof: () => still('engine/src/cards/sets/batch-dark-a.ts', "{ owner: c.seat, from: 'bin', asPlay: true });"),
    status: 'open',
  },
  {
    id: 246, area: "attribute", severity: "minor",
    title: "OWNER DECISION: a dying {Unstable} card enters the bin and is trashed before it is erased; print erases it instead",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules zones.bin.unstable and keywords.actions.trash.unstable-death state print: \"If they would enter a bin, erase them instead.\" Caleb: \"Unstable units still die, they just get erased instead of ending up in the bin\". R137 (owner, still current) deliberately bins the card, trashes it there (firing \"when I am trashed\", the trash watchers and the per-battle count) and then sweeps it to the erased pile. Filed because print and the designer outrank R137 under the authority order; waits on discrepancies D-U07-3 and D-U18-1.",
    evidence: "Findings F-U07-6 (dups F-U07-10, F-U07-11, F-U18-1, F-U18-3). engine.ts: \"this.noteTrashed(binSeat, u.card, 'play', u);\". Oracle: \"(If they would enter a bin, erase them instead.)\". digital-rules.md: \"**An Unstable card that dies enters a bin, is trashed there, and is only then\". 224-mod-trash.test.ts: \"R137 GUARD: the BODY of an Unstable unit that dies is still trashed, mods or no mods\".",
    fix: "Ask the owner. If print wins: erase an Unstable card that would enter a bin without binning or trashing it, and flip the R137 guards in 224 and 35.",
    proof: () => still('engine/src/engine.ts', "this.noteTrashed(binSeat, u.card, 'play', u);"),
    status: 'open',
  },
  {
    id: 247, area: "engine", severity: "minor",
    title: "OWNER DECISION: the resource, haste and deployment steps are simultaneous and hidden; print has the initiative side go first",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules turn.planning.order and turn.deploy.order state print: the initiative player takes the resource and haste steps first and the non-initiative player after (Manual p.27 legend, Rulebook 2023 p.5), and the initiative team deploys first (Manual p.38). The engine runs all three as hidden simultaneous segments, a deliberate house rule (R18; types.ts calls deployment simultaneous). Measured: the non-initiative seat activated a resource, finished the step and played a haste card before the initiative seat acted, and is offered playCard in deployment before the initiative player is done. Waits on D-U08-1 and D-U09-1.",
    evidence: "Findings F-U08-1 (dup F-U09-3). apply.ts: \"export function hiddenSegment(s: GameState): 'plan' | 'haste' | 'deploy' | null {\" and \"if (e.deploying(seat)) return legalDeployActions(e, seat);\". types.ts: \"/** deployment is SIMULTANEOUS (house rule; regions can't interact anyway):\". digital-rules.md: \"false: the haste step is a **hidden simultaneous segment** — nobody sees the\". Measured by verifier and tester probes (not committed).",
    fix: "Ask the owner whether the house rule stands. If it does, record it as a digital convention (Annex D) and close this as wontfix. If print wins, sequence the segments by initiative.",
    proof: () => still('engine/src/apply.ts', 'export function hiddenSegment('),
    status: 'open',
  },
  {
    id: 248, area: "engine", severity: "minor",
    title: "planning steps do not sync: a seat that has drafted may start its resource step while the other still drafts",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule turn.planning.order.sync. Print: \"Turns in Algomancy are global, meaning all players share the same phases, and sync up at the end of each step.\" The engine gates the resource step on the acting seat's own draft (and, in constructed, its own recycle of 2), so a seat that has committed its draft may activate, recycle and finish its resource step while the other is still drafting. The hidden plan segment keeps it out of the other seat's view, so the observable effect may be nil.",
    evidence: "Finding F-U08-4. Rulebook 2023: \"Turns in Algomancy are global, meaning all players share the same phases, and sync up at the end of each step.\" 20-draft.test.ts: \"// committed seat may proceed simultaneously while the opponent drafts\". Measured by a verifier probe in a live draft (not committed).",
    fix: "Either hold the resource step until every seat has drafted, or ratify the early start as a digital convention (Annex D) and close this.",
    proof: null,
    verify: "In a live draft, commit seat 0's pick and try to activate a resource before seat 1 has drafted.",
    status: 'open',
  },
  {
    id: 249, area: "engine", severity: "major",
    cards: ["Inspiration"],
    title: "blockers either side of an empty blocking column are read as adjacent",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules combat.columns.adjacency and combat.blocks.general.gap-adjacency. adjacentInFormation builds the defender's grid from the block keys, sorted and compressed, so blockers on attacking columns 1 and 3 (column 2 unblocked) are left/right neighbours. The Manual locks formations in position and places side blocks \"for adjacency matters cards\", and a blocking column is keyed to the attacking column it faces, so the unblocked column is a gap. Measured: Inspiration buffs across it. The engine's own comment calls its reading an approximation.",
    evidence: "Findings F-U10-3 (dups F-U11-3, F-U11-4). engine.ts: \"// treated as adjacent (⚠ approximation: two blocks on columns 1 and 5 read\" and \"return Object.keys(b.blocks).sort((a, z) => Number(a) - Number(z)).map(k => b.blocks[Number(k)]!);\". Manual: \"columns. Units may even be placed blocking in slots\". Measured by verifier probes (not committed).",
    fix: "Build the defending grid with one column per attacking column, empty where unblocked, so adjacency reads the real positions. Check formationSlots and the UI grid read the same shape.",
    proof: () => still('engine/src/engine.ts', 'return Object.keys(b.blocks).sort((a, z) => Number(a) - Number(z)).map(k => b.blocks[Number(k)]!);'),
    status: 'open',
  },
  {
    id: 250, area: "card", severity: "minor",
    cards: ["Hooba-Lin"],
    title: "a lone Hooba-Lin killed under its attack trigger makes its 1/1 outside the formation it remembers",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule combat.formations.placement.source-gone. The designer's [Solved] answer names Hooba-Lin among the effects that \"will remember they were in formation and will work fine\", with no exception for a lone attacker. When Hooba-Lin attacks alone and is killed with its trigger on the stack, its column collapses, formationSlots finds no living unit in the grid and offers no slot, and the 1/1 is created outside any formation. Applies to every placer that reads a dead source (Hooba-Bot, Hooba-Pon, Hooba-Lin). It may be an unruled edge (D-U10-6).",
    evidence: "Findings F-U10-6 (dup F-U10-7). digital-rules.md: \"> Hooba-Nan). But there are some which will remember they were in formation and\". engine.ts: \"if (!grid.some(col => col.some(id => this.entity(id)))) return flash;\". Measured by the round-2 verifier probe (not committed).",
    fix: "When the source has left play, place into its remembered formation even when that formation is now empty (a slot in the remembered column), or get an owner ruling that a lone source is the exception.",
    proof: null,
    verify: "Attack with Hooba-Lin alone, kill it with its attack trigger on the stack, and see where the 1/1 lands.",
    status: 'open',
  },
  {
    id: 251, area: "coverage", severity: "minor",
    title: "R36 (a lone sent counterattacker auto-forms) still reads as current, but the engine deleted that forced action",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule annexd.general.player-decides.forced.lone-counterattacker. R36 says a round-2 counterattack pool of exactly one unit, with no ridable spell token, is auto-declared as a forced action. The decisions-for-the-player audit (2026-08-24) deleted that branch of forcedAction, and 32-cast-costs now asserts it is NOT forced. No ruling records the reversal and R36's heading carries no mark, so the register presents R36 as current. A register fix, unless the audit was not the owner's call, in which case the engine is wrong.",
    evidence: "Findings F-U13-1 (dups F-U23-4, F-U23-7, F-U23-8). digital-rules.md: \"## R36 — A lone sent counterattacker auto-forms in round 2\". apply.ts: \"// There used to be a second branch here: a round-2 counterattack with\" and \"// (decisions-for-the-player audit): sending a counterattacker and\". 32-cast-costs.test.ts: \"forcedAction: a single sent counterattacker is NOT auto-formed — attacking is still a choice\".",
    fix: "Confirm with the owner that the audit reversed R36, then add the reversal mark to R36's heading (citing the ruling that reverses it, which the orchestrator writes; an agent never invents the R-number).",
    proof: () => rx('docs/digital-rules.md', /^## R36 — A lone sent counterattacker auto-forms in round 2$/m),
    status: 'open',
  },
  {
    id: 252, area: "engine", severity: "minor",
    title: "a graft trigger whose required target has none is put on the stack and fizzles, instead of never being stacked",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules effects.casting.targets-required.graft-trigger and effects.graft.composite.no-target. Designer (RAQ 1410252965276684418#2): the composite \"can't be put on the stack unless you target such unit in your bin.\" The engine pushes it and lets it fizzle whole under R86. The board ends the same (no Poison), but meanwhile the opponent gets a priority window and can tax or negate an item that should never exist.",
    evidence: "Findings F-U14-1 (dups F-U17-7, F-U17-9). raq.ts: \"can't be put on the stack unless you target such unit in your bin.\" and \"the engine gets there by R86 fizzle rather than by refusing to stack it.\" 390-raq-stack.test.ts: \"// the stack unless you target such unit in your bin.\" Measured by a verifier probe (not committed): one item on attack.",
    fix: "At trigger time, drop a composite whose required targeted part has no legal candidate instead of pushing it.",
    proof: null,
    verify: "Attack with a graft whose trigger needs a unit in your bin while your bin has none; it should never reach the stack.",
    status: 'open',
  },
  {
    id: 253, area: "engine", severity: "minor",
    title: "OWNER DECISION: a player cannot keep priority after acting; print lets the actor take further actions first",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.priority.priority.hold states the Manual: a player who acts may keep priority and take further actions before passing. pushItem hands priority to the other seat after every push, so nobody can stack two of their own actions before the opponent may respond. Annex D records this as a digital convention (annexd.auto-pass.no-retain), but no ruling settles it. Measured: after a battle cast, priority is on the other seat.",
    evidence: "Finding F-U14-2. engine.ts: \"if (this.s.priority !== null) this.s.priority = other(item.controller);\". digital-rules.md: \"responder.** `pushItem` hands priority to `other(controller)`, but\". Measured by the U14 tester probe (not committed): priority = seat 1, caster = 0.",
    fix: "Ask the owner whether the no-retain convention stands. If it does, write it as a ruling and close this as wontfix. If not, keep priority with the actor after a push and add an explicit pass.",
    proof: () => still('engine/src/engine.ts', 'if (this.s.priority !== null) this.s.priority = other(item.controller);'),
    status: 'open',
  },
  {
    id: 254, area: "card", severity: "major",
    cards: ["Bloomcaster"],
    title: "Bloomcaster does not hear its own play, though R26 rules that it fires on its own arrival",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.playing.what-is-played.includes-itself. R26 (current): Bloomcaster's \"[Augment] Whenever you play a unit\" (no \"another\") fires on its own arrival when played normally. The trigger listens on cardPlayed from holders in play, and cardPlayed fires at commit while Bloomcaster is still on the stack, so it never hears itself. Measured: no 1/1 when Bloomcaster is played from hand. The card file comment still claims it makes one. Either the engine regressed when the card moved to cardPlayed, or R26 is stale (D-U14-11).",
    evidence: "Findings F-U14-5 (dup F-U14-8). digital-rules.md: \"Bloomcaster's \"[Augment] Whenever you play a unit\" (no \"another\") **fires on its own\". batch-fire-wood.ts: \"type: 'triggered', events: ['cardPlayed'],\" and \"// Bloomcaster itself still makes a 1/1. Region auto-scoped (R12).\" Re-measured 2026-10-10 by the proof below.",
    fix: "Let the item being committed hear its own cardPlayed (or fire a self-play check on arrival), then add a guard that plays Bloomcaster from hand and counts the 1/1.",
    proof: () => bloomcasterDeafToItself(),
    status: 'open',
  },
  {
    id: 255, area: "card", severity: "minor",
    cards: ["The Bonesculptor"],
    title: "The Bonesculptor's bin-play permission is built as an activated ability, so it reaches the stack and can be negated",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.static.permission: \"You may play one unit with no abilities from your bin each deployment\" is a standing fact, not an ability that goes on the stack. R165 and R168 both say so (\"should simply be true\") and both record that the engine builds it as a free bounded activated ability, which Containment Protocol can negate, \"filed rather than fixed\". Measured: it still resolves as an activated item.",
    evidence: "Findings F-U15-1 (dup F-U15-4). batch-earth-c.ts: \"type: 'activated', cost: {}, bounded: true, timing: 'deploy',\". digital-rules.md: \"deployment\"* is not an effect anyone should be able to answer, but it is built\" and \"should simply be true reaches the stack and Containment Protocol can negate\".",
    fix: "Model the permission as a play option (a legal playCard from the bin, bounded once per deployment), not an activated ability, so nothing reaches the stack.",
    proof: () => still('engine/src/cards/sets/batch-earth-c.ts', "type: 'activated', cost: {}, bounded: true, timing: 'deploy',"),
    status: 'open',
  },
  {
    id: 256, area: "engine", severity: "major",
    cards: ["Transmogrifant", "Monke"],
    title: "a unit stripped of abilities by a continuous effect (Monke, Transmogrifant) keeps applying its own static abilities",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.stripping.what.abilities. Transmogrifant and Monke print that other units \"lose all attributes and abilities\", and R62 says a static is an ability. staticsFor resolves static-vs-static in one pass that skips only a holder with its own entity stamp (textStrippedShallow), so a unit silenced by another static keeps radiating. Measured: Sandstone Defender under Transmogrifant still gives +0/+2 (a 1/1 token reads 3/5, where the printed text gives 3/3). R62 justifies the one pass only for the mutual case (two Monkes).",
    evidence: "Findings F-U16-3 (dups F-U16-5, F-U16-7). Oracle: \"[Augment] Your other units gain +2/+2 and lose all attributes and abilities.\" digital-rules.md: \"*entity flag* is set, not one silenced by another static. So a unit silenced by\" and \"**Unchanged:** static-vs-static still resolves in one pass (`staticsFor` reads only\". engine.ts: \"&& !this.textStrippedShallow(h, a))) {\". Measured by verifier probes (not committed).",
    fix: "Resolve the one-sided case: a unit stripped by a static that is not itself stripped stops radiating. Keep the mutual case's one-pass answer. Pin both.",
    proof: null,
    verify: "Put Sandstone Defender and a 1/1 token under Transmogrifant; the token should read 3/3, not 3/5.",
    status: 'open',
  },
  {
    id: 257, area: "attribute", severity: "minor",
    cards: ["Child of Aether", "Rampart Guardian"],
    title: "OWNER DECISION: Tough augmented onto a printed-Balanced unit is balanced first; the Manual's first clause doubles first",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rules effects.continuous.layers.attribute-order and attr.general.application-order. Manual p.42: if \"Tough\" is augmented onto a \"Balanced\" unit, \"it will have its defense doubled, then its stats balanced.\" The engine follows R19's engine call (printed attributes before mod attributes), so it balances first: Child of Aether (2/0 Balanced) with a Rampart Guardian augment reads 2/4 where that clause gives 2/2. The same Manual answer then says \"applied to\" gives balanced-then-doubled, so the print contradicts itself. R19's premise that the Manual is silent is wrong for this pair. Waits on D-U16-1 / D-U19-1.",
    evidence: "Findings F-U16-4 (dups F-U16-6, F-U19-5). Manual: \"“Tough” is augmented onto a “Balanced” unit, or if a\" and \"will have its defense doubled, then its stats balanced.\" digital-rules.md: \"⚠ Engine call: the Manual doesn't specify an order for printed-vs-granted-vs-shared;\". Measured by a verifier probe (not committed): 2/4.",
    fix: "Ask the owner which clause governs. Then order the stat layers accordingly and add a printed-host test.",
    proof: null,
    verify: "Augment Child of Aether with Rampart Guardian and read its stats (2/4 today).",
    status: 'open',
  },
  {
    id: 258, area: "card", severity: "minor",
    cards: ["Return to Nature"],
    title: "Return to Nature files each erased mod under its OWNER, not its controller, so a mod on a stolen host goes to the wrong pile",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.mods.erase-off-host. R262 moved the erased pile of a mod erased off a living host from mod.owner to mod.controller (\"All four follow control\"), and a mod's controller is its host's (R244). E.eraseMod files under the controller, but Return to Nature files its own grouped line byOwner and passes alreadyFiled. Measured: a mod owned by D on a host A controls is filed on D's pile. 17-earth-b and 178 assert the owner's pile.",
    evidence: "Findings F-U17-1 (dups F-U17-5, F-U17-8). batch-earth-b.ts: \"const list = byOwner.get(m.owner) ?? [];\". digital-rules.md: \"| `eraseMod` → **R65 erased pile** | `{ seat: mod.owner }` | `{ seat: mod.controller }` |\". 17-earth-b.test.ts: \"Return to Nature: each erased mod reaches its OWN owner's erased pile\". Measured by a verifier probe (not committed).",
    fix: "Group by m.controller (or let eraseMod file), and flip the 17-earth-b and 178 assertions to the controller with a real theft through giveControl.",
    proof: () => still('engine/src/cards/sets/batch-earth-b.ts', 'const list = byOwner.get(m.owner) ?? [];'),
    status: 'open',
  },
  {
    id: 259, area: "card", severity: "minor",
    cards: ["Return to Nature"],
    title: "Return to Nature files TOKEN mods on the erased pile, though a token mod erased off a living host is not filed",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule effects.mods.erase-off-host.token. R219: \"A token mod is not filed. R133: a token is not a card, and R65's pile is a list of cards.\" E.eraseMod honours it (it skips mod.token). Return to Nature files its own grouped erased line for every mod it erases off hosts that stay in play, token mods included, and its comment says so. Measured: a Wraith token mod erased by Return to Nature is recorded on the erased pile.",
    evidence: "Findings F-U17-4 (dup F-U17-6). digital-rules.md: \"- **A token mod is not filed.** R133: a token is not a card, and R65's pile is a\". batch-earth-b.ts: \"// this every card would be listed twice. This site also files TOKEN\". engine.ts: \"if (opts.leavesGame !== false && !opts.alreadyFiled && !mod.token) {\". Measured by a verifier probe (not committed).",
    fix: "Skip token mods when Return to Nature builds its grouped erased line (and fix the comment).",
    proof: () => still('engine/src/cards/sets/batch-earth-b.ts', 'This site also files TOKEN'),
    status: 'open',
  },
  {
    id: 260, area: "attribute", severity: "minor",
    title: "OWNER DECISION: Tough, Balanced, Inverted and the Unaware collapse stay on against a Pure card; Pure prints \"ignore all other attributes\"",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule attr.general.pure states print: \"Pure cards and cards they are interacting with ignore all other attributes.\" R289 (and R61 as it reads it) keeps the stat attributes on in a Pure pairing because \"they are stat layers\", and R106 says the combat Unaware collapse \"survives {Pure}\" while noncombat Pure switches Unaware off. Measured: a Pure source dealing 5 to Rampart Guardian leaves it alive as a Tough 0/8; a Balanced 4/1 dealt 3 by a Pure source survives as a 4/4. Filed because print outranks the R-rulings; waits on D-U19-2.",
    evidence: "Findings F-U19-1 (dup F-U19-2). printed.json: \"Pure cards and cards they are interacting with ignore all other attributes.\" digital-rules.md: \"{Tough}, {Balanced} and {Inverted} still read (they are stat layers, R61).\" and \"The collapse survives {Pure}: R61 switches the ATTRIBUTE layer off for an exchange, and\". Measured by verifier probes (not committed).",
    fix: "Ask the owner. If print wins, switch the stat-layer attributes and the Unaware collapse off in a Pure interaction, in combat and outside it alike.",
    proof: () => still('docs/digital-rules.md', '{Tough}, {Balanced} and {Inverted} still read (they are stat layers, R61).'),
    status: 'open',
  },
  {
    id: 261, area: "attribute", severity: "minor",
    cards: ["Spellbind"],
    title: "{Modular} would be shared through a column if a unit ever carried it (latent; no unit can today)",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule attr.modular.not-shared: Modular is not shared with the other units of a column (Caleb's \"Modular is also special\", R294). colAttrs unions every own attribute of every unit in the column, Modular included. Harmless only because the one Modular card (Spellbind) is a spell. 298 §5c guards that premise, not the non-sharing.",
    evidence: "Finding F-U20-3. engine.ts colAttrs: \"if (u) for (const a of this.ownAttrs(u)) set.add(a);\". digital-rules.md: \"statement. {Modular} *is* in `attrs`, and is harmless only because the one card\". The round-1 verifier confirmed colAttrs would union it.",
    fix: "Leave Modular out of colAttrs (one filter), and turn 298 §5c into a guard of the non-sharing itself.",
    proof: () => still('engine/src/engine.ts', 'if (u) for (const a of this.ownAttrs(u)) set.add(a);'),
    status: 'open',
  },
  {
    id: 262, area: "client", severity: "minor",
    title: "the automatic pass is latched per state counter, which the ruling on automatic answers rules out",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule annexd.auto-pass.automatic-answers. R245(b): an automatic answer (it names the haste-step ready and the automatic pass) is latched by being unanswered, never by a state counter, because states keep arriving while an intent is outstanding. The haste ready was converted (hasteAutoOut); the automatic pass still goes through takeAutoPass, keyed on actionCount, and 70 [59] asserts that a new state number re-opens the latch. A state with a new actionCount arriving while the pass is outstanding could send a second pass, which comes back refused.",
    evidence: "Findings F-U23-2 (dup F-U23-5). inspect.ts: \"if (latch.autoAt === actionCount || latch.sentFor === actionCount) return false;\". 70-playtest-round15.test.ts: \"assert.equal(takeAutoPass(plan, 41, latch), true, 'a new state is a new window');\". digital-rules.md: \"### (b) An automatic answer is latched by the FACT of being unanswered, never\".",
    fix: "Latch the automatic pass on \"sent and not yet answered\" (as hasteAutoOut does), clearing it on the server's answer, and update 70 [59].",
    proof: () => still('ui/inspect.ts', 'if (latch.autoAt === actionCount || latch.sentFor === actionCount) return false;'),
    status: 'open',
  },
  {
    id: 263, area: "card", severity: "minor",
    cards: ["Thought Extraction"],
    title: "looking at your OWN hand writes nothing in the other player's log, not even that a hand was looked at",
    detail: "(Comprehensive-rules export, Stage D, 2026-10-10.) CR rule annexd.reveal.hidden-names.look-at: when an effect lets a player look at a hand, the other players' log says only that the hand was looked at. Four look-at sites skip the public line when the looker owns the hand (if (who !== ctx.controller) g.revealHandTo(...)). Measured: Thought Extraction aimed at the caster's own hand leaves no look line in the other log; aimed at the other player's hand, that player's log says \"looks at\".",
    evidence: "Finding F-U24-5. batch-dark-b.ts: \"if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);\". Measured by the U24 tester probe (not committed): the other log goes from \"Resolving Thought Extraction:\" straight to the discard.",
    fix: "Write the public \"looks at a hand\" line for both cases, or narrow the convention to another player's hand. Owner's choice; the rule takes whichever is chosen.",
    proof: () => still('engine/src/cards/sets/batch-dark-b.ts', 'if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);'),
    status: 'open',
  },
  {
    id: 264, area: "card", severity: "minor",
    cards: ["Eldritch Dreamtender", "Cthyrian Rector", "Void Mandible"],
    title: "\"sacrifice me. If you do\" triggers sacrifice their source as the ability goes on the stack, not as it resolves",
    detail: "(Comprehensive-rules export, polish pass, 2026-10-10.) CR rule concepts.costs.trigger-sacrifice-me states print: Eldritch Dreamtender (\"When my column deals combat damage to an opponent, sacrifice me. If you do, look at that player's hand and discard a card from it.\"), Cthyrian Rector and Void Mandible print the sacrifice as effect prose after the trigger condition, with no [cost] bracket. So the ability goes on the stack with the unit still in play, players may respond, the unit is sacrificed as the ability resolves, and if it is gone by then the \"If you do\" part does nothing. The owner ruling that made it a cast cost reads the prose as a bracket and says itself the card has none; print outranks it (D-U04-2). The engine pays the sacrifice on the way to the stack, and 26-metal-a asserts that.",
    evidence: "Finding F-U04-5. 26-metal-a.test.ts: \"assert.ok(!ent(h, dt), 'sacrificed on the way to the stack, not at resolution');\". digital-rules.md: \"printed line is effect prose with an if-you-do rider rather than a printed\". Not re-measured against the engine in the polish pass (the drafter does not read engine source).",
    fix: "Move the three cards' sacrifice back into the effect, made as it resolves and skipped (with its rider) when the source has left play; keep it mandatory. Invert the 26-metal-a Dreamtender timing test, and mark the ruling as outranked by the printed text.",
    proof: () => still('engine/test/26-metal-a.test.ts', "assert.ok(!ent(h, dt), 'sacrificed on the way to the stack, not at resolution');"),
    status: 'open',
  },
];

/** The whole ledger, open and closed, in id order — the export every reader
 *  imports, exactly as before the split. */
export const CARD_TODO: TodoEntry[] = [...OPEN, ...CLOSED].sort((a, b) => a.id - b.id);
