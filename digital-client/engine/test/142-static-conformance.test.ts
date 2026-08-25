/* STATIC CONFORMANCE — a card that prints a standing statement of fact about
 * the board must be BUILT as a continuous layer, and must never reach the stack.
 *
 * WHY THIS FILE EXISTS (CARD-TODO #48)
 *
 * The owner reported this class three times. The report everyone quotes is
 * playtest ledger #75 (WEHH 2026-08-22):
 *
 *   "Replacement effects and triggered effects AND STATIC EFFECTS are being
 *    handled wrong by the system, still. The only cards that should ever
 *    produce effects that go onto the stack are cards that say 'When' or
 *    'Whenever' or have a ':' activated ability."
 *
 * `88-replacement-conformance.test.ts` is the class guard for the REPLACEMENT
 * half of that sentence. Nothing guarded the STATIC half. The first of the
 * three reports was in fact about a static and not a replacement at all —
 * ledger #46, VEAV, on Tenebrous Bulborb:
 *
 *   "The 'I get -2/-2' isn't a trigger that should go on the stack. It's a
 *    static effect."
 *
 * and it is unreachable from 88: Bulborb prints "[Augment] I gain -2/-2",
 * which contains neither "would" nor "instead", so 88's text pass can never
 * see it however the -2/-2 is built. A guard that cannot fail on the card its
 * report was about is not a guard. Hence this file, in 88's shape: derived
 * from printed text, exemptions carrying their reason inline, and an exemption
 * that outlives its cause failing as loudly as a card that breaks the rule
 * (68-target-conformance's rule, for 68's reason).
 *
 * The bug it was written for was real. Aetherflux Golem printed "[Augment] I
 * gain +2/+2" and implemented it as a triggered ability adding two +1/+1
 * counters, while the two other cards in the pool printing that identical
 * sentence — Malformed Monstrosity ("-7/-7") and Tenebrous Bulborb ("-2/-2") —
 * had been plain statics since #46. One printed sentence, two mechanisms.
 *
 * ── WHAT COUNTS AS "CONTINUOUS-SHAPED" ──────────────────────────────────
 *
 * A standing statement of fact about the board: it has a SUBJECT that names a
 * class of things ("Your other units", "Spells", "Everything", "Columns", "I"),
 * a present-tense STATE predicate (gain/have/are/cost/can/may/stay/spawn with/
 * lose all), and no bound on when it is true. Nothing about it is an event, so
 * there is nothing for a stack item to be.
 *
 * It is decided by ELIMINATION, in this order, and the order is the whole
 * design: every disqualifier is a positively-matched shape, every sentence in
 * the pool lands in exactly one bucket, and a sentence that matches NOTHING is
 * `UNCLASSIFIED` and fails `the classifier accounts for every sentence in the
 * pool` below. That is the anti-blindness device — a new card whose wording
 * this file cannot read makes a test go red instead of quietly shrinking the
 * population.
 *
 *   GRAFT       [Switch]/[Switch1] — a transferred EFFECT, one-shot by
 *               definition (53 clauses).
 *   REPLACEMENT "would … instead", or the substitution shape "deal(s|t) … as"
 *               — 88's population, restated here in two lines rather than
 *               imported so importing does not re-register 88's tests. It
 *               finds exactly 11 clauses, which is exactly 88's count, and
 *               that agreement is a live cross-check on both classifiers.
 *   ACTIVATED   contains ':' (42).
 *   TRIGGER     opens with When / Whenever / If / At the … / After … /
 *               Before … / As you play … (251).
 *   ANAPHOR     opens with Otherwise / Then / It / Its / They / That / Those —
 *               a continuation, which INHERITS the previous sentence's bucket.
 *               This is why Life Power Dude's "Otherwise they gain +2/+0."
 *               is continuous (its neighbour is) while Grob's "It gains
 *               'Prophecy — One Battle Passes'." is not (its neighbour is a
 *               one-shot cache).
 *   TARGETED    names a target ("target unit", "any target", "targets of") —
 *               the owner's own switch, and 88 turns on the same one: "a
 *               target has to be CHOSEN, and choosing is public and
 *               respondable" (70).
 *   BOUNDED     carries a duration or an anaphoric object — "until regroup",
 *               "until end of turn", a leading "In this battle,", "during this
 *               battle", "this way", "now". A standing fact has no duration;
 *               a bounded one is a one-shot that installs a temporary layer.
 *               Reforge the Dead's "Your units gain '…' until regroup" is the
 *               shape this keeps out (12).
 *   CONTINUOUS  what is left that matches a class subject + a state predicate,
 *               or the standing-permission shape ("you may play/augment/apply
 *               … as if …", "… each deployment", "you may play me …") (46).
 *   ONESHOT     what is left that starts with an action verb (76).
 *
 * FOUR ROUNDS OF NARROWING, measured over the whole 494-card pool, because the
 * first three were wrong in ways worth recording:
 *
 *  1. "no trigger word, no colon, no one-shot verb" taken as a prefix test on
 *     the verb — 69 clauses, and the junk in it is instructive. "Each opponent
 *     discards a card." and "Your other units gain +1/+1." are the same shape
 *     (subject + present-tense verb); only the VERB separates a fact from an
 *     action. So the predicate had to be matched, not the sentence opener.
 *  2. Matching the predicate but not the target — Haboob's "I deal 1 damage to
 *     each unit" rode in on `deals?`, which was in the state-verb list only to
 *     carry Blightsea Polyp's "Columns deal combat damage to players as 1 rot".
 *     Handing the substitution shape to the REPLACEMENT bucket (where it
 *     belongs — it is 88's card) let `deal` leave the state list entirely.
 *  3. Treating "in this battle" as a duration — it is a COUNTING clause on
 *     Animated Spark ("+1/+0 for each nontoken spell you've played in this
 *     battle") and The Silent, both genuine continuous statics, and a real
 *     duration only when it LEADS the sentence (Abyssal Evocation, "In this
 *     battle, you may play spells from your bin"). Anchoring it at ^ recovered
 *     both cards.
 *  4. An "[Augment] text with no trigger and no colon is continuous" fallback,
 *     tried and REJECTED. Over the whole pool it caught two clauses and was
 *     right about one: Arbiter of Vitality's "[Augment] Double all life gain
 *     and life loss" (continuous) and The Everywhere's "[Augment] During
 *     [Haste] name a card" (a one-shot the player takes every haste step).
 *     One for two is not a rule.
 *
 * ── KNOWN AND DELIBERATE BLIND SPOTS ────────────────────────────────────
 *
 * Recorded rather than papered over, because a sweep that names N cards and
 * can only see M of them is worse than no sweep:
 *
 *  · CONDITIONAL STATICS. A sentence opening with "If" is a TRIGGER by the
 *    definition above, so Monke ("If I spawned this turn, other units lose all
 *    attributes and abilities during battle" — really a `statics` suppressor),
 *    Gridxlan and Writhing Host are outside the population. "As long as …," is
 *    the game's explicit continuous-condition wording and IS read (Life Power
 *    Dude); "If …," is not, because that is also how every replacement in 88
 *    opens and this file must not fight that one.
 *  · Arbiter of Vitality, for the reason in round 4 above. Its clause is an
 *    imperative with no subject, identical in shape to Buffer Overflow's
 *    one-shot spell; the only thing separating them is the [Augment] marker.
 *    It is R162 `amountMultipliers`, so it is in 88's REPLACEMENT_KEYS and
 *    guarded there.
 *  · Gatekeeper of Souls' `mustBeTargeted` opens with "When", so it is read as
 *    a trigger.
 *
 * ── THE DECLARATION SIDE IS AN ALLOWLIST, INVERTED ──────────────────────
 *
 * `abilityFree` in batch-earth-c.ts tested FOUR behaviour channels for "does
 * this card have an ability" and so offered 44 cards with statics, cost mods,
 * permissions and replacements as ability-free. Listing behaviour fields rots
 * silently the day a `CardDef` field is added. So this file names EVERY
 * non-printed key with what it is, and anything unnamed counts as
 * stack-reaching — the loud direction. `every behaviour key in the pool is
 * classified` below is what makes a new field a failing test rather than a
 * silent hole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { CardDef } from '../src/cards/dsl.ts';

// ── the text pass ───────────────────────────────────────────────────────

/**
 * Printed text with REMINDER TEXT REMOVED, exactly as claims.ts, 71-card-ledger
 * and 88 do it, plus two things those do not need: the layout's hyphenated line
 * breaks closed up (so Animated Spark's "non- {/n}token" is one word again, as
 * 68-target-conformance's `forPhrases` also has to do), and the printed Ambush
 * banner stripped. The banner is a cost line, not a sentence — Shib prints
 * nothing but "[4] Ambush [Battle]" and a reminder — and leaving it in put the
 * one unreadable fragment in the pool.
 */
function rulesText(c: CardDef): string {
  return (c.text ?? '')
    .replace(/\{i\}\s*\([^)]*\)\s*(\{\/i\})?/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/-\s*\{\/n\}\s*/g, '')
    .replace(/\[[^\]]*\]\s*Ambush\s*\[[^\]]*\]/gi, ' ')
    .replace(/\bAmbush\s*\[[^\]]*\]/gi, ' ')
    .replace(/\{\/?[a-z0-9]+\}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** the card's rules text as sentences. A condition does not carry across a
 *  full stop — claims.ts and 88 both learned that the same way — so the
 *  sentence is the unit a clause is judged in. Fragments left behind by the
 *  reminder-text strip carry no word and are not sentences. */
const sentences = (t: string): string[] =>
  t.split(/(?<=\.)\s+/).filter(s => /[a-z]/i.test(s.replace(/\[[^\]]*\]/g, ' ')));

/** leading markers that are not part of the sentence's grammar: the [Augment]
 *  banner, the [once] budget, a bracketed additional cost. Stripped so the
 *  subject test can see the actual subject. */
const LEAD = /^(?:\[Augment\]|\[once\]|\[Battle\]|\[Haste\]|\[Discard[^\]]*\]|\[Pay[^\]]*\]|\[Erase[^\]]*\]|\[Gain[^\]]*\]|[,\s])+/i;
function stripLead(s: string): string {
  let t = s.trim();
  for (;;) { const u = t.replace(LEAD, '').trim(); if (u === t) break; t = u; }
  return t;
}

export type Bucket =
  | 'GRAFT' | 'REPLACEMENT' | 'ACTIVATED' | 'TRIGGER' | 'TARGETED' | 'BOUNDED'
  | 'CONTINUOUS' | 'ONESHOT' | 'UNCLASSIFIED';

const GRAFT = /^\[Switch1?\]/i;
/** 88's `isReplacementClause`, restated. Not imported: importing a *.test.ts
 *  re-registers its tests into this run. The two must agree, and `the
 *  replacement bucket still matches 88's population exactly` asserts they do. */
const isReplacement = (s: string): boolean =>
  (/\bwould\b/i.test(s) && /\binstead\b/i.test(s)) || /\b(?:deals?|dealt)\b[^.]*\bas\b/i.test(s);
const TRIGGER = /^(?:when|whenever|if|at the |after |before |as you )/i;
const ANAPHOR = /^(?:otherwise|then|it |its |they |those |that |them )/i;
const TARGETED =
  /\btargets?\s+(?:unit|ally|allies|player|opponent|card|spell|effect|token|formation|nontoken|enemy|cached|creature)|\bany target\b|\btargets? (?:of|that|in|with|from)\b/i;
const BOUNDED = /\buntil regroup\b|\buntil end of\b|^in this battle\b|\bduring this battle\b|\bthis way\b|\bnow\b/i;

/** "As long as your life total is odd, …" — the game's explicit
 *  continuous-condition wording, stripped so the clause it governs is judged
 *  on its own subject and verb. Life Power Dude is the pool's only one. */
const ASLONGAS = /^as long as [^,]+,\s*/i;
/** a subject that names a CLASS of things on the board, not an actor */
const CLASS_SUBJ = /^(?:i|my |your |our |all |other units|enemies|everything|columns|cards |spells\b|spells |abilities\b|x )/i;
/** a present-tense STATE predicate — a fact, not an action */
const STATE_VERB = /\b(?:gains?|has|have|are|is|costs?|can'?t?|cannot|can|spawns? with|stays?|loses? all)\b/i;
/** the standing-PERMISSION shape (R95/R97/R29): "you/players may|can …" with a
 *  scope that recurs rather than a one-off window. The scope marker is what
 *  separates Rook's "You may augment cards … as if they were [Virus]" from
 *  Tides of the Cosmos' "You may play them now, for free." */
const PERMISSION = /\b(?:you|players)\s+(?:may|can)\b/i;
const PERM_SCOPE = /\bas if\b|\beach (?:turn|deployment|battle)\b|\bplay me\b/i;
/** an ACTION verb — the sentence does something rather than being true */
const ONESHOT_VERB =
  /^(?:draw|deal|create|delete|erase|put|negate|recall|recycle|remove|reveal|rockfall|skip|cache|change|choose|look|gain|play|exchange|augment|double|set|move|switch|repeat|end|glimpse|discard|trash|sacrifice|prevent|activate|during|for each|any number|starting with|two |target |each player|each opponent|its controller|the controller|you gain|you may|you also|you choose|i deal|i become)/i;

export interface Clause { card: string; raw: string; text: string; bucket: Bucket }

/** every printed sentence in the pool, bucketed. Order matters — see header. */
export function classifyPool(): Clause[] {
  const out: Clause[] = [];
  for (const name of allCardNames()) {
    let prev: Bucket | null = null;
    for (const raw of sentences(rulesText(getCard(name)))) {
      const s = stripLead(raw);
      if (!s) continue;
      const body = s.replace(ASLONGAS, '');
      let bucket: Bucket;
      if (GRAFT.test(raw.trim()) || GRAFT.test(s)) bucket = 'GRAFT';
      else if (isReplacement(s)) bucket = 'REPLACEMENT';
      else if (s.includes(':')) bucket = 'ACTIVATED';
      else if (TRIGGER.test(s)) bucket = 'TRIGGER';
      else if (ANAPHOR.test(s) && prev) bucket = prev === 'CONTINUOUS' ? 'CONTINUOUS' : 'ONESHOT';
      else if (TARGETED.test(s)) bucket = 'TARGETED';
      else if (BOUNDED.test(s)) bucket = 'BOUNDED';
      else if (PERMISSION.test(s) && PERM_SCOPE.test(s)) bucket = 'CONTINUOUS';
      else if (CLASS_SUBJ.test(body) && STATE_VERB.test(body) && !ONESHOT_VERB.test(body)) bucket = 'CONTINUOUS';
      else if (ONESHOT_VERB.test(body)) bucket = 'ONESHOT';
      else bucket = 'UNCLASSIFIED';
      out.push({ card: name, raw, text: s, bucket });
      prev = bucket;
    }
  }
  return out;
}

const POOL = classifyPool();
const continuousOf = (name: string): string[] =>
  POOL.filter(c => c.card === name && c.bucket === 'CONTINUOUS').map(c => c.text);
/** every card in the pool printing at least one continuous-shaped clause */
const STATIC_CARDS = [...new Set(POOL.filter(c => c.bucket === 'CONTINUOUS').map(c => c.card))];
/** …and those whose EVERY printed sentence is one, so nothing on the card
 *  could be what a stack item is for */
const PURE_STATIC_CARDS = STATIC_CARDS.filter(
  n => POOL.filter(c => c.card === n).every(c => c.bucket === 'CONTINUOUS'));

// ── the declaration side ────────────────────────────────────────────────

/** `Printed` (dsl.ts) — the oracle data every card carries. Not behaviour. */
const PRINTED_KEYS = new Set([
  'name', 'factions', 'cost', 'mana', 'power', 'toughness', 'type', 'kind', 'timing',
  'attrs', 'virus', 'burst', 'unstable', 'augmentAttrs', 'ambush', 'prophecy',
  'gainDebt', 'discardMe', 'text', 'image',
]);

/**
 * The CONTINUOUS LAYER, as a list: a card printing a standing fact must be
 * built out of one of these. Every entry says which printed shape it answers,
 * so a hook added to `CardBehavior` and forgotten here makes the sweep report
 * a card that really was fixed — the failure direction that gets noticed.
 */
const CONTINUOUS_KEYS: Record<string, string> = {
  statics: 'R106 stat/attr/base/suppression layer — "Your other units gain +1/+1"',
  projects: 'R118 continuous FACE projection — "I have all abilities of adjacent allies"',
  costMods: 'R59 continuous cost modifier — "Spells cost [one] more to play during battle"',
  effectAttrs: 'R94 continuous attribute grant onto resolving effects — "Your units and spells gain powerful"',
  modPermissions: 'R95 continuous permission to apply a mod — "You may augment cards from hand and bin …"',
  playPermissions: 'R97 continuous permission to PLAY at a refused timing — "Each turn, you may play a unit … as if it had [Haste]"',
  binPlayPermissions: 'R123 the same, granted by a card sitting in its owner\'s bin',
  mustBeTargeted: 'R64 "I must be targeted if able" — a standing targeting restriction',
  prophesyFromBin: 'R42 "I can be prophesied from your bin"',
  playsFromBin: 'R123 "…and played from your bin."',
  noPlayFromHand: 'R100 "I can\'t be played from your hand."',
  playsIntoFormation: 'R29 "You may play me into an open spot in your formation"',
  xMin: '"X can\'t be 0." — the smallest legal cast X',
  amountMods: 'R104 continuous AMOUNT modifier',
  amountMultipliers: 'R162 continuous MULTIPLICATIVE amount modifier',
  replaceRotDamage: 'R38 replacement hook',
  replaceCombatDamageToPlayer: 'R38 replacement hook',
  replaceLifeGain: 'R104 replacement hook',
  replaceCounters: 'R104 replacement hook',
  replaceTokenCreation: 'R104 replacement hook',
  replaceTokenBatch: 'R104 replacement hook',
  replaceCardStep: 'replacement hook (Worldbender)',
};

/**
 * Behaviour keys that are NOT a continuous layer but still put nothing on the
 * stack from a card in play. Named, with the reason, because of the inversion:
 * ANY key that appears on a card and is in neither this map nor
 * CONTINUOUS_KEYS counts as stack-reaching, so a new `CardBehavior` field
 * fails loudly instead of quietly widening the hole.
 */
const INERT_KEYS: Record<string, string> = {
  augmentable:
    'a FLAG, not a layer — "this card may be applied as an augment even though it declares no '
    + 'augmentAttrs/augmentText, because its [Augment] text lives in `statics`". Deliberately NOT '
    + 'counted as a continuous channel: a card must satisfy the rule with the layer itself, never '
    + 'with the marker that says it has one.',
  spellEffect:
    'the card\'s OWN resolution when it is played, not an item a card in play puts on the stack. '
    + 'Trench Stalker\'s is `run: () => {}` carrying nothing but a `castCost`.',
  graftEffect: 'the [Switch] rider, transferred on graft — again the played card\'s own resolution',
  xPreview: 'UI-only PURE query; dsl.ts: "Never called by the engine, apply(), or any replay-affecting path"',
  xPreviewRows: 'UI-only PURE query, same contract as xPreview (#85)',
};

/** the two channels that put an item on the stack from a card in play, and the
 *  reason they are the only two — 88 names the same pair. */
const STACK_KEYS: Record<string, string> = {
  abilities: 'triggered ("When"/"Whenever") and activated (":") abilities',
  augmentText: 'the same, donated to a host when the card is worn as a mod',
};

const behaviourKeys = (name: string): string[] => {
  const c = getCard(name) as unknown as Record<string, unknown>;
  return Object.keys(c).filter(k => !PRINTED_KEYS.has(k) && c[k] !== undefined);
};
const declaresContinuous = (name: string): boolean =>
  behaviourKeys(name).some(k => k in CONTINUOUS_KEYS);
/** THE INVERSION: unknown counts as stack-reaching. */
const stackReaching = (name: string): string[] =>
  behaviourKeys(name).filter(k => !(k in CONTINUOUS_KEYS) && !(k in INERT_KEYS));

// ── exemptions ──────────────────────────────────────────────────────────

/**
 * Cards printing a continuous clause that declare NO continuous layer, each
 * with the reason it is nonetheless correct — or, where it is not correct, a
 * pointer to where the divergence is already filed. Every name here is a hole
 * in the net, so the list is asserted to be EXACTLY right below.
 */
const NO_LAYER: Record<string, string> = {
  'Robot':
    '"I spawn with X +1/+1 counters on me." — a TOKEN, and its X is the number the creating '
    + 'effect passes to createToken, not a layer the card owns. There is nothing on the card '
    + 'to declare: the counters are written by whoever makes the Robot.',
  'Aethercap Siphoner':
    '"I spawn with three -1/-1 counters on me." — the engine has no spawns-with layer; the '
    + 'nearest primitive is a spawn-time write. Filed as SPAWN-COUNTERS in '
    + 'docs/09-divergence-inventory.md §2b together with Powerforge Synergist. ⚠ This card\'s '
    + 'version QUEUES a real `spawned` triggered ability (so the counters land after the spawn '
    + 'event and the write is respondable) where Powerforge Synergist\'s does the write inside '
    + 'when() and returns false so it never queues. Same printed sentence, two mechanisms — the '
    + 'Aetherflux Golem shape again, in a file this ruling does not own.',
  'Powerforge Synergist':
    '"I spawn with two +1/+1 counters." — same family and same inventory entry as Aethercap '
    + 'Siphoner. Its `abilities` entry is bookkeeping that never queues (the when() does the '
    + 'write and returns false), so it does not reach the stack; it is still not a declarative '
    + 'layer, which is what the inventory entry asks for.',
  'Instrument of Reassignment':
    '"X can\'t be 0." — this X is the ACTIVATED ABILITY\'s X ("[x], Sacrifice another nontoken '
    + 'unit: Create a Robot X"), chosen at resolution, and `xMin` is a CAST-cost field. The floor '
    + 'is enforced where the number is actually chosen: the option list is built `for (let x = 1; '
    + 'x <= open; x++)` and the run bails when no mana is open. Verified in batch-metal-b.ts.',
  'The Bonesculptor':
    '"You may play one unit with no abilities from your bin each deployment." — a standing '
    + 'permission modelled as a free bounded activated ability, documented as an approximation in '
    + 'batch-earth-c.ts\'s header and filed as PLAY-VS-PUT-INTO-PLAY in '
    + 'docs/09-divergence-inventory.md §2b. ⚠ The shape has the cost this whole file is about: an '
    + 'activated ability reaches the stack, so Containment Protocol ("negate all activated and '
    + 'triggered effects") can negate a permission that should simply be true.',
};

/**
 * Cards whose WHOLE printed text is continuous and which declare something
 * stack-reaching anyway, with the reason that is right for them. This list is
 * the one that matters: it is where a regression would hide.
 */
const STACK_ANYWAY: Record<string, string> = {
  'Ancient One':
    '"I have all abilities of adjacent allies." — R118/R127. The continuous half IS declared '
    + '(`projects`, facets statics/activated/behavior). The `augmentText` beside it is the '
    + 'TRIGGERED half of the same sentence, and it belongs on the stack: what is projected is a '
    + 'neighbour\'s triggered ability, and a projected trigger fires and is responded to exactly '
    + 'like the original. The card comment says so at the declaration: "\'triggered\' is '
    + 'deliberately excluded [from projects] — the when() below already delivers it".',
  'The Bonesculptor':
    'see NO_LAYER — the permission is modelled as an activated ability, which is the divergence '
    + 'filed as PLAY-VS-PUT-INTO-PLAY. Listed in both places because it fails both halves of the '
    + 'rule for one reason.',
};

// ── the assertions ──────────────────────────────────────────────────────

test('the classifier accounts for every sentence in the pool', () => {
  // THE ANTI-BLINDNESS ASSERTION, and the reason the buckets are all positive
  // matches. A classifier that silently drops what it cannot read shrinks its
  // own population and goes green; `stripCode` was blind for weeks and every
  // sweep resting on it passed. A sentence matching no rule fails HERE, where
  // somebody has to decide which bucket it belongs in.
  const unread = POOL.filter(c => c.bucket === 'UNCLASSIFIED');
  assert.deepEqual(unread.map(c => `${c.card}: ${c.text}`), [],
    'these printed sentences match no bucket rule — the classifier cannot read them, so no '
    + 'assertion below can see them either. Decide what each one is and give it a rule.');
});

test('the classifier finds the continuous clauses, and only those', () => {
  // A floor on the CLASSIFIER, 88's test 1 and for 88's reason: if a narrowing
  // round ever goes one step too far, everything below passes vacuously and
  // nobody notices. So the population is named, and drift in EITHER direction
  // fails. A new card printing a standing fact is a new member of this class —
  // add it here and make sure it is built as a layer, not as a trigger.
  const known = [
    // "[Augment] I gain ±N/±N" — the three cards of playtest #46 and CARD-TODO #48
    'Aetherflux Golem', 'Malformed Monstrosity', 'Tenebrous Bulborb',
    // self-referential statics whose amount is computed
    'Burden of Life', 'Dreadspawn Horror', 'Prickly Protector', 'The Omniphage',
    // lords and anti-lords
    'Air Plant', 'Animated Spark', 'Glowhaven Elder', 'Inspiration', 'Life Power Dude',
    'Sandstone Defender', 'The Mighty Doot', 'Towering Colossus', 'Transmogrifant',
    'Infernal Wispweaver',
    // base-stat rewrites and blanket attribute grants
    'Aberrant Statweaver', 'Beyond, Codex Incarnate', 'Brough', 'Rotspore Herald',
    'Emberflame Enlightener', 'Envoy of Lightning', 'Harbinger of Immolation', 'The Everywhere',
    'Ancient One',
    // R59 cost layer
    'Arbiter of Armistice', 'Crevice Lurker', 'Stasis Sentry', 'The Silent', 'Tranquility',
    'Vengeance',
    // R29/R42/R95/R97/R100/R123 permissions and play-route facts
    'Angel of Anguish', 'Calming Force', 'Dispatch Courier', 'Rook', 'Slurpr',
    'The Bonesculptor', 'Tiderunner Initiate', 'Trench Stalker',
    // "I spawn with N counters" — see NO_LAYER
    'Aethercap Siphoner', 'Powerforge Synergist', 'Robot',
    // "X can't be 0/zero."
    'Frosted Denial', 'Instrument of Reassignment',
  ];
  const missed = known.filter(n => !STATIC_CARDS.includes(n));
  assert.deepEqual(missed, [],
    'the text pass stopped recognising these as continuous:\n  ' + missed.join('\n  ')
    + '\n\nIf a narrowing round did this, it went too far — every assertion below would now pass '
    + 'by seeing nothing.');
  assert.deepEqual(STATIC_CARDS.filter(n => !known.includes(n)), [],
    'new cards print a standing statement of fact. Add them to `known` and check each is built '
    + 'as a continuous layer rather than as a trigger.');
  assert.equal(STATIC_CARDS.length, known.length);
});

test("the replacement bucket still matches 88's population exactly", () => {
  // The two classifiers read the same corpus with the same predicate, so they
  // must agree; the day they stop, one of them has been edited without the
  // other. 88 records eleven cards by name and this counts eleven clauses over
  // the same eleven cards. Cheap, and it pins the seam between the two sweeps:
  // "would … instead" is 88's, a standing fact is this file's, and nothing is
  // supposed to be in both.
  const cards = [...new Set(POOL.filter(c => c.bucket === 'REPLACEMENT').map(c => c.card))].sort();
  assert.deepEqual(cards, [
    'Automaton of Abundance', 'Beyond, Codex Incarnate', 'Blightsea Polyp', 'Conduit of Pain',
    'Cosmic Conspirator', 'Counter Thief', 'Flux Resonator', 'Nullbringer', 'Oorblak',
    'Proliferating Slime', 'Skittering Blight',
  ], "88-replacement-conformance's population and this file's REPLACEMENT bucket have diverged");
  const both = cards.filter(n => n !== 'Beyond, Codex Incarnate' && STATIC_CARDS.includes(n));
  assert.deepEqual(both, [],
    'a card is in both sweeps\' populations. (Beyond, Codex Incarnate is the one legitimate '
    + 'overlap: it prints TWO sentences, a targeted rot replacement and "Your units are inverted.")');
});

test('a card printing a standing statement of fact declares a CONTINUOUS layer', () => {
  const problems: string[] = [];
  for (const name of STATIC_CARDS) {
    if (name in NO_LAYER) continue;
    if (declaresContinuous(name)) continue;
    problems.push(`${name} prints "${continuousOf(name)[0]}" and declares none of `
      + `{${Object.keys(CONTINUOUS_KEYS).join(', ')}} — it has {${behaviourKeys(name).join(', ')}}`);
  }
  assert.deepEqual(problems, [],
    'these cards print a standing fact about the board and are not built as one:\n  '
    + problems.join('\n  ')
    + '\n\nThe owner, playtest ledger #46: "The \'I get -2/-2\' isn\'t a trigger that should go on '
    + 'the stack. It\'s a static effect." A trigger fires ONCE, reaches the stack, can be '
    + 'responded to and negated, and leaves its result behind when the source goes; a layer is '
    + 'simply true and stops being true when the source leaves. Build it with the layer.');
});

test('a card whose whole printed text is continuous declares NOTHING that reaches the stack', () => {
  // The negative half, and the one that actually catches the reported bug.
  // Per-CARD rather than per-clause on purpose, exactly as 88 does it: a card
  // that prints a trigger as well is allowed the trigger that sentence names
  // (Harbinger of Immolation, Beyond, Infernal Wispweaver), but a card whose
  // whole text is a standing fact has nothing a stack item could be for.
  const problems: string[] = [];
  for (const name of PURE_STATIC_CARDS) {
    if (name in STACK_ANYWAY) continue;
    const keys = stackReaching(name);
    if (keys.length) problems.push(`${name} declares ${keys.join(', ')} — it prints only `
      + `"${continuousOf(name).join(' / ')}"`);
  }
  assert.deepEqual(problems, [],
    'these cards print ONLY standing facts and still declare something that reaches the stack:\n  '
    + problems.join('\n  ')
    + '\n\nThat is playtest ledger #46, #60 and #75. The live consequences are the three '
    + 'Aetherflux Golem showed: the ability can be NEGATED (Containment Protocol eats it and '
    + 'leaves the mod attached), what it wrote is left behind when the source goes, and if it '
    + 'wrote counters then counter-matters cards see counters the card never printed.');
});

test('every behaviour key in the pool is classified — a new CardBehavior field fails here', () => {
  // THE INVERSION, asserted. `abilityFree` in batch-earth-c.ts tested four
  // behaviour channels and so called 44 cards with statics / cost mods /
  // permissions / replacements "ability-free"; a list of behaviour fields rots
  // silently the day a field is added. Here the unknown key is loud twice: it
  // counts as stack-reaching in the test above, and it fails right here until
  // somebody says which of the three kinds it is.
  const seen = new Set<string>();
  for (const name of allCardNames()) for (const k of behaviourKeys(name)) seen.add(k);
  const unclassified = [...seen].filter(
    k => !(k in CONTINUOUS_KEYS) && !(k in INERT_KEYS) && !(k in STACK_KEYS)).sort();
  assert.deepEqual(unclassified, [],
    'these CardBehavior keys are used in the pool and named nowhere in this file:\n  '
    + unclassified.join('\n  ')
    + '\n\nAdd each to CONTINUOUS_KEYS (it is a layer), INERT_KEYS (it reaches no stack and is '
    + 'not a layer) or STACK_KEYS (it can put an item on the stack).');
  // and the converse: a key named here that nothing in the pool uses is either
  // a hook with no card behind it or a typo, and both read as implemented.
  const dead = [...Object.keys(CONTINUOUS_KEYS), ...Object.keys(INERT_KEYS), ...Object.keys(STACK_KEYS)]
    .filter(k => !seen.has(k)).sort();
  assert.deepEqual(dead, [],
    'these keys are named here but no card in the pool declares one:\n  ' + dead.join('\n  ')
    + '\n\nA hook nothing uses reads as implemented — that is the Harbinger of Immolation '
    + 'incident (see test/card-ledger.ts). Either a card should be using it, or the name is wrong.');
});

test('every exemption is still needed — one that outlives its cause fails here', () => {
  // 68-target-conformance's rule, for 68's reason: an exemption list nobody
  // re-reads becomes a list of things that used to be true.
  const stale: string[] = [];
  for (const [name, why] of Object.entries(NO_LAYER)) {
    assert.ok(why.length > 20, `${name}'s exemption needs a reason, not a shrug`);
    if (!STATIC_CARDS.includes(name)) {
      stale.push(`${name}: prints no continuous clause any more — delete the NO_LAYER entry`);
      continue;
    }
    if (declaresContinuous(name)) {
      stale.push(`${name}: declares ${behaviourKeys(name).filter(k => k in CONTINUOUS_KEYS).join(', ')} `
        + 'now — it is built as a layer, so drop the NO_LAYER exemption');
    }
  }
  for (const [name, why] of Object.entries(STACK_ANYWAY)) {
    assert.ok(why.length > 20, `${name} is exempt with no reason given`);
    if (!PURE_STATIC_CARDS.includes(name)) {
      stale.push(`${name}: its text is no longer ALL continuous, so the strict rule does not `
        + 'reach it — delete the STACK_ANYWAY entry');
      continue;
    }
    if (!stackReaching(name).length) {
      stale.push(`${name}: reaches no stack now — drop the STACK_ANYWAY exemption`);
    }
  }
  assert.deepEqual(stale, [], `exemptions that have outlived their reason:\n  ${stale.join('\n  ')}`);
});

test('the tally: how much of the pool is a standing fact, printed on every run', () => {
  const counts = new Map<Bucket, number>();
  for (const c of POOL) counts.set(c.bucket, (counts.get(c.bucket) ?? 0) + 1);
  console.log(
    `    STATICS: ${STATIC_CARDS.length} of ${allCardNames().length} cards print a standing `
    + `statement of fact — ${PURE_STATIC_CARDS.length} print NOTHING else, so they may not `
    + 'declare a single stack-reaching channel');
  console.log(`    exemptions: ${Object.keys(NO_LAYER).length} no-layer, `
    + `${Object.keys(STACK_ANYWAY).length} stack-anyway`);
  console.log('    clauses by bucket: '
    + [...counts].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b}=${n}`).join(' '));
  assert.ok(STATIC_CARDS.length > 0, 'the classifier found nothing at all');
});

// ── the card this ruling fixed ──────────────────────────────────────────

test('R168: Aetherflux Golem is a STATIC, like the two cards printing its sentence', () => {
  // The named regression test for the one card CARD-TODO #48 filed. It would
  // have failed before R168: the card declared `augmentText` (a triggered
  // ability adding two +1/+1 counters) and no `statics` at all.
  const golem = getCard('Aetherflux Golem');
  assert.ok(golem.statics?.length, 'Aetherflux Golem declares a StaticMod');
  assert.deepEqual(stackReaching('Aetherflux Golem'), [],
    'and nothing that reaches the stack — its whole printed text is "[Augment] I gain +2/+2."');
  // the same shape as its two siblings, which is the point of the ticket
  for (const sib of ['Malformed Monstrosity', 'Tenebrous Bulborb']) {
    assert.deepEqual(stackReaching(sib), [], `${sib} likewise`);
  }
  // and the amount is the printed one, read off the anchor
  const s = golem.statics![0]!;
  assert.equal(s.dp, 2, '+2 power');
  assert.equal(s.dt, 2, '+2 defense');
});
