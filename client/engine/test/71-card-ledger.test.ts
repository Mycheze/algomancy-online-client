/**
 * The card ledger has to be true, or it is worse than nothing.
 *
 * `card-ledger.ts` declares, card by card, which printed clauses do nothing.
 * These assertions make that declaration checkable in both directions:
 *
 *  1. SWEEP → LEDGER. Every card whose definition is bare-but-printed, or
 *     carries an ability that provably cannot do anything, must have an entry.
 *     This is the assertion that would have caught Harbinger of Immolation.
 *  2. LEDGER → REALITY. Every entry must still be needed. If a card gets
 *     implemented and its entry is left behind, this fails and says so.
 *  3. A TALLY, printed on every run, so the number of dead card halves cannot
 *     be quietly ignored.
 *
 * WHY (1) IS SHAPED THE WAY IT IS
 *
 * Harbinger's dead half was, verbatim:
 *
 *     augmentText: [{
 *       type: 'triggered', events: [],   // PARKED — never fires
 *       label: 'your spell tokens stay through regroup (not implemented)',
 *       effect: { run: () => {} },
 *     }]
 *
 * `events: []` means the trigger is registered against nothing, so it can
 * never fire under any game state — that is not a bug you have to reproduce,
 * it is a property you can read off the definition. The sweep reads exactly
 * those properties, which is why it has teeth a `{todo:true}` test does not:
 * a todo cannot fail, and this can. (See the head of card-ledger.ts for the
 * incident.)
 *
 * The sweep is a FLOOR, not the truth. Some dead halves have no readable
 * shape at all — Suspend collects a target, names the player and then does
 * nothing, which looks like working code — so the ledger is deliberately
 * larger than the sweep. Assertion (2) is what keeps the extra entries honest.
 *
 * (2) FOLLOWS THE HOUSE PATTERN in 68-target-conformance.test.ts: every
 * exemption is listed with its reason, and the list is asserted to be exactly
 * right, so an entry that stops being needed fails as loudly as a card that
 * stops being covered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// R214: the PUBLIC entry point, not `cards/registry.ts`. registry.ts registers
// only 494 of the 495 cards — the third synthetic (`Alluring Attribute`) is
// registered by `src/apply.ts`, which index.ts pulls. See the pool-sight floor
// at the foot of this file and test/180-pool-sight.test.ts.
import '../src/index.ts';
import { allCardNames, getCard, registerSynthetic } from '../src/cards/dsl.ts';
import type { Ability, CardDef, EffectDef } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { CARD_LEDGER, type CardLedgerEntry } from '../../ledgers/card-ledger.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

// ── reading a card definition's shape ───────────────────────────────────

/**
 * The printed text with everything that is NOT rules text stripped out, so
 * "bare definition" can be judged against "does this card actually say
 * anything".
 *
 * This matters because MOST bare definitions are correct. Tempest Wrangler is
 * `card('Tempest Wrangler', {})` and that is right: its only ability is the
 * type-line {Alluring} attribute, which comes from printed data. Twenty-five
 * cards in the pool are bare with no printed text at all. What is stripped:
 *
 *  - reminder text — `{i}(…)` and bare parentheticals. "(Any combat damage
 *    from a lethal unit will kill a player.)" is a rules REMINDER of an
 *    engine-side attribute, not text the card has to implement.
 *  - markup tokens — `{/n}`, `{p}`, `{g}`, `{i}`, `{/i}`.
 *  - the Ambush banner, when printed.ambush carries it. The mode is engine
 *    level (R22) and the banner is not the card's own text — that is why Good
 *    Whale, Orblish Horroth, Lurking Slimebeast and Shib are correctly bare.
 *  - a "Discard me" banner, when printed.discardMe carries it (R40), for the
 *    same reason.
 *  - the [Augment] / [once] / [Switch] markers, which are structure.
 */
export function meaningfulText(c: CardDef): string {
  let t = c.text ?? '';
  t = t.replace(/\{i\}\s*\([^)]*\)\s*(\{\/i\})?/g, ' ')
       .replace(/\([^)]*\)/g, ' ')
       .replace(/\{\/?[a-z0-9]+\}/gi, ' ');
  if (c.ambush) t = t.replace(/(\[[^\]]*\]\s*)*Ambush(\s*\[[^\]]*\])*/gi, ' ');
  if (c.discardMe) t = t.replace(/(\[[^\]]*\]\s*)*Discard\s+me\.?/gi, ' ');
  return t.replace(/\[Augment\]|\[once\]|\[Switch\d?\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

const source = (f: unknown) => typeof f === 'function' ? f.toString() : '';
/** function source with comments and string literals removed, so a comment
 *  saying "PARKED" and a runtime log saying it can be told apart */
const bare = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");

/**
 * What an effect's `run` actually does.
 *
 *   'empty'    — nothing but comments and braces. (Harbinger's.)
 *   'log-only' — calls `g.ev(…)` and nothing else, and mutates nothing. An
 *                effect that only writes to the log changes no game state, so
 *                it does not implement anything. Scholar of the Void and
 *                Prediction Prophet are this shape: they log the gap instead
 *                of being invisible, which is better hygiene and still dead.
 *   'real'     — touches state somewhere.
 */
function runShape(f: unknown): 'none' | 'empty' | 'log-only' | 'real' {
  const s = source(f);
  if (!s) return 'none';
  const arrow = s.indexOf('=>');
  if (arrow < 0) return 'real';                    // a non-arrow body: assume it works
  const body = bare(s.slice(arrow + 2));
  if (!body.replace(/[{}\s;]/g, '')) return 'empty';
  const calls = [...body.matchAll(/\bg\.(\w+)\s*\(/g)].map(m => m[1]!);
  const mutates = /[^=!<>]=[^=>]/.test(body) || /\+\+|--|\bpush\(|\bdelete\b/.test(body);
  return (!mutates && calls.length && calls.every(n => n === 'ev')) ? 'log-only' : 'real';
}

/** the card says so itself, in an ability LABEL — prose, so read loosely */
const admitsTheGap = (s: string) => /PARKED|not implemented/i.test(s);
/**
 * The same, read in CODE — `bare()` has already stripped the comments and the
 * string literals, so the only thing left that can "say PARKED" is an
 * IDENTIFIER, and a case-insensitive match on one is a false positive waiting
 * to happen. It happened: R118 gave Borrower of Forms
 * `const parked = g.takeCopySource(…)`, a perfectly live line, and the sweep
 * read it as the card admitting it does nothing. A real park note is written
 * `PARKED`, in caps, every time — so the marker word is case-SENSITIVE here
 * and only here. Verified against the whole pool: this is the only card whose
 * verdict changes, and it changes from wrong to right.
 */
const codeAdmitsTheGap = (s: string) => /PARKED|not implemented/.test(s);

const BEHAVIOR_KEYS = [
  'xMin', 'abilities', 'statics', 'costMods', 'effectAttrs', 'augmentable', 'mustBeTargeted',
  'prophesyFromBin', 'playsIntoFormation', 'spellEffect', 'graftEffect', 'augmentText',
  // R123: a bin-anchored haste grant (Writhing Host) and a card's own
  // played-from-your-bin line (Trench Stalker) are whole-card behaviour with
  // no abilities and no live spellEffect run, so the sweep has to see them.
  'binPlayPermissions', 'playsFromBin',
  'replaceRotDamage', 'replaceCombatDamageToPlayer', 'xPreview', 'xPreviewRows',
  // a preview is presentation, not behaviour — but a card carrying ONLY one
  // would otherwise read as a bare definition, same as the two above
  'previewNote',
  // R104's replacement-effect layer. A card whose whole text is a replacement
  // has no abilities and no spellEffect BY CONSTRUCTION — that is the point of
  // the layer, not a gap — so the sweep has to see these or every one of the
  // seven cards report #60 named would read as a bare definition the moment it
  // was fixed. (Cosmic Conspirator did exactly that until this line existed.)
  // R162 adds the multiplicative half of that layer (Arbiter of Vitality).
  'amountMods', 'amountMultipliers', 'replaceLifeGain', 'replaceCounters',
  'replaceTokenCreation', 'replaceTokenBatch',
  // Worldbender's whole text is a card-step replacement (report #87), so it
  // has no abilities and no spellEffect by construction — same reason as the
  // R104 hooks above.
  'replaceCardStep',
  // R178: Maelstrom Charger's whole text is an AS-YOU-PLAY option — a
  // cost-shaped, non-stack decision collected in the cast window — and the
  // designer's ruling is that it is *"neither Triggered nor Activated"*, so
  // it has no abilities and no spellEffect BY CONSTRUCTION. Same reason as the
  // R104 hooks above: without this line the card reads as a bare definition
  // the moment it is built the way the RAQ describes.
  'asYouPlay',
] as const;

/**
 * Every readable reason to believe part of this card does nothing. Empty means
 * the definition looks alive — which is NOT the same as being alive, hence the
 * ledger's hand-listed entries.
 */
export function deadShapes(name: string): string[] {
  const c = getCard(name);
  const out: string[] = [];

  // (a) bare definition, but the card prints rules text. Correct for a vanilla
  //     card, damning for one with text — Writhing Host, Rotling and Trench
  //     Stalker are all just `card('X', {})`.
  //
  //     R155: an EMPTY array does not count as behaviour. `statics: []` is
  //     `!== undefined`, so before this the one-line difference between
  //     `card('X', {})` and `card('X', { statics: [] })` was the difference
  //     between "the sweep demands a ledger entry" and "the sweep says fine" —
  //     for two definitions that do exactly the same nothing.
  if (!BEHAVIOR_KEYS.some(k => hasBehaviour(c, k)) && meaningfulText(c)) {
    out.push('bare definition, but the card prints rules text');
  }

  const abilities: [string, Ability][] = [
    ...(c.abilities ?? []).map((a, i) => [`abilities[${i}]`, a] as [string, Ability]),
    ...(c.augmentText ?? []).map((a, i) => [`augmentText[${i}]`, a] as [string, Ability]),
  ];
  for (const [where, a] of abilities) {
    // (b) THE HARBINGER SHAPE. A triggered ability registered against no
    //     events cannot fire under any game state, ever.
    if (a.type === 'triggered' && !a.events?.length) {
      out.push(`${where}: events:[] — the trigger can never fire`);
      continue;
    }
    const shape = runShape(a.effect?.run);
    // An empty run is fine when a `when()` is doing the work: the bookkeeping
    // pattern (Powerforge Synergist, Ancient One; Mirage Walker used it too
    // until #86 moved its fact into the reducer) mutates in
    // when() and returns false so the trigger never queues. Harbinger had no
    // when(), which is why it is caught and they are not.
    // `when` lives on TriggeredAbility only; an activated ability has none, so
    // an empty activated run is always a gap.
    const guarded = a.type === 'triggered' && !!a.when;
    if (shape === 'empty' && !guarded) out.push(`${where}: run body is empty`);
    if (shape === 'log-only') out.push(`${where}: run only writes to the log`);
    if (codeAdmitsTheGap(bare(source(a.effect?.run))) || admitsTheGap(a.label ?? '')) {
      out.push(`${where}: says PARKED / not implemented in its own text`);
    }
  }

  const effects: [string, EffectDef | undefined][] = [
    ['spellEffect', c.spellEffect], ['graftEffect', c.graftEffect?.effect],
  ];
  for (const [where, e] of effects) {
    if (!e) continue;
    const shape = runShape(e.run);
    if (shape === 'empty') out.push(`${where}: run body is empty`);
    if (shape === 'log-only') out.push(`${where}: run only writes to the log`);
    if (codeAdmitsTheGap(bare(source(e.run)))) out.push(`${where}: says PARKED / not implemented`);
  }

  // (d) R155: the shapes (a)-(c) are structurally blind to — a gap written as
  //     a STATIC, a COST MOD or a `when()` rather than as a `run` body.
  out.push(...inertShapes(name));

  return [...new Set(out)];
}

/* ── R155: THE STATIC/FLAG BLIND SPOT ─────────────────────────────────────
 *
 * Everything above reads bare definitions and `run` bodies. It is blind to a
 * dead half expressed as a STATIC or a FLAG, and that is not a hypothetical
 * hole: the two cards that have most recently been mistaken for parked are
 * exactly that shape. Harbinger of Immolation — the card this whole file is
 * named after — was fixed into `statics: [{ affects, survivesRegroup: true }]`
 * with no `run` anywhere; Arbiter of Armistice's entire printed text is one
 * `costMods` entry. A dead one of either would have read as a live card, and
 * the sweep→ledger assertion would not have asked for a ledger entry.
 *
 * WHAT THIS SWEEP CAN SEE — literals, and only literals:
 *
 *   · a behaviour key that is PRESENT but EMPTY (`statics: []`, `costMods: []`,
 *     `abilities: []`). Also folded into (a) above, because an empty array
 *     defeated the bare-definition check for free.
 *   · a `StaticMod` that projects NOTHING: no `dp`/`dt`/`baseP`/`baseT`/
 *     `attrs`/`suppressAttrs`/`suppressAbilities`/`survivesRegroup` at all, or
 *     every one it does carry provably zero (`0`, `false`, `[]`, `() => 0`).
 *   · a predicate whose entire body is the literal `false`: `affects: () =>
 *     false` (a static that can match nothing) and `when: () => false` (a
 *     trigger that can never queue).
 *   · a `CostMod` with no `delta`/`life`/`sacrifice` at all, or whose every
 *     present channel is a constant `0`.
 *
 * WHAT IT CANNOT SEE, and never will — stated plainly, because a check that is
 * trusted for more than it measures is CARD-TODO #9's 97-card phantom band:
 *
 *   · whether an arbitrary predicate can ever match. `affects: (g, self, t) =>
 *     t.kind === 'unit'` on a card whose text is about spell tokens matches
 *     nothing, forever, and reads here as perfectly live. (Harbinger's own
 *     definition carries a comment warning about precisely that mistake.)
 *     Deciding it is deciding an arbitrary program; this sweep does not try.
 *   · a `when()` gated on a state the card's events never produce, or a cost
 *     function whose arithmetic happens to cancel to zero on every real board.
 *   · a live flag whose READER was deleted — `survivesRegroup: true` is not
 *     inert by shape even if nothing in engine.ts asks about it any more.
 *   · anything at all about whether the behaviour matches the PRINTED TEXT. A
 *     card can carry a fully live static implementing the wrong sentence, and
 *     that is bands 3-4 in 90-coverage-census, not this.
 *
 * So this is a narrow net, deliberately. It catches the author who wrote the
 * scaffold and never filled it in — which is the shape a park takes when
 * somebody stops using the word PARKED.
 */

/** the channels a `StaticMod` can project through. `affects` is the predicate;
 *  a static carrying none of these changes nothing about anything it matches. */
const STATIC_EFFECTS = ['dp', 'dt', 'baseP', 'baseT', 'attrs',
  'suppressAttrs', 'suppressAbilities', 'survivesRegroup'] as const;
/** the channels a `CostMod` can charge through */
const COST_CHANNELS = ['delta', 'life', 'sacrifice'] as const;

/** a behaviour key that is present AND carries something. An empty array is
 *  not behaviour, however `!== undefined` it is. */
function hasBehaviour(c: CardDef, k: string): boolean {
  const v = (c as unknown as Record<string, unknown>)[k];
  return v !== undefined && !(Array.isArray(v) && v.length === 0);
}

/** is this function's WHOLE body the literal `lit` and nothing else?
 *  Comments and strings are stripped first (`bare`), so a note explaining a
 *  `false` cannot make one. A body that MUTATES on the way to its return value
 *  is not constant, which is what keeps the bookkeeping pattern out of this —
 *  a `when()` that does its work and returns false so the trigger never queues
 *  (Powerforge Synergist, Ancient One) has statements before the `false`. */
function isConstBody(f: unknown, lit: string): boolean {
  const s = bare(source(f));
  const arrow = s.indexOf('=>');
  if (arrow < 0) return false;              // not an arrow function: assume it works
  const body = s.slice(arrow + 2).replace(/\s+/g, '');
  return body === lit || body === `{return${lit};}` || body === `{return${lit}}`;
}

/** a static's channel that provably contributes nothing */
function nilChannel(v: unknown): boolean {
  if (v === undefined || v === 0 || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'function') return isConstBody(v, '0') || isConstBody(v, 'false');
  return false;
}

export function inertShapes(name: string): string[] {
  const c = getCard(name);
  const raw = c as unknown as Record<string, unknown>;
  const out: string[] = [];

  for (const k of BEHAVIOR_KEYS) {
    const v = raw[k];
    if (Array.isArray(v) && v.length === 0) out.push(`${k}: [] — the key is present but empty`);
  }

  // R268: a clause printed inside the [Augment] box lives in `augmentBox`, and
  // 44 cards' statics, cost mods and replacement hooks moved there. This sweep
  // exists to notice a dead clause; reading only the body half would have made
  // it blind to 47 of them at once — "a refactor that renamed `statics`",
  // exactly as the header above this test predicts.
  const box = c.augmentBox ?? {};

  ([...(c.statics ?? []), ...(box.statics ?? [])]).forEach((m, i) => {
    const s = m as unknown as Record<string, unknown>;
    if (isConstBody(m.affects, 'false')) {
      out.push(`statics[${i}]: affects is a constant false — it can match nothing`);
    }
    if (STATIC_EFFECTS.every(k => nilChannel(s[k]))) {
      out.push(`statics[${i}]: projects nothing — every effect channel is absent or zero`);
    }
  });

  ([...(c.costMods ?? []), ...(box.costMods ?? [])]).forEach((m, i) => {
    const cm = m as unknown as Record<string, unknown>;
    const present = COST_CHANNELS.filter(k => cm[k] !== undefined);
    if (!present.length) out.push(`costMods[${i}]: no delta/life/sacrifice — it charges nothing`);
    else if (present.every(k => isConstBody(cm[k], '0'))) {
      out.push(`costMods[${i}]: every cost channel returns a constant 0`);
    }
  });

  const guards: [string, Ability][] = [
    ...(c.abilities ?? []).map((a, i) => [`abilities[${i}]`, a] as [string, Ability]),
    ...(c.augmentText ?? []).map((a, i) => [`augmentText[${i}]`, a] as [string, Ability]),
  ];
  for (const [where, a] of guards) {
    if (a.type === 'triggered' && a.when && isConstBody(a.when, 'false')) {
      out.push(`${where}: when() is a constant false — the trigger can never queue`);
    }
  }
  return out;
}

/**
 * Cards the sweep flags that are genuinely FINE, each with its reason — the
 * 68-target-conformance pattern. Kept tiny on purpose: every name here is a
 * hole in the net, so an entry has to earn itself.
 */
const RESOURCE_FACE_REASON =
  'The printed "When I activate … create a Shard" clause is the MANUAL p.18 general '
  + 'rule reprinted on the card as a reminder, not card-specific behaviour. It is '
  + 'implemented in apply.ts::maybeGrantShard for ALL SEVEN elements and verified on '
  + 'the real activateResource path (12-fire-a conformance sweep). printed.json has '
  + 'only three Resource faces (fire/water/earth), so routing the rule through card '
  + 'definitions would drop the bonus for wood/metal/light/dark and double it for '
  + "these three. `card('X Resource', {})` is the correct definition. See R116.";

const NOT_A_GAP: Record<string, string> = {
  Grox:
    'The [Switch] socket carries no text of its own — the whole ability is a graft '
    + 'CAUSE, and its real payload is the R64 `castCost: { kind: \'eraseBin\', n: 2 }` '
    + 'that gates the activation. The log line exists because an effect resolving in '
    + 'silence is indistinguishable from a bug (test/65-effect-conformance).',
  'Cadaverous Cultivator':
    'Same shape as Grox: a repeatable graft cause whose [Switch] prints no text. The '
    + 'cost (`{ discard: 1 }`) and the [Battle] timing are both real and both gate '
    + 'the activation; the run only announces that the cost was paid.',
  Robot:
    '"I spawn with X +1/+1 counters on me" IS implemented — at every creation site, '
    + 'as spawnUnit(..., { token: true, counters: X }). The token has no behaviour of '
    + 'its own to carry, so `card(\'Robot\', {})` is the correct definition.',
  'T71 Canary':
    'The sweep\'s own SYNTHETIC canary, registered by this file (see the canary '
    + 'test): it deliberately carries the Harbinger shape so the detector is proved '
    + 'on every run. It is not a pool card and has no ledger entry — this exemption '
    + 'is what keeps the sweep→ledger assertion from demanding one.',
  'T71 Inert Canary':
    'The R155 canary, and the same deal as T71 Canary one line up: a SYNTHETIC card '
    + 'registered by this file carrying every inert LITERAL shape at once, so the '
    + 'static/cost/when detector is proved on every run rather than the day somebody '
    + 'needs it. Not a pool card, no ledger entry, exempted so the sweep→ledger '
    + 'assertion does not demand one.',
  'Trench Stalker':
    'The spellEffect exists solely to carry the R49 "[Discard two cards]" CAST COST, '
    + 'chosen and paid in the cast window on every route into play (hand and bin '
    + 'alike, R123). Its empty run is unreachable BY CONSTRUCTION, not a gap: a '
    + "'unit' StackItem resolves by spawning (resolveItem returns before parts ever "
    + 'run), so there is no resolution body to implement. The other two printed '
    + 'clauses are live behaviour flags — R29 playsIntoFormation and R123 '
    + 'playsFromBin — with real tests in 46-hybrids-ld-c.test.ts.',

  // ── the three [element] Resource faces (2026-08-23) ────────────────────
  //
  // These carried `gap: 'dead'` ledger entries for weeks, waiting on "the
  // resource-CARD model and a dispatched activation event". That was WRONG,
  // and it is the exact failure mode this file was built to catch, running in
  // the other direction: not a park note outliving its reason, but a park note
  // that never had one. The clause was never card behaviour.
  //
  // "When I activate, if you have at least [r][r][r], create a Shard. {i}(It
  // spawns dormant.)" is the MANUAL p.18 GENERAL RULE, printed on the physical
  // card as a reminder — the same way a land prints its own tap symbol. It is
  // implemented once, in `apply.ts::maybeGrantShard`, and it fires for ALL
  // SEVEN elements. Verified on the real `activateResource` action path, not
  // by inspection (12-fire-a's conformance sweep drives every element).
  //
  // ⚠ DO NOT "IMPLEMENT" THESE CARDS. `printed.json` carries only three
  // Resource faces — fire, water, earth. There is no Wood/Metal/Light/Dark
  // Resource face to hang the rule on. Routing it through card definitions
  // would silently DROP the bonus for four of the seven elements (a live
  // regression, traded for making a park note go away); keeping both would
  // grant two Shards. `card('X Resource', {})` is the correct definition, for
  // the Robot reason: the printed text carries no behaviour the card owns.
  // See R116 and R54's 2026-08-23 correction.
  'Fire Resource': RESOURCE_FACE_REASON,
  'Water Resource': RESOURCE_FACE_REASON,
  'Earth Resource': RESOURCE_FACE_REASON,

  // ── R214 (2026-08-26) ──────────────────────────────────────────────────
  //
  // The card this ledger could not see. Until R214 this file imported
  // `src/cards/registry.ts` alone, which registers 494 of the 495 cards —
  // `Alluring Attribute` is registered by `src/apply.ts`. So the "no dead
  // cards" clean sheet below covered 494 cards while reading as though it
  // covered the pool. Widening the import to `src/index.ts` made BOTH sweeps
  // in this file go red on it at once, which is the correct outcome and the
  // proof the blindness was load-bearing here rather than cosmetic.
  'Alluring Attribute':
    'R84/R214. `abilities[0].when` really is `() => false`, and that is deliberate rather '
    + 'than a scaffold: the trigger is NEVER queued by the event system. `apply.ts::'
    + 'queueAlluringTriggers` pushes it onto `s.triggerQueue` by hand from '
    + '`doDeclareAttack`, because the thing that fires is a COLUMN attribute and no '
    + 'entity in play owns the ability. The card exists only so `effectByKey` can '
    + 'resolve `ability:Alluring Attribute#0` when Divine Intervention / Gravitational '
    + 'Correction / Hexbane Shiitake retarget the trigger. `when` is belt-and-braces '
    + 'against a scan finding it anyway, and its comment in apply.ts says so. The '
    + 'behaviour is live and tested — R84, and 68-target-conformance now reads its '
    + "declared 'enemyUnit' kind off the printed text, which before R214 it could not "
    + 'see either.',
};

/* ── R210 (CT-83) · THE STALENESS ASSERTION NOT_A_GAP NEVER HAD ─────────
 *
 * `NOT_A_GAP` had NINE entries and ZERO assertions. Its only four references
 * were `if (name in NOT_A_GAP) continue;` skip-filters and two mentions in
 * failure prose — so an entry whose card was implemented, renamed or deleted
 * went on waiving nothing, forever, and the list could only ever grow. That
 * is the exact failure CT-68 caught in `DEAD_EXEMPT` (R174 wrote entries for
 * two helpers, R181 deleted the helpers, the entries sat on for a round) —
 * running here on the file whose entire subject is a claim outliving its
 * reason.
 *
 * The check is deliberately NOT "the reason string is long enough", which is
 * how `SILENT_KNOWN`'s reasons are guarded in 65-effect-conformance and which
 * a stale reason passes trivially. It re-derives the fact from the registry:
 * an exemption exists to stop a DETECTOR firing, so if neither detector fires
 * on that card any more, the exemption is waiving nothing and has to go.
 */
test('CT-83: every NOT_A_GAP exemption still waives a real sweep hit', () => {
  const registered = new Set(allCardNames());
  const stale: string[] = [];

  for (const [name, why] of Object.entries(NOT_A_GAP)) {
    if (!registered.has(name)) {
      stale.push(`${name}: NOT_A_GAP exempts it, but it is not a registered card. Either it was `
        + 'renamed/removed (delete the entry), or this file has lost sight of part of the pool '
        + `— see the R214 pool floor at the foot of this file. (Was: ${why.slice(0, 80)}…)`);
      continue;
    }
    const dead = deadShapes(name);
    const inert = inertShapes(name);
    if (!dead.length && !inert.length) {
      stale.push(`${name}: NOT_A_GAP exempts it, but NEITHER sweep flags it any more — `
        + 'deadShapes() and inertShapes() both come back empty. The exemption has done its '
        + `job and is now a hole in the net that nobody is watching. Delete it. (Was: ${why})`);
    }
  }

  assert.deepEqual(stale, [],
    'NOT_A_GAP entries that have outlived their reason:\n  ' + stale.join('\n  ')
    + '\n\nAn exemption is a claim about the code AS OF THE DAY IT WAS WRITTEN. This list '
    + 'carried nine of them for months with nothing checking any of them.');

  // The denominator, so the assertion above cannot pass by scanning nothing.
  assert.ok(Object.keys(NOT_A_GAP).length >= 9,
    `NOT_A_GAP is down to ${Object.keys(NOT_A_GAP).length} entries — if that is a real `
    + 'deletion, lower this floor in the same commit; if it is not, something has emptied '
    + 'the table and this test is now vacuous.');
});

// ── (1) SWEEP → LEDGER: the assertion that would have caught Harbinger ──

test('every card with a readably-dead half is declared in the card ledger', () => {
  const byName = new Map(CARD_LEDGER.map(e => [e.card, e]));
  const undeclared: string[] = [];
  for (const name of allCardNames()) {
    if (name in NOT_A_GAP) continue;
    const shapes = deadShapes(name);
    if (shapes.length && !byName.has(name)) undeclared.push(`${name} — ${shapes.join('; ')}`);
  }
  assert.deepEqual(undeclared, [],
    'these cards have a half that provably does nothing and no ledger entry:\n  '
    + undeclared.join('\n  ')
    + '\n\nAdd an entry to ledgers/card-ledger.ts quoting the printed clause from '
    + 'printed.json, or — if the shape is a false positive — add the card to '
    + 'NOT_A_GAP with a reason. Do NOT resolve this by adding a { todo: true } '
    + 'test: a todo can never fail, which is exactly how Harbinger of Immolation '
    + 'stayed dead through two playtest reports and a conceded game.');
});

// The sweep's canary, SYNTHETIC as of 2026-08-24. It was a real parked card
// five times over — Harbinger → Envoy of Lightning → Conduit → Crevice Lurker
// → Vengeance — and each time the card got built, the canary had to move.
// The 2026-08-24 round un-parked EVERY remaining ledger card (R120-R124,
// the bin seams), so the musical chairs ended: the shape now lives on a card
// registered by this file alone, byte-for-byte what Harbinger had — an inert
// augmentText entry, `events: []`, an empty run, a label ending "(not
// implemented)". It is exempted in NOT_A_GAP (it is not a pool card, so it
// carries no ledger entry — the declared-ness of REAL dead cards is what the
// sweep→ledger assertion above proves, over the whole pool, on every run).
registerSynthetic({
  name: 'T71 Canary', cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [],
  text: '[Augment] Canary clause that does nothing.', image: '',
}, {
  augmentText: [{
    type: 'triggered', events: [],   // the Harbinger shape, on purpose
    label: 'canary clause (not implemented)',
    effect: { run: () => {} },
  }],
});

test('the sweep has teeth: it recognises the shape Harbinger of Immolation was fixed out of', () => {
  const CANARY = 'T71 Canary';
  const shapes = deadShapes(CANARY);
  assert.ok(shapes.some(s => /events:\[\]/.test(s)),
    `${CANARY} no longer reads as the inert-augment shape — the detector has lost `
    + 'its teeth. Fix deadShapes, do not touch the canary.');

  // And the negative half: the sweep must NOT fire on the bookkeeping pattern,
  // or it would be noise and get suppressed. Powerforge Synergist has an empty
  // run guarded by a when() that does the work; Tempest Wrangler is bare
  // because it is genuinely vanilla ({Alluring} comes from printed data).
  for (const fine of ['Powerforge Synergist', 'Tempest Wrangler', 'Mirage Walker', 'Ancient One']) {
    assert.deepEqual(deadShapes(fine), [],
      `${fine} is correctly implemented and must not be flagged — a sweep that cries `
      + 'wolf is a sweep that gets ignored');
  }
});

// ── R155: the second canary, for the static/cost/when blind spot ─────────
//
// Same device as T71 Canary and for the same reason — a detector nobody
// exercises is a detector that quietly stops working — but carrying the
// shapes `deadShapes` could not see before R155. Every field on it is inert
// in a way that is decidable by READING it, which is the only thing
// `inertShapes` claims to catch (see its doc comment for the rest).
registerSynthetic({
  name: 'T71 Inert Canary', cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [],
  text: 'My allies gain +1/+1. Cards cost one more. When I attack, do nothing.',
  image: '',
}, {
  effectAttrs: [],                                   // present, but empty
  costMods: [
    { delta: () => 0 },                              // charges a constant nothing
    {},                                              // no channel at all
  ],
  statics: [
    { affects: () => false, dp: 1, dt: 1 },          // real projection, matches nothing
    { affects: (_g, self, t) => t.controller === self.controller },   // matches, projects nothing
    { affects: (_g, self, t) => t.controller === self.controller, dp: 0, dt: () => 0, attrs: [] },
  ],
  abilities: [{
    type: 'triggered', events: ['attacked'],
    when: () => false,                               // can never queue
    label: 'canary trigger behind a constant-false guard',
    // a REAL run on purpose: the point is that runShape says 'real' and the
    // ability is still dead, which is the whole shape of this blind spot.
    effect: { run: (g) => { g.s.turn += 0; } },
  }],
});

test('R155: the sweep sees a gap written as a static, a cost mod or a when() — and says what it cannot see', () => {
  const shapes = inertShapes('T71 Inert Canary');
  const wanted = [
    /effectAttrs: \[\]/,                             // an empty behaviour key
    /statics\[0\]: affects is a constant false/,     // a static that matches nothing
    /statics\[1\]: projects nothing/,                // a static with no channel
    /statics\[2\]: projects nothing/,                // every channel present but zero
    /costMods\[0\]: every cost channel returns a constant 0/,
    /costMods\[1\]: no delta\/life\/sacrifice/,
    /abilities\[0\]: when\(\) is a constant false/,
  ];
  for (const re of wanted) {
    assert.ok(shapes.some(s => re.test(s)),
      `the R155 detector no longer recognises ${re} — it has lost that tooth. Fix `
      + `inertShapes, do not touch the canary. (It reported: ${shapes.join(' | ')})`);
  }
  // and it must reach the sweep→ledger assertion, not just live beside it
  assert.ok(deadShapes('T71 Inert Canary').length >= wanted.length,
    'inertShapes is not folded into deadShapes, so the ledger sweep is still blind to it');

  // THE POSITIVE CONTROLS, and the reason they are these two cards: they are
  // the exact shapes this hole would have hidden, and both are LIVE.
  //  · Harbinger of Immolation — the card this file is named after. Its fixed
  //    [Augment] half is `statics: [{ affects, survivesRegroup: true }]`: no
  //    run, no events, nothing (a)-(c) can read.
  //  · Arbiter of Armistice — its ENTIRE printed text is one `costMods` entry
  //    (R60's life channel), so a bad sweep would call the whole card dead.
  //  · Life Power Dude carries a literal `dt: 0` beside a live `dp`, which is
  //    the false positive the "every channel is zero" rule has to avoid.
  //  · Beyond, Codex Incarnate's static grants `attrs: ['Inverted']` and
  //    nothing else — a non-stat channel, which the rule must still count.
  for (const live of ['Harbinger of Immolation', 'Arbiter of Armistice',
    'Life Power Dude', 'Beyond, Codex Incarnate', 'Vengeance', 'Tranquility']) {
    assert.deepEqual(inertShapes(live), [],
      `${live} is LIVE and must not be flagged. A static/cost sweep that cries wolf on `
      + 'working cards gets suppressed, and then the next Harbinger walks straight past it.');
  }
});

// ── (2) LEDGER → REALITY: an entry that stops being needed must fail ────

/** cache each cited test file's source */
const sources = new Map<string, string | null>();
function sourceOf(rel: string): string | null {
  if (!sources.has(rel)) {
    const p = path.join(HERE, rel);
    sources.set(rel, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  }
  return sources.get(rel)!;
}
/**
 * Every `test(…)` in a file, with its title and whether it is a todo.
 *
 * Parsed from the call HEADER — everything between `test(` and the callback's
 * `=>` — because titles in this repo are routinely string concatenations that
 * themselves contain parentheses ("… (PARKED: a rules question — needs Bena)"),
 * so a regex that stops at the first `)` reads the options object as part of
 * the title and misses `{ todo: true }` entirely. The title is every string
 * literal in the header joined, which makes `includes(needle)` work across a
 * concatenation.
 */
function todoTitles(src: string): { title: string; todo: boolean }[] {
  const out: { title: string; todo: boolean }[] = [];
  for (const m of src.matchAll(/\btest\s*\(/g)) {
    const arrow = src.indexOf('=>', m.index);
    if (arrow < 0) continue;
    const header = src.slice(m.index, arrow);
    const literals = [...header.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(x => x[2]!);
    if (!literals.length) continue;
    out.push({ title: literals.join(''), todo: /todo\s*:\s*true/.test(header) });
  }
  return out;
}

test('every ledger entry names a real card and says what is missing', () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of CARD_LEDGER) {
    if (seen.has(e.card)) problems.push(`${e.card}: duplicate ledger entry`);
    seen.add(e.card);
    try { getCard(e.card); } catch { problems.push(`${e.card}: no such card any more`); continue; }
    // The clause has to be quoted, not gestured at — the owner reads this list
    // against the physical cards.
    if (e.missing.trim().length < 15) problems.push(`${e.card}: "missing" must quote the printed clause`);
    if (e.waitingOn.trim().length < 30) problems.push(`${e.card}: "waitingOn" needs a reason, not a shrug`);
    if (e.unverified && !e.note?.trim()) {
      problems.push(`${e.card}: marked unverified with no note saying what was and was not checked`);
    }
    // onlyTrackedHere means no automation can ever re-confirm this entry, so
    // the note has to carry how it WAS confirmed. Without that it is a park
    // comment again, just in a different file.
    if (e.onlyTrackedHere && !e.note?.trim()) {
      problems.push(`${e.card}: onlyTrackedHere with no note saying how the gap was confirmed`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every ledger entry is still needed — delete it when the card is implemented', () => {
  // THE SELF-INVALIDATION. This is the property that keeps the ledger from
  // rotting into the same kind of lie the PARKED comments became: a park note
  // outlives its reason silently (Infernal Wispweaver waited on a suppression
  // layer that had already shipped), and an entry here cannot.
  //
  // An entry stays justified while at least one channel of evidence holds:
  //   · the shape sweep still flags the card, or
  //   · the { todo: true } test it names still exists AND is still a todo, or
  //   · the printed attribute it names is still printed AND the engine still
  //     carries the unimplemented-stat-layer placeholder, or
  //   · it says so itself with `unverified` (which the tally counts, loudly).
  const engineSrc = fs.readFileSync(path.join(ENGINE, 'src', 'engine.ts'), 'utf8');
  // PER ATTRIBUTE, because the two stat layers did not ship together. Stat
  // layer 5 landed in round 17 (R93: {Inverted} negates the net change from
  // base) and stat layer 6 landed on 2026-08-23 (R106: an {Unaware} card, and
  // everything it fights or damages, reads at PRINTED stats). BOTH are code
  // now, so neither attribute has one left to point at and a `deadAttr` entry
  // naming either has lost that channel of evidence for good — which is the
  // file's designed outcome, not a bug in it: the cards work now and the
  // entries are what is left behind. The map stays, with the shape it needs
  // for the NEXT unbuilt layer; a `null` means "shipped, delete the entry".
  const LAYER_PLACEHOLDER: Record<'Unaware' | 'Inverted', string | null> = {
    Inverted: null,
    Unaware: null,
  };

  const stale: string[] = [];
  for (const e of CARD_LEDGER) {
    const why: string[] = [];

    if (deadShapes(e.card).length) why.push('shape');

    if (e.todoTest) {
      const [file, needle] = e.todoTest.split('::');
      const src = file ? sourceOf(file) : null;
      if (src === null) {
        stale.push(`${e.card}: cites "${file}", which does not exist`);
      } else {
        const hits = todoTitles(src).filter(t => t.title.includes(needle ?? ''));
        if (!hits.length) {
          stale.push(`${e.card}: no test in ${file} has a name containing "${needle}"`);
        } else if (!hits.some(t => t.todo)) {
          // A todo that grew into a real test is the happy ending: the card
          // works now, and the ledger entry is the thing left behind. (Several
          // cards legitimately have BOTH — a real test for the half that works
          // and a todo for the half that does not — so it takes ALL of the
          // matches being real to call the entry stale.)
          stale.push(`${e.card}: every test in ${file} matching "${needle}" is a REAL test `
            + 'now, none is a todo — the card looks implemented, so delete this ledger entry');
        } else {
          why.push('todo');
        }
      }
    }

    if (e.deadAttr) {
      const c = getCard(e.card);
      const prints = [...c.attrs, ...c.augmentAttrs].includes(e.deadAttr);
      const placeholder = LAYER_PLACEHOLDER[e.deadAttr];
      if (!prints) stale.push(`${e.card}: no longer prints {${e.deadAttr}} — recheck this entry`);
      else if (placeholder === null) {
        stale.push(`${e.card}: the stat layer {${e.deadAttr}} was waiting on has SHIPPED — the `
          + 'attribute is live, so delete this ledger entry');
      } else if (!engineSrc.includes(placeholder)) {
        stale.push(`${e.card}: engine.ts no longer carries the "${placeholder}" `
          + `placeholder — if the stat layer shipped, {${e.deadAttr}} may be live and `
          + 'this entry is stale');
      } else why.push('attr');
    }

    if (e.unverified) why.push('unverified');
    if (e.onlyTrackedHere) {
      // The most dangerous class in the pool, and the reason this file exists:
      // a dead half with NO machine-checkable trace anywhere — no readable
      // shape, no todo test, no printed attribute. Nothing but a batch-header
      // comment was ever tracking it, which is precisely how Harbinger's
      // second half survived two reports. Declaring it here is the tracking.
      why.push('only-tracked-here');
    }

    if (!why.length) {
      stale.push(`${e.card}: nothing backs this entry any more — the definition looks alive, `
        + 'it names no live todo test and no dead attribute. Either the card was '
        + 'implemented (delete the entry), or re-justify it: add the todo test that '
        + 'documents it, or set unverified: true with a note.');
    }
  }
  assert.deepEqual(stale, [],
    `ledger entries that have outlived their evidence:\n  ${stale.join('\n  ')}`);
});

// ── (3) THE TALLY ───────────────────────────────────────────────────────

test('the ledger reports honestly on how many card halves are dead', () => {
  // Not a threshold — a visible count, printed on every run, so the number is
  // impossible to lose track of. The playtest ledger prints the same way.
  const by = (g: CardLedgerEntry['gap']) => CARD_LEDGER.filter(e => e.gap === g).length;
  const deck = new Set(DECK_LIST);
  const unsafe = CARD_LEDGER.filter(e => e.gap !== 'approximated' && deck.has(e.card));
  const enablers = CARD_LEDGER.filter(e => e.severity === 'deck-enabler');
  const unverified = CARD_LEDGER.filter(e => e.unverified).length;
  const untracked = CARD_LEDGER.filter(e => e.onlyTrackedHere).map(e => e.card);

  assert.ok(CARD_LEDGER.length <= allCardNames().length, 'sanity');
  console.log(
    `    card ledger: ${by('dead')} dead · ${by('partial')} partial · `
    + `${by('approximated')} approximated · ${unverified} unverified`);
  console.log(
    `    ${unsafe.length} of ${DECK_LIST.length} constructed-legal cards have a printed `
    + `clause that silently does nothing (${enablers.length} of them are deck enablers: `
    + `${enablers.map(e => e.card).join(', ')})`);
  console.log(
    `    ${untracked.length} have NO trace anywhere but this file — no readable shape, no `
    + `{ todo: true } test, nothing: ${untracked.join(', ')}`);
});

// ── (4) THE R155 TALLY: the static/cost/flag population, and how much of it
//        is provably inert ────────────────────────────────────────────────
//
// Printed on every run for the same reason as (3): the denominator is the
// honest part. "Zero inert shapes" means nothing without "out of how many
// scanned", and a refactor that renamed `statics` would otherwise turn this
// sweep into a green check over an empty set — which is how a guard dies
// quietly rather than loudly.
test('the static/cost/flag sweep reports its population, and none of it is provably inert', () => {
  const pool = allCardNames().filter(n => !(n in NOT_A_GAP));
  let statics = 0, costMods = 0, guards = 0;
  const inert: string[] = [];
  for (const name of pool) {
    const c = getCard(name);
    // R268: body half + [Augment]-box half. The pinned numbers below are
    // UNCHANGED by that migration, and that is the point — no clause was
    // added or removed, 44 of them just moved to the channel that says where
    // they are printed.
    statics += (c.statics ?? []).length + (c.augmentBox?.statics ?? []).length;
    costMods += (c.costMods ?? []).length + (c.augmentBox?.costMods ?? []).length;
    guards += [...(c.abilities ?? []), ...(c.augmentText ?? [])]
      .filter(a => a.type === 'triggered' && a.when).length;
    const shapes = inertShapes(name);
    if (shapes.length) inert.push(`${name} — ${shapes.join('; ')}`);
  }
  console.log(
    `    R155 inert-shape sweep: ${statics} statics · ${costMods} cost mods · `
    + `${guards} when() guards, across ${pool.length} cards`);
  console.log(
    `      provably inert by literal shape: ${inert.length} `
    + '(literals only — an `affects` that cannot match for a REASON is undecidable '
    + 'and is not counted; see inertShapes)');

  // ── THE TALLY IS AN ASSERTION NOW, NOT A COMMENT (CT-93, round 29) ───────
  //
  // This used to be a one-sided floor (`>= 45 && >= 5 && >= 90`) sitting under
  // a comment that said "49 / 6 / 99". The file drifted to 50 / 6 / 92, the
  // floor did not care, and SEVEN when()-guards disappeared with nothing in the
  // repository recording which, when or why. A lower bound that nobody ever
  // raises is a number that can only ever drift downwards, which is the whole
  // failure CT-93 was filed about.
  //
  // ⚠ CT-93 ITSELF WAS WRONG ABOUT WHAT THIS COUNTS, and that is worth keeping.
  // It read "SEVEN GUARDS ARE GONE" as seven TEST guards and prescribed
  // `git log -p` on this file to name them. That could never have worked:
  // `guards` counts `when()` predicates on triggered abilities IN THE CARD
  // POOL, so the seven are not in this file's history at all — they are in the
  // card files. The ticket's instrument was pointed at the wrong artifact,
  // which is the same mistake reports #15, #104 and #106 all made.
  //
  // ALL SEVEN WERE FOUND, by running this exact tally in a worktree at the
  // R155 commit (8b92357) and diffing per card against HEAD. Every one is a
  // DELIBERATE conversion, documented at length in its own card file — not one
  // was lost in a refactor:
  //
  //   Aetherflux Golem        R168        triggered → static
  //   Arbiter of Vitality ×2  R162, R157 §23   → AmountMultiplier
  //   Stellarspore Harvester ×2  R161, R157 §15
  //   Powerforge Synergist    R165        → spawnsWithCounters
  //   Maelstrom Charger       R178 (RAQ)  → asYouPlay
  //
  // R268 (round 34) moved 44 cards' statics / cost mods / replacement hooks
  // from the body channel into `augmentBox`, because that is where their text
  // is printed. NOT ONE CLAUSE was added, removed or converted, so these three
  // numbers are unchanged — the sweep above simply counts both halves of the
  // text box now. If it had been re-pinned at 3/1/92 instead, this file would
  // have gone blind to 47 printed clauses in one edit.
  //
  // The "+1 static" that CT-93 waved through as "understandable" is the SAME
  // EDIT as the Aetherflux Golem row — the guard did not vanish, it moved.
  //
  // So: EXACT, and a change here is a decision. If you legitimately add or
  // convert a card, update these three numbers AND add a line to the table
  // above saying which card and which ruling. That is ~30 seconds, and it is
  // the only thing that stops the next seven going missing in silence.
  const TALLY = { statics: 50, costMods: 6, guards: 92 };
  assert.deepEqual({ statics, costMods, guards }, TALLY,
    `the sweep now scans ${statics}/${costMods}/${guards}, pinned at `
    + `${TALLY.statics}/${TALLY.costMods}/${TALLY.guards}. This is NOT a floor and it is not `
    + 'noise: every one of these is a printed clause the engine implements. If you moved a '
    + 'trigger to a static, or a card left the pool, say WHICH CARD AND WHICH RULING in the '
    + 'table above this assertion and then update the numbers. If you cannot say which card '
    + 'changed, do not update the numbers — find out first, because that is exactly how the '
    + 'last seven went missing under a floor that could not notice.');

  // FLOOR B — the inert count, floored at its real value of ZERO, so the next
  // card that ships a scaffold instead of an implementation trips it.
  assert.deepEqual(inert, [],
    'these cards carry a static, cost mod or trigger guard that provably does nothing:\n  '
    + inert.join('\n  ')
    + '\n\nThis is the Harbinger shape wearing different clothes — a printed clause with a '
    + 'definition that reads as implemented and is not. Implement it, or declare it in '
    + 'ledgers/card-ledger.ts, or (if it is a false positive) add the card to NOT_A_GAP with '
    + 'a reason. Do NOT resolve it with a { todo: true } test.');
});

// ── R214 · POOL SIGHT ───────────────────────────────────────────────────
//
// This file sweeps the WHOLE card pool. `src/cards/registry.ts` is the natural
// card entry point and it registers 494 of the 495 cards: two of the three
// `registerSynthetic` calls are its own, and the third — `Alluring Attribute`
// — is in `src/apply.ts`. Eight sweeps imported registry.ts alone, saw 494,
// and NOT ONE OF THEM ASSERTED A POOL SIZE, so every clean sheet they produced
// silently covered one card fewer than it claimed.
//
// The floor is what stops that being reintroduced by an import change nobody
// reads as a behaviour change. `test/180-pool-sight.test.ts` holds the same
// floor for the whole suite and the guard that catches a ninth sweep.
test('R214: this sweep sees the whole card pool', () => {
  const n = allCardNames().length;
  assert.ok(n >= 496,
    `this sweep sees ${n} cards, not the full 496 — its imports reach src/cards/registry.ts `
    + 'but not src/apply.ts, so the synthetic Alluring Attribute is invisible to it and every '
    + 'verdict above covers one card fewer than it says. Import ../src/index.ts.');
  assert.ok(allCardNames().includes('Alluring Attribute'),
    'the pool is big enough but Alluring Attribute is not in it — the count floor above has '
    + 'been satisfied by some other card, which is not the thing being guarded');
});
