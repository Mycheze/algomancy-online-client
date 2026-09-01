/* The card-text engine: what a card's text box SAYS RIGHT NOW.
 *
 * DOM-free, like ui/inspect.ts — main.ts renders the answer, and
 * test/57-ui-cardtext.test.ts checks it.
 *
 * Playtest 2026-08-21, Bena: "cards have their oracle text changed all the
 * time. Mods, grafts, counters, other cards adding or removing rules text.
 * The printed card is hardly ever correct." The scan on the table is the
 * card's HISTORY; this module answers what the game currently thinks it is.
 *
 * ── the composition rule ─────────────────────────────────────────────
 *
 * A live card's text box is assembled from sources the engine already models
 * separately, so nothing here re-derives rules — every line comes from a
 * public query, and the arithmetic is E.effStats/E.ownAttrs/E.projections
 * themselves. A box can therefore never disagree with the board it describes.
 *
 *   printed   the card's own text box
 *   augment   a clause donated by an augment mod slid under it (R55)
 *   graft     a [Switch] clause folded into the host's cause (Manual p.33)
 *   granted   text handed to it until regroup (R63)
 *   copy      R118: the card this entity currently IS, and what it kept of its
 *             own — a copy changes the game NAME but never the physical card,
 *             so the box has to say both
 *   static    a continuous projection radiating onto it from elsewhere
 *   note      the one per-ability fact: a once-per-turn budget already spent
 *
 * An until-regroup change with no card text behind it is not a line: a temp
 * +X/+Y is a term in the stat arithmetic and a temp attribute is a chip in
 * the attribute row, both tagged 'temp' there.
 *
 * ── what is deliberately NOT split ───────────────────────────────────
 *
 * A card's OWN printed text stays one line rather than being cut into one
 * clause per scripted ability. Printed text is prose written for humans and
 * `abilities[]` is an implementation of it; the two do not line up 1:1 (a
 * sentence can be two abilities, an ability can span two sentences, and
 * reminder text belongs to no ability at all). Guessing a mapping would make
 * the box confidently wrong, which is worse than the printed card.
 *
 * It costs nothing, because everything that varies per clause is already
 * per-CARD: a mod is its own card, a grant carries its own text, and
 * suppression (R62) is all-or-nothing by rule — "loses all abilities", never
 * "loses its second ability". The one genuinely per-ability fact, a bounded
 * ability whose once-per-turn budget is spent, rides as a `note` line.
 *
 * ── R135: a line never repeats what its own tag already says ──────────
 *
 * The renderer prefixes each line with a tag for its origin, and that tag is
 * an ICON — the augment symbol for an augment, ⇄ for a graft. A donated clause
 * is sliced FROM its printed marker, so the same symbol arrived twice, once on
 * the tag and once at the head of the text. `dropOriginMarker` takes the
 * leading one off; a marker sitting MID-sentence is load-bearing (it separates
 * a graft's cause from its effect) and is never touched, which is also why the
 * composed graft line keeps all of its own.
 */
import { getCard, graftCauseIndex, ELEMENT_OF_PIP } from '../engine/src/cards/dsl.ts';
import { GLOSSARY } from './glossary.ts';
import { esc } from './util.ts';
import type { CardDef } from '../engine/src/cards/dsl.ts';
import type { E } from '../engine/src/engine.ts';
import type { CardName, Entity, EntityId } from '../engine/src/types.ts';
import { ICON_BASE } from './assets.ts';

// ── the model ─────────────────────────────────────────────────────────

export type LineOrigin =
  | 'printed' | 'augment' | 'graft' | 'granted' | 'copy' | 'static' | 'note'
  /** CT-175: an until-regroup effect a resolved spell stamped on this entity,
   * with no card text of its own to quote — see `untilRegroupLines` */
  | 'until';

export interface TextLine {
  /** rules text with its printed markup intact — the caller iconizes it */
  text: string;
  /** the card this clause is printed on ('' for a synthesized line) */
  from: CardName;
  origin: LineOrigin;
  /** false = the line is there but doing nothing right now; `why` says why */
  active: boolean;
  why?: string;
  /** this line IS the whole composed graft ability, not one clause of it */
  composed?: boolean;
}

export type AttrOrigin = 'printed' | 'augment' | 'static' | 'temp' | 'column';

export interface AttrLine {
  attr: string;
  origin: AttrOrigin;
  /** the card that supplies it (null = printed on this card) */
  from: CardName | null;
  /** false = suppressed (R62): printed on the card, not in play */
  active: boolean;
}

/** the stat arithmetic, layer by layer, so a surprising number can be read */
export interface StatBreakdown {
  power: number;
  toughness: number;
  /** layer 1 — what is printed on the card (or a token's minted stats) */
  printed: [number, number];
  /** layer 2 — the base after any rewrite (Formless, Body Swap) */
  base: [number, number];
  /** layer 3+ contributions, in application order */
  parts: { label: string; dp: number; dt: number }[];
  counters: number;
  damage: number;
  /** true when power/toughness differ from what is printed */
  changed: boolean;
}

export interface CardTextBox {
  name: CardName;
  typeLine: string;
  /** null for a card with no meaningful stats (a spell) */
  stats: StatBreakdown | null;
  attrs: AttrLine[];
  lines: TextLine[];
  suppressed: { attrs: boolean; abilities: boolean; by: CardName[] };
  /** short state notes: damage marked, sent to counterattack, X, … */
  state: string[];
  /** true when this box is not simply the printed card — the UI badges it */
  modified: boolean;
}

// ── text helpers ──────────────────────────────────────────────────────

/**
 * Collapse the scan's line-break markup to one readable line.
 *
 * `{/n}` is a mid-WORD break from the card scans ("be- {/n}comes"), never a
 * clause separator — which is exactly why nothing here splits on it. The
 * hyphen in front of one is a SOFT hyphen and is joined away with it; every
 * `- ` in the whole printed pool is one of those.
 *
 * R142: four of them had LOST their `{/n}` in transcription ("adja- cent"), and
 * matching the hyphen rather than the marker is what covered those here. They
 * are joined in the extractor now, where a layout artifact belongs — this rule
 * still carries the five that kept their marker, which the extractor
 * deliberately leaves alone because `{/n}` is its line separator.
 */
export const clean = (s: string): string =>
  s.replace(/\{\/n\}/g, ' ').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim();

const SWITCH_RE = /\[switch1?\]/i;
const AUGMENT_RE = /\[augment\]/i;

/** a card's text from its `[Switch]` marker onward — the half that transfers
 * when it is grafted (Manual p.32-33) */
export function switchClause(name: CardName): string {
  const t = textOf(name);
  const m = SWITCH_RE.exec(t);
  return clean(m ? t.slice(m.index) : t);
}

/**
 * A card's text from its text-box `[Augment]` marker onward — the half that
 * transfers when it augments (R55: printed `[Augment]` is a permission, so a
 * card with no marker in its TEXT donates nothing textual and the type line
 * carries the grant instead).
 */
export function augmentClause(name: CardName): string {
  const t = textOf(name);
  const m = AUGMENT_RE.exec(t);
  return m ? clean(t.slice(m.index)) : '';
}

/**
 * R135: drop the printed origin marker a line's own TAG already shows.
 *
 * Reported verbatim: "an augmented thing will show the :augment: icon twice,
 * once on each line." Both halves are correct on their own — `augmentClause`
 * slices the donated text from `[Augment]` because that is where the donation
 * starts, and `LINE_TAG.augment` is the augment icon because that is what the
 * line IS — so the fix belongs at the join, not in either half. Same shape for
 * a lone graft clause under the ⇄ tag.
 *
 * LEADING only. A `[Switch]` mid-sentence separates a graft's cause from its
 * effect and is the printed card's own punctuation; the composed graft line
 * therefore never goes through here.
 */
export const dropOriginMarker = (text: string): string =>
  text.replace(/^\[(?:augment|switch1?)\]\s*/i, '');

// ── R151: a token's X, printed as the number it actually is ───────────

/**
 * Report #99 (CT-33), Bena: *"Tokens should have their X value in their text
 * box modified to say the actual number, rather than X. So a Poison 5 would
 * say 'Put 5 -1/-1 counters on target unit'."*
 *
 * ⚠ THIS IS NOT THE MARKUP CLASS. R134/R141/R142 were each a formatter failing
 * to consume a token and printing it verbatim. Nothing fails here: `X` is
 * genuinely the word printed on the card, and it is printed on the card
 * because the card is a template — 44 of the pool's 492 cards carry a bare X
 * and 40 of them define it with a "where X is …" clause that has no instance
 * behind it. What is missing is a LIVE PER-INSTANCE VALUE, so the fix is a
 * display-time substitution, not a change to any token table.
 *
 * WHY IT LIVES IN THE BOX AND NOT ON THE CARD DATA. `src/cards/printed.json`
 * is GENERATED from `data/cards/AlgomancyCards-OracleText.json`; a
 * per-instance number stamped into it would confuse the transcription of the
 * physical card with one copy of it, and would be overwritten by the next
 * extract. Stamping onto the ENTITY at creation was the alternative and is
 * also wrong, for a reason the pool states out loud: Robot prints "{i}(If the
 * number of counters changes, so does the X value.)" — a Robot 3 that gains a
 * counter is a Robot 4, so an X frozen at creation would start lying the first
 * time anything touched it. Read at render time, it cannot.
 */

/**
 * The X this entity's text box should print, or undefined if it has none.
 *
 * Two sources, because the engine keeps X in two places and says so
 * (dsl.ts `TokenRequest`: "`x` is deliberately ONE field for two things: a
 * spell token's X, and a unit token's spawn counters"):
 *
 *   spell token   `Entity.x`, stamped by `E.createSpellToken` (Fireball,
 *                 Poison, Crystal) — the only entities in the game that carry
 *                 the field at all
 *   unit token    its COUNTERS (Robot). Not the spawn amount: the card's own
 *                 reminder text makes X track the counters for life, and
 *                 `E.spawnUnit` does not keep the request's number anyway (it
 *                 puts counters on and drops it, after the amount layer has
 *                 had its say — an allied Flux Resonator makes a Robot X enter
 *                 with X+1, report #88).
 *
 * A token whose text has no X (Wisp, Wraith) is unaffected — the substitution
 * below is a no-op on text with nothing to substitute.
 */
export function liveX(u: Entity): number | undefined {
  if (u.x !== undefined) return u.x;
  if (u.token && u.kind === 'unit') return u.counters;
  return undefined;
}

/**
 * The one X the pool spells as a VALUE, and every spelling it is not.
 *
 * R141's lesson is that the pool spells the same thing more than one way and a
 * regex that knows about one of them looks green while covering half the
 * cards, so this was censused over all 492 printed texts before it was
 * written. What is actually in there:
 *
 *   `X`      59×  the value. THE ONE THIS SUBSTITUTES.
 *   `X/X`     9×  STAT notation (Awoken Tomb, Arcane Concentrator, Embermaw
 *                 Fledgling, Perpetual Construct, Soul Siphon, Flesh Tithe,
 *                 Keeper of Tithes, Floral Singularity ×2). NOT touched.
 *   `+X/+X`   1×  stat notation (Life Channel). NOT touched.
 *   `-X/-X`   1×  stat notation (Burden of Life). NOT touched.
 *   `[x]`     8×  a COST PIP, lower-case and bracketed (Gravitational
 *                 Correction, Frosted Denial, Abduct ×2, Living Vault,
 *                 Celestial Shifter, Instrument of Reassignment). It is the
 *                 variable MANA a player pays, not the token's X, and
 *                 `iconizeText` draws it as `data/icons/cost_x`. NOT touched — a
 *                 digit substituted in there would silently become a
 *                 different cost icon.
 *   `X+1`     1×  arithmetic on the value (Flamebreath Initiate, "create a
 *                 Fireball X+1"). Substituted like a bare X; no token prints
 *                 one, so this is reach rather than a live case.
 *   `{X}`     0×  the brief expected this spelling; the pool does not use it.
 *                 Excluded anyway so it can never be mistaken for a value.
 *
 * The stat forms are excluded by refusing an X that touches a `/`, `+` or `-`
 * on the side that would make it half of a stat pair — the same anchoring
 * discipline R142 used for `/[`, and test/122's sweep still proves no `X/X`
 * in the pool moves.
 */
const X_VALUE_RE = /(?<![\w+\-/[{])X(?![\w/\]}])/g;

/**
 * A reminder-text span, which NAMES the variable instead of using its value.
 *
 * Only three cards put an X inside `{i}…` and only one of them is a token, but
 * that one is the whole reason this carve-out exists: Robot's reminder is
 * "{i}(If the number of counters changes, so does the X value.)" — a sentence
 * whose entire job is to talk ABOUT X. Substituting there yields "so does the
 * 3 value", which is not a specialised card, it is a broken one.
 *
 * `{i}` is very often left unclosed by the printed text (`formatting()` closes
 * it at the reminder's own ')'), so an unterminated span runs to end of line.
 */
const REMINDER_RE = /\{i\}[\s\S]*?(?:\{\/i\}|$)/g;

/** Print `x` wherever this text uses X as a value; leave stat notation, cost
 * pips and reminder text exactly as printed. */
export function substituteX(text: string, x: number): string {
  const n = String(x);
  let out = '';
  let last = 0;
  REMINDER_RE.lastIndex = 0;
  for (let m = REMINDER_RE.exec(text); m; m = REMINDER_RE.exec(text)) {
    out += text.slice(last, m.index).replace(X_VALUE_RE, n) + m[0];
    last = m.index + m[0].length;
    if (m[0].length === 0) { REMINDER_RE.lastIndex++; }
  }
  return out + text.slice(last).replace(X_VALUE_RE, n);
}

function textOf(name: CardName): string {
  try { return getCard(name).text ?? ''; } catch { return ''; }
}
function defOf(name: CardName): CardDef | null {
  try { return getCard(name); } catch { return null; }
}

// ── R279: the card an entity has NAMED, printed where the clause is ───
//
/**
 * Reports #148 and #153, one day apart and one fact:
 *
 *   #148  "The Everywhere doesn't show the named card in its textbox (like in
 *         the right panel or on the hover box)"
 *   #153  "The Everywhere's named card stuff I reported a bit ago needs to
 *         apply to anything it's modding as well"
 *
 * The printed clause is "[Augment] During [Haste] name a card. My last named
 * card loses all abilities. {i}(As long as I am in their region.)" — so the
 * card that decides which abilities are switched off is LIVE PER-INSTANCE
 * STATE (`Entity.named`) sitting behind a printed variable, and it was
 * readable nowhere.
 *
 * ⚠ THIS IS THE R151 SHAPE AND IT IS DELIBERATELY SOLVED THE R151 WAY. R151
 * (CT-33) is the ruling for a token's X: *"Tokens should have their X value in
 * their text box modified to say the actual number, rather than X"* — a
 * display-time substitution of a live value into the sentence the pool already
 * prints. "My last named card" is the same kind of variable and gets the same
 * treatment, which is what keeps this out of R252's failure: no sentence is
 * authored, so nothing new can acquire the authority of printed text. The box
 * reads "During [Haste] name a card. Triskaidekaphage loses all abilities."
 *
 * ⚠ AND IT IS ONE DERIVATION WITH TWO CONSUMERS, NOT TWO LOOKUPS. `namedCardOf`
 * answers "which card has this entity named" for BOTH surfaces, because the
 * ENGINE already stores it in one place: `Entity.named` lives on the ANCHOR
 * (types.ts, and engine.ts:589 — an augment mod's anchor is
 * `entity(holder.modOf)`), so the memory of a donated naming sits on the HOST.
 * #148 reads it off the unit; #153 reads the same field off the same entity
 * from the host's side; a mod's own box resolves its host. R268 had already
 * made the host render the donated clause, which is why the substitution needs
 * no second site — it is applied to the whole box, exactly as `substituteX` is.
 */

/**
 * The printed variable, scanned for rather than typed.
 *
 * ⚠ A CENSUS, NOT A GUESS, and test/259 re-runs it: exactly one card in the
 * pool prints the phrase today (The Everywhere), and no card is named here —
 * `namedCardOf` reads an ENGINE field and this regex reads PRINTED TEXT, so a
 * second naming card written tomorrow is covered on the day it lands.
 *
 * `my|the|its` because the pool's one instance writes "My", and a card written
 * in the second or third person would write one of the others; `last` is
 * optional for the same reason. Anchored on "named card", which is the phrase
 * that carries the meaning and which nothing else in the pool prints.
 */
export const NAMED_CARD_RE = /\b(?:my|the|its)(?:\s+last)?\s+named\s+card\b/i;

/**
 * The card this entity's naming clause currently remembers, or undefined.
 *
 * `''` is a real value of `Entity.named` — "name no card (release my last
 * naming)" — and it is deliberately NOT a name here: there is nothing to
 * print, so the printed variable is left standing, which is exactly what the
 * card then says.
 */
export function namedCardOf(e: E, u: Entity): CardName | undefined {
  if (u.named) return u.named;
  // an augment mod holds no memory of its own: its anchor is its host
  // (engine.ts `staticsFor` -> `entity(holder.modOf)`), and that is where
  // E.queueTrigger stamped the naming trigger's source in the first place
  if (u.kind === 'mod' && u.appliedAs === 'augment' && u.modOf !== undefined) {
    return e.entity(u.modOf)?.named || undefined;
  }
  return undefined;
}

/** Print the named card wherever this text uses the printed variable. Global,
 * because a card may print the clause more than once; the sentence is
 * otherwise untouched. */
export function substituteNamed(text: string, named: CardName): string {
  // a FUNCTION replacement, so a card name can never be read as a `$1`-style
  // substitution pattern — the same care `substituteX` takes by building its
  // replacement from a number
  return text.replace(new RegExp(NAMED_CARD_RE.source, 'gi'), () => named);
}

// ── R279: the printed PROPHECY BANNER, put back into the text box ─────
//
/**
 * Report #150: *"Cards with prophecy should have what that means in their
 * rulings and reminder text area."*
 *
 * ⚠ THE POOL PRINTS NO PROPHECY REMINDER — I looked before writing one, which
 * is what R267 and R252 are both about. Seven cards carry a printed banner
 * (`CardDef.prophecy`) and none of the 492 printed texts contains a `{i}(…)`
 * span explaining it; `data/rules/Algomancy-Manual.txt` does not contain the
 * word "prophecy" at all, so R252's second channel is silent too. See R279 for
 * the third channel I found and rejected.
 *
 * So nothing is authored here either. What IS missing is mechanical: the
 * extractor STRIPS the banner out of `text` into a structured field
 * (scripts/extract-printed.mjs, and dsl.ts says so on the field), which means
 *
 *   · the text box never showed it — The Foretold's whole printed text box is
 *     its banner, and `printedTextBox` rendered "no rules text"; and
 *   · no scan of `text` can ever see the word "Prophecy", so ui/main.ts's
 *     `glossaryHits([type, text, …])` could not reach the {Prophecy} row on
 *     the seven cards that most need it.
 *
 * This puts the printed line back, reconstructed from the pool's own two
 * fields and nothing else, in the spelling `iconizeText` draws as the card
 * does: `[0]` becomes the mana circle the scan shows beneath The Foretold's
 * title. (The upstream oracle file is inconsistent about the brackets — five
 * of the seven write "[2] Prophecy — …" and two write a bare "1 Prophecy — …"
 * — and the scans show a cost pip on all seven, so the bracketed form is the
 * one that renders what is on the card.)
 */
export function prophecyBanner(name: CardName): string {
  const p = defOf(name)?.prophecy;
  return p ? `[${p.mana}] Prophecy — ${p.condition}` : '';
}

/**
 * The printed text box of a card, banner included — the one place the two
 * halves the extractor split are put back together, so `printedTextBox` and
 * `entityTextBox` cannot show different printed cards.
 *
 * Joined with `{/n}`, which is the marker the upstream oracle file itself uses
 * after the banner ("[1] Prophecy — Two Turns Pass{/n}I can be prophesied from
 * your bin") and which `formatting()` draws as the `<br>` the physical card
 * has between its banner bar and its text box. `clean` is applied to the BODY
 * only, so this is the one `{/n}` in a box line and it is a real line break
 * rather than the mid-word one `clean` exists to join away.
 */
function printedBoxText(name: CardName): string {
  return [prophecyBanner(name), clean(textOf(name))].filter(Boolean).join('{/n}');
}

// ── R282: the TYPE-LINE ATTRIBUTE, in the place a player reads rules text ─
//
/**
 * I asked the owner whether four cards whose oracle text is EMPTY — Whispering
 * Mantid, Slink, Crumbling Ancient, Tempest Wrangler — should have a printed
 * reminder added as an override. 2026-08-30, verbatim:
 *
 *   *"That's cause they're attributes in the type line, not abilities.
 *    Attributes should show up in that place too. Maybe that's the root of
 *    this issue"*
 *
 * So the transcription is CORRECT and nothing is overridden: those cards have
 * no ability text, and their whole rules content is a marker on the type line.
 * The client was the thing that was wrong. This box is assembled out of
 * `CardDef.text`, that field is empty, and `ui/main.ts textBoxHtml` therefore
 * drew the words "no rules text" over a card whose printed marker is the only
 * thing it does — the same sentence, and the same shape, as the prophecy half
 * of R279 three hours earlier.
 *
 * ⚠ 21 CARDS, NOT FOUR. Derived, not typed: every card in the pool whose
 * printed box text is empty and whose type line carries an attribute. Flying,
 * Evasive, Swift, Tough, Balanced, Deadly, Sneaky, Powerful, Vulnerable,
 * Thieving, Resonant, Poisonous, Sluggish, Piercing, Unaware, Inverted,
 * Alluring, Blessed — eighteen attributes over twenty-one cards, and a card
 * shipped tomorrow with the same shape joins them on the day it lands.
 *
 * ⚠ WHY IT IS SCOPED TO A BOX THAT IS OTHERWISE EMPTY, and this is the whole
 * design decision. The obvious reading — "put every attribute's reminder in
 * every box" — re-opens report #118 on several hundred cards at once (*"the
 * reminders in the 'Rules' page and under units is too verbose"*, R248) and
 * restates on every card what the attribute ROW above it and the glossary
 * block below it already say. The defect is narrower than that and is exactly
 * what the owner was looking at: a box that declares a card has no rules text
 * when the card's rules text is on its type line. Where the card speaks for
 * itself, nothing is added.
 *
 * ⚠ AND THE SENTENCE IS READ, NEVER COPIED. `ui/glossary.ts` is a rules
 * document (its own header, R206) whose rows are corrected on their own
 * schedule and whose `text` is already the pool's own printed reminder
 * wherever one exists (R248), the manual's where one does not (R252). Reading
 * it here at render time is what makes a corrected row reach the card the same
 * day; a sentence pasted into this file would go on teaching the withdrawn
 * one, which is CT-76 twice over.
 *
 * ⚠ THE LINE IS `origin: 'printed'` ON PURPOSE, and not only because it IS
 * printed on the card. `ui/main.ts LINE_TAG` is a `Record<LineOrigin, …>`: a
 * new origin invented here would not merely go untagged, it would fail to
 * typecheck in a file this box has no business changing. A single printed line
 * on an unmodified card is also the one case `textBoxHtml` draws BARE — no
 * origin tag at all — which is what a printed reminder should look like.
 */

/** the markers this card's type line carries that the glossary can explain, in
 * printed order, with the sentence a player is shown for each */
export function attrReminders(name: CardName): { attr: string; text: string }[] {
  const def = defOf(name);
  // the card speaks for itself: its own box is the statement, and the
  // attribute row plus the glossary block already carry the marker
  if (!def || printedBoxText(name)) return [];
  const out: { attr: string; text: string }[] = [];
  for (const a of def.attrs ?? []) {
    if (out.some(o => o.attr === a)) continue;
    const row = GLOSSARY.find(g => g.term === a);
    if (row) out.push({ attr: a, text: row.text });
  }
  return out;
}

/**
 * One reminder, spelled the way the printed cards spell theirs: the marker in
 * braces, then the sentence in an italic parenthetical. `iconizeText` bares
 * `{Sneaky}` to its word (or draws the icon, for a marker that has one) and
 * turns `{i}(…){/i}` into the italics every other reminder in the pool renders
 * as — so this line looks like printed reminder text because it is built out
 * of the pool's own markup, not out of a second set of markup for our lines.
 *
 * Closed with an explicit `{/i}` rather than leaning on `formatting()`'s
 * auto-close at the first ')': a reminder that contains a bracket of its own
 * (the {Pure} and {Inverted} rows both do) would otherwise end its italics in
 * the middle of itself.
 */
const attrReminderText = (r: { attr: string; text: string }): string =>
  `{${r.attr}} {i}(${r.text}){/i}`;

/** the box lines a card gets when its rules content is entirely on its type
 * line — empty for every card that prints a text box of its own */
function attrTextLines(name: CardName, active: boolean): TextLine[] {
  return attrReminders(name).map(r => ({
    text: attrReminderText(r), from: name, origin: 'printed' as const, active,
  }));
}

/**
 * R249 — the spent-budget note wears the marker THAT ABILITY prints.
 *
 * ⚠ THIS SUPERSEDES ONE CLAUSE OF R135, and only that one. R135 said the note
 * is tagged `[Once]` **always**, on the argument that "the note is about the
 * BUDGET, not the card, and the budget symbol is [Once]". Before R135 it was
 * `[Switch1]` always. So the marker has been wrong on one half of the pool in
 * each direction, and the report came back the second time as: *"the [Switch1]
 * and [once] effects are DIFFERENT, despite being very similar functionally.
 * The game should use the one actually relevant to the unit."*
 *
 * The owner is right and R135's argument does not survive contact with the
 * `note` tag as it is actually rendered. Two reasons:
 *
 *  1. R135's own rule — *a line never repeats what its own TAG already says* —
 *     does not reach this line. `ui/main.ts LINE_TAG.note` is "⏳ spent", not
 *     an icon; there is no symbol on the tag for the text to duplicate. R135
 *     borrowed the augment/graft argument for a line that is not shaped like
 *     the augment and graft lines.
 *  2. The two markers are not two spellings of one thing. `[Switch1]` is the
 *     bounded **graft** marker: the clause under it TRANSFERS when the card is
 *     grafted (`switchClause`), and 113 of the pool's 138 graft donors print
 *     it. `[once]` is a bounded ability that transfers nothing. Flattening
 *     both to `[Once]` erases a real, printed distinction — which is the whole
 *     of the re-report.
 *
 * So the marker is DERIVED from the printed clause the spent budget belongs
 * to, at every emit site, and never typed as a list of cards. The pool today:
 * 88 cards have a bounded ability, 64 print `[Switch1]`, 22 print `[once]`,
 * ZERO print both, and no card has two bounded abilities — so a per-clause
 * read is exact. `test/228-spent-marker.test.ts` re-derives all four numbers
 * and fails the moment one of those invariants stops holding.
 *
 * Two cards spell the budget in PROSE and print no marker at all (The
 * Bonesculptor "each deployment", Gridxlan "during deployment"). They fall
 * back to `[Once]`, which is R135's answer kept exactly where its argument
 * still holds: with nothing printed to follow, the note names the budget.
 *
 * ⚠ Still the note line only. `[Switch1]` is a real token in printed card text
 * (118 cards print one) and always rendered as the graft symbol there.
 */
const SPENT_ONCE = '[Once]';
const SPENT_SWITCH1 = '[Switch1]';

/**
 * The budget marker one printed clause wears. `[Switch1]` when the clause
 * prints one; `[Once]` otherwise — see R249 for why the fallback is `[Once]`
 * and not "no marker".
 */
export const budgetMarker = (clause: string): string =>
  /\[switch1\]/i.test(clause) ? SPENT_SWITCH1 : SPENT_ONCE;

/**
 * A card's own printed text with its `[Augment]` box cut off — the half its
 * `abilities[]` implement. The complement of `augmentClause`, so that a card
 * printing `[Augment][once]` under a `[Switch1]` ability of its own could
 * never lend the wrong marker to the other one. No card in the pool does both
 * today; scoping the read is what keeps that from mattering if one ever does.
 */
export function ownClause(name: CardName): string {
  const t = textOf(name);
  const m = AUGMENT_RE.exec(t);
  return clean(m ? t.slice(0, m.index) : t);
}

// ── the composed graft ability (Manual p.33) ──────────────────────────

/**
 * A host's graft-cause trigger and its grafted `[Switch]` effects are ONE
 * ability, and the box has to read like one: the host's cause clause, then
 * the host's own effect, then each graft's effect in mod order. Returns null
 * when there is nothing composed to show.
 */
export function graftComposition(e: E, u: Entity): { head: string; parts: { text: string; from: CardName }[] } | null {
  const grafts = u.mods
    .map(id => e.entity(id))
    .filter((m): m is Entity => !!m && m.appliedAs === 'graft');
  if (!grafts.length) return null;
  const host = textOf(u.card);
  if (!host) return null;
  let causeIndex = -1;
  try { causeIndex = graftCauseIndex(u.card); } catch { return null; }
  if (causeIndex < 0) return null;
  const m = SWITCH_RE.exec(host);
  const head = clean(m ? host.slice(0, m.index) : host);
  const parts: { text: string; from: CardName }[] = [];
  if (m) parts.push({ text: clean(host.slice(m.index)), from: u.card });
  for (const g of grafts) {
    const t = switchClause(g.card);
    if (t) parts.push({ text: t, from: g.card });
  }
  return { head, parts };
}

// ── attributes, attributed ────────────────────────────────────────────

/**
 * Every attribute this unit has RIGHT NOW and where each one comes from,
 * plus — when R62 has switched the layer off — the printed ones it would have
 * had, marked inactive, because "it has Flying but Flying is off" is the
 * thing a player needs to see.
 *
 * Column-shared attributes (combat shares them vertically) are included and
 * flagged 'column': in a formation they are as real as printed ones, and they
 * are the single most-missed thing on the board.
 */
export function attrLines(e: E, u: Entity): AttrLine[] {
  const sup = e.suppressionOf(u);
  const out: AttrLine[] = [];
  const put = (attr: string, origin: AttrOrigin, from: CardName | null, active: boolean) => {
    const seen = out.find(a => a.attr === attr);
    if (seen) { if (active && !seen.active) { seen.active = true; seen.origin = origin; seen.from = from; } return; }
    out.push({ attr, origin, from, active });
  };
  const live = sup.attrs ? new Set<string>() : e.ownAttrs(u);
  // R118 layer 0: "printed" means the card this entity currently IS
  const def = defOf(e.nameOf(u));
  for (const a of def?.attrs ?? []) put(a, 'printed', null, live.has(a));
  for (const a of u.tempAttrs ?? []) put(a, 'temp', null, live.has(a));
  for (const id of u.mods) {
    const m = e.entity(id);
    if (!m || m.appliedAs !== 'augment') continue;
    for (const a of defOf(m.card)?.augmentAttrs ?? []) put(a, 'augment', m.card, live.has(a));
  }
  for (const p of e.projections(u)) {
    for (const a of p.attrs) put(a, 'static', p.from, live.has(a));
  }
  // shared vertically within a formation column — real, and easy to miss
  const col = e.columnOf(u.id);
  if (col && !sup.attrs) {
    for (const id of col) {
      if (id === u.id) continue;
      const mate = e.entity(id);
      if (!mate) continue;
      for (const a of e.ownAttrs(mate)) put(a, 'column', mate.card, true);
    }
  }
  return out;
}

// ── the stat arithmetic ───────────────────────────────────────────────

export function statBreakdown(e: E, u: Entity): StatBreakdown {
  // R118 layer 0 IS layer 1's input, so the box reads the engine's own answer
  // rather than re-deriving it from a card definition
  const printed: [number, number] = e.printedStats(u);
  const base = e.baseStatsOf(u);
  const [power, toughness] = e.effStats(u);
  const parts: { label: string; dp: number; dt: number }[] = [];
  if (base[0] !== printed[0] || base[1] !== printed[1]) {
    // layer 2 is a replacement, so it is shown as one line for the whole
    // rewrite rather than per source — but name the continuous source when
    // there is one, since its own dp/dt line would read +0/+0. Only a setter
    // whose numbers ARE the resolved base gets credit: layer 2 is last-wins,
    // and a Statweaver that an until-regroup rewrite overrode did not do this.
    const setters = [...new Set(e.projections(u)
      .filter(p => (p.baseP !== undefined || p.baseT !== undefined)
        && (p.baseP ?? base[0]) === base[0] && (p.baseT ?? base[1]) === base[1])
      .map(p => p.from))];
    const by = setters.length ? ` (${setters.join(', ')})` : '';
    parts.push({
      label: `base rewritten to ${base[0]}/${base[1]}${by}`,
      dp: base[0] - printed[0], dt: base[1] - printed[1],
    });
  }
  if (u.counters) parts.push({ label: `${u.counters > 0 ? '+' : ''}${u.counters} counters`, dp: u.counters, dt: u.counters });
  if (u.tempPower || u.tempToughness) {
    parts.push({ label: 'until regroup', dp: u.tempPower, dt: u.tempToughness });
  }
  for (const p of e.projections(u)) {
    if (p.dp || p.dt) parts.push({ label: p.from, dp: p.dp, dt: p.dt });
  }
  // whatever layer 4 (Tough/Balanced) and anything above it did is the gap
  // between the sum so far and the number the engine actually reports
  const summed = parts.reduce((acc, p) => [acc[0] + p.dp, acc[1] + p.dt] as [number, number],
    [printed[0], printed[1]] as [number, number]);
  if (summed[0] !== power || summed[1] !== toughness) {
    parts.push({ label: 'attribute layer', dp: power - summed[0], dt: toughness - summed[1] });
  }
  return {
    power, toughness, printed, base, parts,
    counters: u.counters, damage: u.damage,
    changed: power !== printed[0] || toughness !== printed[1],
  };
}

// ── {Unstable} (R135) ─────────────────────────────────────────────────

/**
 * "It also doesn't show unstable anywhere."
 *
 * It is a bin REPLACEMENT, not a combat attribute — deliberately absent from
 * the `Attr` union (types.ts, dsl.ts) — so it was never going to arrive in the
 * attribute row, and nothing else looked for it. Two of the pool's cards print
 * `{Unstable}` in their TYPE LINE (Oorblak, Aberrant Statweaver), which the
 * type line does render; every OTHER way in is invisible, and those are the
 * ways that actually happen at the table. The blanket Manual p.35 rule is the
 * common one: a modded card is Unstable, so the moment you slide a mod under a
 * unit it stops going to a bin, and the box said nothing about it.
 *
 * It used to ride in `state`, beside "token — erased when it leaves play",
 * which is the same class of fact: what happens to this card when it leaves
 * play.
 *
 * The reason is worth printing because there are FOUR ways in and they expire
 * differently — a mod can be removed, an R96 stamp lapses at regroup, a printed
 * marker never does. Read through `E.isUnstable`, never re-derived: the union
 * lives in the engine and this asks it.
 *
 * ── R271 / REPORT #143: IT IS AN ATTRIBUTE LINE, NOT A FOOTNOTE ──────
 *
 * The owner, 2026-08-30: *"Instead of putting Unstable reminder text at the
 * bottom of a card ("Unstable — it is modded; it is erased instead of binned
 * (Manual p.35)") put it in it's attribute line."*
 *
 * He is right and the comment above says why it was not: {Unstable} is not in
 * the `Attr` union, so R135 put it where a non-attribute could go. But `Attr`
 * is the ENGINE's union — what a rule may test for — and `AttrLine` is the
 * BOX's, which is a list of the words printed on the type line. Oorblak and
 * Aberrant Statweaver print `{Unstable}` there; the four acquired ways in put
 * the same word on the same line without a rule caring where it came from,
 * which is exactly what `AttrOrigin` already exists to say.
 *
 * So the word goes on the attribute row and the ORIGIN carries the reason —
 * "from a mod", "until regroup", "printed" — which is what `unstableWhy` was
 * spelling out in prose. And the payoff is the sentence: an attribute row is
 * looked up in the glossary (main.ts `inspectorHtml`), and the glossary's
 * {Unstable} text is the POOL's own printed reminder, read out of printed.json
 * by R267's `leadReminders` (Spell Excavation: *"If it would enter a bin,
 * erase it instead."*). The hand-typed "(Manual p.35)" sentence goes with it.
 */

/** which of `E.isUnstable`'s four ways in applies, in the engine's own order —
 * as an `AttrOrigin`, so the box says it the way it says every other acquired
 * attribute rather than in a sentence of its own */
function unstableOrigin(e: E, u: Entity): AttrOrigin {
  if (u.mods.length > 0) return 'augment';         // "from a mod"
  if (u.unstable === true) return 'temp';          // R96 — "until regroup"
  if (defOf(e.nameOf(u))?.unstable === true) return 'printed';
  return 'static';                                 // R118 ruling 2 — a copy of a modded card
}

/* ── CT-175 (#157): the until-regroup effects with nothing to quote ────
 *
 * THE REPORT, verbatim: *"Spell effects that do something to a unit until
 * regroup should be said in the 'current text' of the card. in this case, I
 * played a spell on one Prickly Protector, but there's no mention of that
 * effect when I hover over it"* — HTEW, and the spell was **Phytochemical
 * Protection** ([132]/[133], resolved [135]): *"Until regroup, prevent all
 * damage that would be dealt to target unit."* It set `damageShield` and
 * nothing else, and nothing in this module read that field. Three actions
 * later it prevented all 8 damage and paid out 8 +1/+1 counters, off a box
 * that had said the unit was ordinary.
 *
 * THE CLASS, AND WHERE ITS MEMBERSHIP IS DEFINED. This file's header states
 * the old rule — "an until-regroup change with no card text behind it is not a
 * line: a temp +X/+Y is a term in the stat arithmetic and a temp attribute is
 * a chip in the attribute row" — and that rule is right about the fields it
 * was written for and silent about the rest. "Until regroup" is DEFINED in
 * exactly one place: the R11 step-3 sweep in engine.ts, whose twelve fields
 * are the whole list. Nine of them already had somewhere to be:
 *
 *   tempPower · tempToughness · baseSet   the stat arithmetic
 *   tempAttrs · unstable (R271/#143)      the attribute row
 *   suppressed                            the ⊘ row
 *   granted (R63) · copies (R118)         lines of their own
 *   baseSetSeq                            a tiebreak timestamp for `baseSet`,
 *                                         with no meaning of its own to show
 *
 * The three left over are the ones here, and they have no card text to quote:
 * `damageShield`/`shieldPending` are stamped by a spell that has already
 * resolved and left play, and `allured` is stamped by a combat trigger whose
 * source may be long dead (which is exactly why main.ts's #117 badge derives
 * it from the field and consults no card). So the line is SYNTHESIZED, and its
 * own origin says what it is.
 *
 * ⚠ IT IS A LINE, NOT A `state` NOTE, and that is the report rather than
 * taste: the player was HOVERING. main.ts renders the hover tip with
 * `{ compact: true }`, and compact drops `statMathHtml` and the whole `state`
 * row. A note would have been invisible on precisely the surface the report is
 * about. Lines survive both modes.
 *
 * DERIVED, NOT ENUMERATED, on the other side: 266's field list is parsed out
 * of the sweep itself, so the next field added there arrives here as a red
 * test naming it rather than as a fourth silent effect.
 */
function untilRegroupLines(e: E, u: Entity): TextLine[] {
  const out: TextLine[] = [];
  // R98. Both fields, one line: `shieldPending` is the damage prevented but
  // not yet paid out as +1/+1 counters, and `E.settleDamagePrevention()`
  // drains it at the end of every commit — so it is almost always 0, and when
  // it is not, it is the same sentence with a number in it.
  if (u.damageShield || u.shieldPending) {
    const pend = u.shieldPending ?? 0;
    out.push({
      text: 'Until regroup, all damage that would be dealt to me is prevented, and I get a '
        + '+1/+1 counter for each damage prevented this way.'
        + (pend ? ` (${pend} damage prevented so far, not yet paid out.)` : ''),
      from: u.damageShield ?? '',
      origin: 'until',
      active: true,
    });
  }
  // R84 {Alluring}. TWO effects with two different lifetimes (types.ts), and
  // main.ts's #117 badge already says which is live; this says the same thing
  // by the same test, so the badge and the box cannot disagree. The
  // can't-attack half is the bare presence of the field — `apply.ts` refuses
  // on `need(!u.allured, …)` — and the must-block half belongs only to the
  // round that lured it.
  if (u.allured) {
    const duty = u.allured.round === e.s.battle?.round && u.allured.columns.length > 0;
    out.push({
      text: 'Lured (Alluring): I cannot attack or counterattack for the rest of this battle '
        + `phase${duty ? ', and I must block the column that lured me if I am able' : ''}.`,
      from: '',
      origin: 'until',
      active: true,
    });
  }
  return out;
}

// ── the box ───────────────────────────────────────────────────────────

/**
 * The text box of a live entity, as the game sees it.
 *
 * Order is the order a physical modded card reads: the printed box first
 * (composed with its grafts when it has any), then each mod's donated clause
 * in the order they were slid under it, then granted text, then what the rest
 * of the board is projecting onto it.
 */
export function entityTextBox(e: E, u: Entity): CardTextBox {
  const face = e.nameOf(u);                 // R118: the card it currently IS
  const def = defOf(face);
  const sup = e.suppressionOf(u);
  const lines: TextLine[] = [];
  // NB: a silenced line carries no `why`. The suppression banner sits directly
  // above the lines and names the culprit once; repeating it on every struck
  // clause was the first thing that read as noise (2026-08-21). `why` is
  // reserved for reasons that are NOT already on the box.
  const silenced = sup.abilities;

  // 1. the printed box — composed with its grafts when they have a cause.
  //    R279: `printedBoxText`, not `textOf`, so the prophecy banner the
  //    extractor split off is part of the printed card again on every surface.
  const comp = graftComposition(e, u);
  const printed = printedBoxText(face);
  if (comp) {
    lines.push({
      text: [prophecyBanner(face), [comp.head, ...comp.parts.map(p => p.text)]
        .filter(Boolean).join(' ')].filter(Boolean).join('{/n}'),
      from: face, origin: 'graft', composed: true,
      active: !silenced,
    });
  } else if (printed) {
    lines.push({
      text: printed, from: face, origin: 'printed',
      active: !silenced,
    });
  } else {
    // R282: nothing printed in the box — so the card's rules content, if it
    // has any, is the markers on its type line. `!sup.attrs` rather than
    // `!silenced`: what R62 switches off here is the ATTRIBUTE layer, so this
    // line is struck through by the same suppression that strikes its chip.
    for (const l of attrTextLines(face, !sup.attrs)) lines.push(l);
  }

  // 2. mods, in the order they were applied (index 0 sits nearest the card)
  for (const id of u.mods) {
    const m = e.entity(id);
    if (!m) continue;
    if (m.appliedAs === 'graft') {
      // already folded into the composition above; a graft with no cause to
      // join is the one case worth printing on its own, as a dead line
      if (comp) continue;
      const t = switchClause(m.card);
      if (t) {
        lines.push({
          // R135: the ⇄ tag beside it is already the [Switch] symbol
          text: dropOriginMarker(t), from: m.card, origin: 'graft', active: false,
          why: `${u.card} has no [Switch] cause for it to join`,
        });
      }
      continue;
    }
    const donated = augmentClause(m.card);
    const attrs = defOf(m.card)?.augmentAttrs ?? [];
    const text = donated || (attrs.length
      ? `[Augment] Grants ${attrs.map(a => `{${a}}`).join(' ')}.`
      : '');
    if (!text) continue;
    lines.push({
      // R135: the augment icon is already on this line's tag
      text: dropOriginMarker(text), from: m.card, origin: 'augment',
      active: !silenced,
    });
  }

  // 3. R63 grants
  for (const g of u.granted ?? []) {
    lines.push({
      text: g.text, from: g.from, origin: 'granted',
      active: !silenced,
    });
  }

  // 3b. R118 the COPY layer. The printed line above is already the copied
  //     card's, so what is left to say is the part a player cannot see: which
  //     PHYSICAL card this is (it bins as itself — ruling 1), how long the
  //     face lasts, and the mods' text a copy inherits without inheriting the
  //     mods themselves (ruling 2, and it is why the copy is Unstable).
  for (const c of u.copies ?? []) {
    if (!c.facets.includes('name')) continue;
    lines.push({
      text: `A copy of ${c.card}${c.until === 'regroup' ? ' until regroup' : ''}`
        + ` — the card itself is ${u.card}, and that is what bins.`,
      from: c.from, origin: 'copy', active: true,
    });
    if (c.modText?.length) {
      // R279 (#149, the class): the {Unstable} half of this sentence is gone.
      // R271 put {Unstable} on the attribute row, and `E.isUnstable`'s fourth
      // way in is exactly "a copy of a modded card" — so the chip is there,
      // in both render modes, whenever this line is.
      lines.push({
        text: `It copied a modded card, so it also has ${c.modText.join(', ')}.`,
        from: c.from, origin: 'copy', active: true,
      });
    }
  }
  // faces PROJECTED onto it right now (Ancient One) — additive, abilities only
  for (const facet of ['statics', 'activated', 'triggered', 'behavior'] as const) {
    for (const name of e.facesWith(u, facet)) {
      if (name === face) continue;
      if (lines.some(l => l.origin === 'copy' && l.from === name)) continue;
      lines.push({
        text: clean(textOf(name)), from: name, origin: 'copy', active: !silenced,
      });
    }
  }

  // 3c. CT-175 (#157) — the until-regroup effects that have NO CARD TEXT
  //     behind them and no other row to sit in. See `untilRegroupLines`.
  lines.push(...untilRegroupLines(e, u));

  // ── the attribute row, built BEFORE the projection lines because they are
  //    now checked against it (R279 §2). `attrLines` is the type line plus
  //    what the board is projecting; the two appended rows are the sources it
  //    does not know about.
  const attrRow = attrLines(e, u);
  // R271 (#143): {Unstable} joins the attribute row rather than the footnotes.
  // Appended, not spliced: this is a fifth source `attrLines` does not know
  // about — but only once, because a card that PRINTS the marker may already
  // be carrying it.
  if (e.isUnstable(u) && !attrRow.some(a => a.attr === 'Unstable')) {
    const origin = unstableOrigin(e, u);
    attrRow.push({
      attr: 'Unstable', origin,
      from: origin === 'augment' ? (e.entity(u.mods[0]!)?.card ?? null) : null,
      active: true,
    });
  }
  // R279 (#150): the printed PROPHECY banner marker, on the same argument R271
  // made for {Unstable} — `Attr` is the ENGINE's union (what a rule may test
  // for) and `AttrLine` is the BOX's (the printed markers this card wears). It
  // is what carries the {Prophecy} reminder into ui/main.ts's inspector, whose
  // other reminder path scans `text` and can never see a banner the extractor
  // took out of it.
  if (def?.prophecy && !attrRow.some(a => a.attr === 'Prophecy')) {
    attrRow.push({ attr: 'Prophecy', origin: 'printed', from: null, active: true });
  }

  /* 4. what the board is projecting onto it. A projection is text on ANOTHER
   *    card, so it is synthesized from what the projection actually does —
   *    which is also the only honest thing to print, since the other card's
   *    sentence is about a whole class of units, not about this one.
   *
   * ── R279 / REPORT #149: A SYNTHESIZED LINE NEVER RESTATES A ROW ────────
   *
   * The owner, room ZSPG: *"the text is often redundant. For example, when the
   * abilities are turned off, there's a red banner that says its abilities are
   * switched off by XYZ, then the text is crossed out and then there's another
   * thing under it, saying it has its abilities switched off by XYZ. Just the
   * banner and crossing out of the text is enough."*
   *
   * ⚠ HE SAID "OFTEN", AND HE MEANT A CLASS. Every bit this loop can emit is
   * ALSO stated by a structured row of the same box, because both are built
   * from `E.projections` — so the whole line is a restatement, and the only
   * question is which restatements a player can see at the same time.
   * ui/main.ts's `textBoxHtml` draws four rows, and `compact` (the long-hover
   * tooltip) drops one of them:
   *
   *   suppression   `.tbsupp`, the red banner. Drawn in BOTH modes, and
   *                 `E.suppressionOf` blames exactly the sources this loop
   *                 walks — so it can never miss one.        → DROPPED here.
   *   attributes    `.tbattrs`, one chip per attribute carrying its origin and
   *                 its source in the tooltip. Drawn in BOTH modes.
   *                                                          → DROPPED here.
   *   stat maths    `statMathHtml`, one term per source. DROPPED in compact —
   *                 so on hover this line is the only per-source attribution a
   *                 +2/+2 or a base rewrite has.             → KEPT.
   *
   * That is a rule rather than a list: a bit goes only when another row of the
   * SAME box states it in EVERY render mode. Deleting the stat bits too would
   * have satisfied the report and quietly made the hover box worse, which is
   * the trade R248 §2 is about.
   */
  // What each blamed source switches off. The banner prints the UNION
  // ("attributes and abilities switched off by A, B"), which is complete only
  // while every suppressor is doing the same thing; two suppressors switching
  // off DIFFERENT layers are told apart nowhere else, so there the line stays.
  const supKind = new Map<CardName, string>();
  const blame = (from: CardName, attrsOff: boolean, absOff: boolean): void => {
    const was = supKind.get(from) ?? '..';
    supKind.set(from,
      `${attrsOff || was[0] === 'A' ? 'A' : '.'}${absOff || was[1] === 'B' ? 'B' : '.'}`);
  };
  if (u.suppressed?.attrs) blame(u.suppressed.attrs, true, false);
  if (u.suppressed?.abilities) blame(u.suppressed.abilities, false, true);
  for (const p of e.projections(u)) {
    if (p.suppressAttrs || p.suppressAbilities) {
      blame(p.from, p.suppressAttrs, p.suppressAbilities);
    }
  }
  const bannerIsComplete = new Set(supKind.values()).size <= 1;

  for (const p of e.projections(u)) {
    const bits: string[] = [];
    if (p.baseP !== undefined || p.baseT !== undefined) {
      // layer 2: it replaces the number rather than adjusting it, so it reads
      // "is base X/Y" — printing a delta here would be a lie about stacking
      bits.push(`is base ${p.baseP ?? '\u2014'}/${p.baseT ?? '\u2014'}`);
    }
    if (p.dp || p.dt) bits.push(`${sign(p.dp)}/${sign(p.dt)}`);
    // R279: only the attributes the row above does NOT already attribute to
    // this same source. (One switched off by R62 is still ON the row, struck
    // through and attributed, so it is covered either way.)
    const grants = p.attrs.filter(a => !attrRow.some(
      row => row.attr === a && row.origin === 'static' && row.from === p.from));
    if (grants.length) bits.push(`gains ${grants.map(a => `{${a}}`).join(' ')}`);
    if (!bannerIsComplete) {
      if (p.suppressAttrs && p.suppressAbilities) bits.push('loses all attributes and abilities');
      else if (p.suppressAttrs) bits.push('loses all attributes');
      else if (p.suppressAbilities) bits.push('loses all abilities');
    }
    if (!bits.length) continue;
    lines.push({ text: `${bits.join(', ')}.`, from: p.from, origin: 'static', active: true });
  }

  // 5. bounded abilities whose budget is spent — the one per-ability fact.
  //
  //    R135: the note says WHICH BUDGET, not what the ability does. It used to
  //    restate `ab.label`, which is the scripted paraphrase of the very clause
  //    printed above it, so a spent ability read its own text twice and the box
  //    doubled in height ("it also duplicates the text, making it really long").
  //    Naming the ability by label was safe-looking and wrong: no card in the
  //    pool has TWO bounded abilities, so within one source there is nothing to
  //    disambiguate — only the SOURCE can repeat (a host plus two modded-on
  //    ones), and that is what these lines name.
  //
  //    R249: the MARKER is the one this ability prints — `[Switch1]` for a
  //    bounded graft clause, `[Once]` for a bounded ability — read off the
  //    clause the spent budget belongs to at each of the four emit sites
  //    below, never from a table of card names. See `budgetMarker`.
  if (!sup.abilities) {
    for (const [prefix, list] of [['ability', def?.abilities], ['augment', def?.augmentText]] as const) {
      (list ?? []).forEach((ab, i) => {
        if (!ab.bounded) return;
        if (!(u.budgets[`${prefix}:${u.card}#${i}`] ?? 0)) return;
        // the host's own clause for an `abilities[]` budget; its donated box
        // for an `augmentText[]` one — the two halves of its printed text
        const tag = budgetMarker(prefix === 'augment' ? augmentClause(u.card) : ownClause(u.card));
        lines.push({
          text: `${tag} already used this turn.`,
          from: u.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
        });
      });
    }
    for (const id of u.mods) {
      const m = e.entity(id);
      if (!m) continue;
      if (m.appliedAs === 'graft' && (m.budgets['graft'] ?? 0)) {
        // the graft's own transferred half — all 113 bounded donors print
        // `[Switch1]` there, and all 25 unbounded ones print none
        lines.push({
          text: `${budgetMarker(switchClause(m.card))} ${m.card}'s grafted effect — already used this turn.`,
          from: m.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
        });
      }
      // a bounded ability DONATED by an augment mod is budget-keyed by the
      // mod's card name, on the HOST's budgets (engine.ts composeParts:
      // `augment:<mod card>#<i>`, budgetHolder = the unit it fires from)
      if (m.appliedAs === 'augment') {
        (defOf(m.card)?.augmentText ?? []).forEach((ab, i) => {
          if (!ab.bounded) return;
          if (!(u.budgets[`augment:${m.card}#${i}`] ?? 0)) return;
          lines.push({
            text: `${budgetMarker(augmentClause(m.card))} ${m.card}'s ability — already used this turn.`,
            from: m.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
          });
        });
      }
    }
  }

  // R151 (CT-33): this instance's X, printed as the number it is. Applied to
  // the WHOLE box rather than to the printed line alone: a grant, an augment's
  // donated clause or a projection landing on a Fireball describes the same
  // spell and would otherwise disagree with the line above it. Everything
  // above has already been assembled from the engine's own queries, so this is
  // the last step and it only ever rewrites the display string.
  const x = liveX(u);
  let xShown = false;
  if (x !== undefined) {
    for (const l of lines) {
      const sub = substituteX(l.text, x);
      if (sub !== l.text) xShown = true;
      l.text = sub;
    }
  }

  // R279 (#148/#153): and this instance's NAMED CARD, the same way and for the
  // same reason — a live value standing behind a printed variable. Whole box,
  // so the clause reads the same whether it is printed on this card or donated
  // onto it by an augment (R268).
  const named = namedCardOf(e, u);
  if (named) {
    for (const l of lines) l.text = substituteNamed(l.text, named);
  }

  const state: string[] = [];
  if (u.absent) state.push('sent to counterattack — it does not exist until round 2');
  // R279 (#149, the class): only when the substitution above did NOT already
  // put the number in front of the player. R151 rewrites every X in the box to
  // the value, so on a Fireball 3 reading "Deal 3 damage" the note was the
  // second statement of one fact; on a token whose text never mentions X it is
  // the only one, and it stays.
  if (u.x !== undefined && !xShown) state.push(`X = ${u.x}`);
  if (u.token) state.push('token — erased when it leaves play');

  const stats = u.kind === 'mod' ? null : statBreakdown(e, u);
  return {
    name: face,
    typeLine: def?.type ?? '',
    stats,
    attrs: attrRow,
    lines,
    suppressed: sup,
    state,
    modified: isModified(u, lines, attrRow, stats),
  };
}

const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

function isModified(u: Entity, lines: TextLine[], attrs: AttrLine[], stats: StatBreakdown | null): boolean {
  if (lines.some(l => l.origin !== 'printed' || !l.active)) return true;
  if (attrs.some(a => a.origin !== 'printed' || !a.active)) return true;
  if (stats?.changed) return true;
  return !!(u.damage || u.counters || u.granted?.length || u.mods.length || u.copies?.length);
}

/**
 * The text box of a card that is NOT in play — one in hand, a bin, a cache, a
 * token being explained. There is no live state to read, so this is the
 * printed card; it exists so every surface in the UI renders through one
 * function and a card does not change shape as it hits the table.
 */
export function printedTextBox(name: CardName): CardTextBox {
  const def = defOf(name);
  // R279: the printed card includes its prophecy banner, which the extractor
  // splits into `CardDef.prophecy`. Off the table is exactly where that line
  // matters most — a card in hand or in a bin is where you decide to prophesy
  // it — and The Foretold's whole text box IS its banner, so without this the
  // browser and the inspector both drew "no rules text" for it.
  const text = printedBoxText(name);
  const spell = !def || def.kind !== 'unit';
  return {
    name,
    typeLine: def?.type ?? '',
    stats: spell || !def ? null : {
      power: def.power, toughness: def.toughness,
      printed: [def.power, def.toughness], base: [def.power, def.toughness],
      parts: [], counters: 0, damage: 0, changed: false,
    },
    // R135: off the table the only Unstable a card can have is the printed one
    // — and R271 (#143) puts it where the rest of the type line already is.
    // R279 (#150) adds the printed prophecy banner marker on the same footing:
    // the box's attribute row is the printed markers this card wears, and it is
    // the row ui/main.ts's inspector prints a glossary reminder for.
    attrs: [...new Set([
      ...(def?.attrs ?? []),
      ...(def?.unstable ? ['Unstable'] : []),
      ...(def?.prophecy ? ['Prophecy'] : []),
    ])].map(a => ({ attr: a, origin: 'printed' as const, from: null, active: true })),
    // R282: and when there is no printed box at all, the type line is the
    // card's rules text — see `attrReminders`. A card with neither (Tidal
    // Menace, a genuine vanilla) still gets nothing, which is the truth.
    lines: text
      ? [{ text, from: name, origin: 'printed', active: true }]
      : attrTextLines(name, true),
    suppressed: { attrs: false, abilities: false, by: [] },
    state: [],
    modified: false,
  };
}

/** the box for whatever the UI is pointing at: a live entity if it has one,
 * otherwise the printed card */
export function textBoxFor(e: E | null, name: CardName, id?: EntityId): CardTextBox {
  if (e && id !== undefined) {
    const u = e.entity(id);
    if (u) return entityTextBox(e, u);
  }
  return printedTextBox(name);
}

// ── card-text icons (ported from the RAG front-end's token mapping) ────
/** [..] / {..} keywords that have a real icon (data/icons/<name>.webp) */
export const TEXT_ICON: Record<string, string> = {
  augment: 'augment', switch1: 'bounded_graft', switch: 'graft',
  virus: 'virus', battle: 'battle', haste: 'haste', once: 'once',
};
/** amounts are spelled out on the cards ([one], [x]); three_blue is Lurking
 * Slimebeast's amount+resource-in-one-word special */
const COST_WORD: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', x: 'x', three_blue: '3b',
};
/** cost letters → faction icon; 'p' (prismite/colorless) has NO icon — left as
 * text. Taken straight from the engine (l = light, d = dark) so a new element
 * can never leave the UI with a stale copy of the pip table. */
const PIP_EL: Record<string, string> = ELEMENT_OF_PIP;
/** the same pip letters as a character class, for the [4bb]-style cost token */
const COST_TOKEN_RE = new RegExp(`^[0-9]*[${Object.keys(PIP_EL).join('')}]+$`);
/**
 * R141 — a cost written as BARE DIGITS. The pool spells the same amount two
 * ways: `[two]` (24 cards) and `[2]` (12 cards). COST_TOKEN_RE demands at
 * least one pip letter, so the digit form failed every branch above and fell
 * through to "unknown [token]: untouched" — printing a literal "[2]" beside
 * cards whose `[two]` drew the icon. `data/icons/cost_0..9` and `cost_x` have
 * existed the whole time; only one of the two spellings ever reached them.
 *
 * Exactly the R134 shape: a token nobody taught the formatter about does not
 * announce itself, it just renders as its own source text. Digits are resolved
 * per character like [4bb], so a hypothetical [10] draws 1 then 0.
 */
const COST_DIGITS_RE = /^[0-9]+$/;
/** a text-line game icon; if the file is missing it degrades to `fallback` */
export const txtIcon = (name: string, fallback: string): string =>
  `<img class="txticon" src="${ICON_BASE}${name}.webp" alt="${fallback}" onerror="this.outerHTML=this.alt">`;
/** Swap game tokens in card text / prose ([Switch1], {Battle}, [one], [4bb], …)
 * for the real icons. Escapes FIRST — always feed it RAW text, never pre-escaped
 * HTML. Unknown [tokens] stay bracketed; unknown {attrs} bare their word;
 * {/n}/{i}/{/i} formatting tokens become markup. */
/**
 * R134: FORMATTING markers are resolved globally, before the icon pass.
 *
 * They used to be handled inside the `[token]`/`{token}` replacer, which meant
 * a marker sitting INSIDE an unrecognised bracket token was never reached —
 * the modal construct `/[power {i1}or defense]` matches the bracket branch as
 * one unknown token and is returned verbatim, so five cards printed a literal
 * "{i1}" at the table (Burgeon, Void Memory, Spirit of Nature, Transmutide
 * Enigma, Floral Singularity).
 *
 * `{i1}` italicises exactly ONE word — it is the sibling of `{g}`, which
 * colours exactly one keyword. On the printed cards it is the "or" of a modal
 * choice. `{i}` opens a run that the pool almost never closes: close it at the
 * reminder's own ')' where it introduces one, and balance whatever is left over
 * at the end, so an `<i>` can never leak out of the text box.
 */
function formatting(escaped: string): string {
  let s = escaped.replace(/\{\/n\}/g, '<br>');
  // ITALICS FIRST, so the generic keyword marker below cannot mistake `{i}`
  // for one and swallow the word after it.
  //
  // R142: the whitespace between the marker and its word is CAPTURED and put
  // back. `{i1}` sits on whichever side of the word the printed line break
  // happened to leave it — "units {i1}or your" has the space before it,
  // "enemy or{i1} put a" has it after — and a bare `\s*` consumed the second
  // form's only separator, so Wither and Bloom read "each enemy orput a".
  // Reported as "text on cards still includes things that are only for the
  // engine to see" (#102): a marker that vanishes but takes a space with it is
  // as visible as one that prints.
  //
  // R284 finishes that sentence. R142 kept the space but still italicised the
  // word AFTER the marker in both forms, so "enemy or{i1} put" put the italics
  // on "put" — Wither and Bloom was the one card in the pool where the printed
  // emphasis landed on the wrong word, and nobody could see it because the
  // right word ("or") is the one every OTHER modal card italicises. The rule
  // the marker actually follows is written in R142's own sentence: `{i1}`
  // marks the word it is GLUED to. Whichever side that is, the word with no
  // whitespace between it and the marker is the one. Only when it is glued to
  // neither (nothing in the pool) does it fall through to the older
  // following-word reading. All four `{i1}` in the pool are a modal "or",
  // which is what makes the split below able to find every one of them.
  s = s.replace(/([A-Za-z][A-Za-z-]*)\{i1\}/g, '<i>$1</i>');
  s = s.replace(/\{i1\}([ \t]*)([A-Za-z][A-Za-z-]*)/g, '$1<i>$2</i>');
  // a reminder that opens with {i} and never closes: end it at its own ')'
  s = s.replace(/\{i\}(\([^)]*\))(?!\{\/i\})/g, '<i>$1</i>');
  s = s.replace(/\{i\}/g, '<i>').replace(/\{\/i\}/g, '</i>');
  // A SINGLE-LETTER marker before a word marks that ONE word as a keyword —
  // the printed cards colour it. `{g}` is the attributes ({g}deadly, {g}flying,
  // {g}piercing, {g}inverted) and `{p}` is {p}unstable. Handled GENERICALLY on
  // purpose: letter-by-letter, a marker nobody taught the formatter about falls
  // through to "unknown {token} bares its word" and renders as a stray letter
  // glued to the keyword — "ginverted", "punstable", which is exactly how this
  // was reported. A new marker letter now styles its word instead of leaking,
  // and the class carries the letter so a future palette can tell them apart.
  s = s.replace(/\{([a-z])\}([A-Za-z][A-Za-z-]*)/g, '<span class="kw kw-$1">$2</span>');
  const opens = (s.match(/<i>/g) ?? []).length;
  const shuts = (s.match(/<\/i>/g) ?? []).length;
  return opens > shuts ? s + '</i>'.repeat(opens - shuts) : s;
}

/**
 * R142 — the `/[…]` box, report #102: "All the text on cards still includes
 * things that are only for the engine to see (like {i} or / or some other
 * 'markup' notes)".
 *
 * `/[` is the last of Caleb's PRESENTATION markers still reaching a player. It
 * marks a bracket the printed card draws as its own boxed panel, and 13 cards
 * print one in two distinct jobs:
 *
 *   a COST     `[Switch1] /[Sacrifice a unit]: Draw a card.`   (Immolate)
 *   a MODE     `double its /[power {i1}or defense]`            (Burgeon)
 *
 * The census that came with the report said it only ever follows a
 * `[Switch]`/`[Switch1]` marker. It does not: six of the thirteen have no
 * Switch in front of them (Burgeon, Void Memory, Spirit of Nature, Transmutide
 * Enigma, Floral Singularity, Malevolent Machinations), and two of those START
 * their text box with it. So it is handled where every other bracket is —
 * generically, in the icon pass — not as a suffix of the Switch token.
 *
 * ⚠ `/` is ALSO stat notation (`X/X`, `+1/+1`, `-1/-1`) on far more cards than
 * use `/[`, so the slash is matched ONLY where it is glued to the `[`. Nothing
 * in the pool writes a stat slash immediately before a bracket, and the sweep
 * in test/122 renders every card in the pool to prove no `X/X` moved.
 *
 * WHY A SPAN AND NOT BARE BRACKETS. Three options were on the table: print
 * `[…]` and drop only the slash, drop the delimiters entirely, or keep the
 * grouping as markup. Bare brackets swap one engine-looking character for two
 * more — the report's complaint is exactly that card text reads like source.
 * Dropping the delimiters loses real information: on Wither and Bloom the box
 * is what tells you the whole "or" clause is one alternative rather than a
 * second sentence, and on Immolate it is what separates the cost from the
 * effect. A `<span class="costbox">` keeps the printed card's grouping, prints
 * no punctuation of its own, and is a one-line stylesheet change if the box
 * should look different later. It also nests: a `{/n}` line break or an `{i1}`
 * italic INSIDE the bracket is already resolved by `formatting()` before this
 * pass runs, and rides along inside the span.
 */
const COSTBOX = (inner: string): string => `<span class="costbox">${inner}</span>`;

/**
 * R284 — the "or" that separates a MODAL bracket's two halves, in every
 * spelling it can be wearing when it reaches one of this module's two callers.
 *
 *   raw printed text   "power {i1}or defense", "each enemy or{i1} put a"
 *   after formatting() "power <i>or</i> defense"
 *   neither            "[lost or gained]", "[gains or loses]" — two cards
 *                      carry no marker at all
 *
 * `narrowToMode` splits the RAW text (it runs on a stack item's printed
 * clause, before anything is iconized) and `iconizeText` splits the FORMATTED
 * text (formatting is resolved globally first — R134), so one regex has to
 * read both, and it does it by treating the marker and the tag as separators
 * on a par with whitespace. Requiring at least one separator on each side is
 * what keeps it a whole word: nothing matches inside "regroup" or "counters".
 */
const MODAL_OR = /(?:\s|<i>|<\/i>|\{i1\})+or(?:\s|<i>|<\/i>|\{i1\})+/;

/** balanced `<i>`? An unbalanced half means the split landed inside a tag pair
 * and the two boxes would leak markup into each other — one box is wrong-ish,
 * leaked italics are broken. */
const balanced = (s: string): boolean =>
  (s.match(/<i>/g) ?? []).length === (s.match(/<\/i>/g) ?? []).length;

/**
 * R284 — a printed bracket's two MODAL halves, or null when it is not modal.
 *
 * The discriminator is the printed "or", and it is sound both ways round:
 * every one of the pool's eight modal brackets contains one ("[power or
 * defense]", "[unit or spell]", "[gains or loses]", "[Put a -1/-1 counter on
 * each enemy or put a +1/+1 counter on each of your units.]"), and not one of
 * its thirteen COST brackets does ("[Sacrifice a unit]", "[Remove X +1/+1
 * counters from allies]", "[Erase X cards from your bin]", "[Pay 2 life]").
 * That is the whole taxonomy — R157 §21: *"All text on cards that's in [square
 * brackets] like that is either an additional cost or a modal choice."*
 */
export function modalHalves(body: string): [string, string] | null {
  const parts = body.split(MODAL_OR);
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  if (!a.trim() || !b.trim() || !balanced(a) || !balanced(b)) return null;
  return [a, b];
}

/**
 * R284 — the printed text with a modal bracket's UNCHOSEN half taken out.
 *
 * Asked for by the owner in the same breath as the two boxes: *"when it's put
 * onto the stack, the non chosen mode vanishes, making the card read how it
 * will function"*. A declared item is no longer offering a choice — the choice
 * happened in the cast window (R57) — so the card on the stack should read as
 * the one thing it is now going to do, and the surviving half keeps its box so
 * you can still see that a mode was declared at all.
 *
 * Only the FIRST modal bracket is narrowed, and a non-modal bracket is skipped
 * rather than counted: `[Switch1]` leads most of these cards' text and is not
 * a half of anything. A card with no modal bracket (an ability's `label`,
 * which is prose we wrote and not printed text) comes back untouched.
 */
export function narrowToMode(text: string, half: 0 | 1): string {
  let done = false;
  return text.replace(/\/?\[([^\[\]]+)\]/g, (tok, body: string) => {
    if (done) return tok;
    const halves = modalHalves(body);
    if (!halves) return tok;
    done = true;
    return `/[${halves[half]}]`;
  });
}

/**
 * R284 — a bracket the PRINTED CARD draws, as the box it draws.
 *
 * A MODAL bracket gets TWO boxes with the "or" between them rather than one
 * box around the pair. The owner's ask, on seeing "[unit *or* spell]" drawn as
 * a single panel: *"the OR should be outside the box and it should be two
 * boxes, one around each mode"* — and it is the truer picture, because the two
 * halves are alternatives and the box is what says "this is one option". One
 * box around both says the opposite: that the whole clause is a single thing.
 */
function printedBracket(body: string): string {
  const halves = modalHalves(body);
  return halves
    ? `${COSTBOX(halves[0].trim())} <i>or</i> ${COSTBOX(halves[1].trim())}`
    : COSTBOX(body);
}

export function iconizeText(raw: string): string {
  return formatting(esc(raw))
    .replace(/(\/?)\[([^\[\]]+)\]|\{([^{}]+)\}/g, (tok, slash?: string, br?: string, bc?: string) => {
    if (br !== undefined) {
      // R142: `/[` is the printed card's "draw this bracket as a box" marker
      const box = slash ? COSTBOX : (s: string) => s;
      const body = br.toLowerCase();
      const icon = TEXT_ICON[body];
      if (icon) return box(txtIcon(icon, `[${br}]`));   // fallback KEEPS the brackets
      const cost = COST_WORD[body]
        ?? (COST_TOKEN_RE.test(body) || COST_DIGITS_RE.test(body) ? body : undefined);
      if (cost !== undefined) {
        return box([...cost].map(c => {
          const el = PIP_EL[c];
          return el ? txtIcon(el, c) : txtIcon(`cost_${c}`, c);
        }).join(''));
      }
      // R284 — an unrecognised bracket is one of two very different things,
      // and WHITESPACE tells them apart:
      //
      //  · a one-word body is a MARKER nobody taught the formatter about, and
      //    R134/R141's lesson is that it has to announce itself rather than
      //    render as something plausible. It keeps its brackets and stays
      //    loud. (`[weird]`, and every future icon name.)
      //  · a body with a space in it is PROSE — printed card text, so a cost
      //    or a mode (R157 §21), and it is drawn as the printed box.
      //
      // That second branch is what the `/` marker used to be the only way in
      // to, and the marker is upstream transcription: eight of the pool's
      // twenty-one printed brackets do not carry it (Arbiter of Armistice,
      // Darkblast, Flesh Tithe, Necromantic Rebuke, Retribution Thing, Siphon
      // Life, Trench Stalker, Vengeance), which is why "[gains or loses]" was
      // the one modal card printing its brackets at the table while its seven
      // siblings printed boxes. No icon or cost token in the pool has a space
      // in it, so the discriminator cannot mistake one for the other, and
      // `/[` keeps working exactly as it did.
      if (slash || /\s/.test(br)) return printedBracket(br);
      return tok;
    }
    const body = bc!.toLowerCase();
    // {/n}, {i}, {i1}, {/i} and {g} are resolved by formatting() above
    const icon = TEXT_ICON[body];
    if (icon) return txtIcon(icon, bc!);             // fallback bares the word
    return bc!;                                      // {Swift} → Swift
  });
}
