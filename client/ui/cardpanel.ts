/* THE PINNED CARD PANEL, and the strip that says what you are building.
 *
 * Both of these were written for the card browser (BL-33) and both are wanted
 * verbatim on the deck page (BL-34). The reason they live here rather than
 * being copied is the reason ui/cardindex.ts exists: the client already had
 * one episode of "the deck drawer's filter and the browser's filter", and
 * `212-card-browser-wiring.test.ts` exists to stop it recurring. A second card
 * panel would drift exactly the same way — and the two pages MAY NOT import
 * each other (that test greps for it), so a neutral third module is not merely
 * tidier here, it is the only shape available.
 *
 * PURE AND DOM-FREE, like ui/cardindex.ts and ui/deckstats.ts: everything here
 * returns a string. The hosts own their own state (which card is focused, what
 * the buttons do); this file owns what a card looks like when you pin it.
 *
 * THE HOSTS SUPPLY THEIR OWN BUTTONS. `cards-similar` means something on the
 * browser and nothing on the deck page, so the panel takes the button row as
 * markup rather than growing a flag per host. The `×` is the one exception —
 * every host has one, and it needs the host's own `data-btn` prefix.
 */
import { attrReminders, iconizeText, printedTextBox, txtIcon } from './cardtext.ts';
import { GLOSSARY, glossaryHits } from './glossary.ts';
import { meaningOf } from './cardsynonyms.ts';
import type { CardRow } from './cardindex.ts';
import { rowFor } from './cardindex.ts';
import { esc, elIcon } from './util.ts';

import { ART_BASE as ART } from './assets.ts';
const artUrl = (r: CardRow): string => ART + (r.image || r.name.replace(/ /g, '-') + '.jpg');

/**
 * The scan, or the name in its place.
 *
 * The board and the deck page both emit an `<img>` unconditionally and hide it
 * `onerror`, which is right there: every card they can show has art. The
 * browser shows the whole box, and nine of those cards (the Kickstarter Glitch
 * cards) have no scan at all — so an unconditional `<img>` fires nine
 * guaranteed 404s on every paint that includes them. The index already knows:
 * `hasArt` is computed at extract time from what is on disk. Ask for a file
 * only when there is one, and print the name when there is not.
 */
export function artHtml(r: CardRow, cls: string): string {
  if (!r.hasArt) return `<div class="${cls} cbnoart">${esc(r.name)}</div>`;
  return `<img class="${cls}" src="${esc(artUrl(r))}" alt="${esc(r.name)}" loading="lazy"
    onerror="this.style.visibility='hidden'">`;
}

const ELEMENT_OF_PIP_ICON: Record<string, string> =
  { r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal', l: 'light', d: 'dark' };

/**
 * The printed cost as real icons: the mana circle, then the affinity pips.
 *
 * TWO-DIGIT COSTS DRAW PER DIGIT, which is not a flourish — the icon set stops
 * at cost_9, and `Collective Creation` (10) and `Vengeance` (13) each asked the
 * server for a `cost_13.webp` that does not exist. `txtIcon` degrades to its
 * alt text on error so it LOOKED right, and fired a 404 on every paint that
 * included either card. Splitting the digits is the convention ui/cardtext.ts
 * already states for `[10]`, so this matches what the card text does.
 */
export const costHtml = (r: CardRow): string => {
  const mana = r.isX
    ? txtIcon('cost_x', '[X]')
    : [...String(r.mana)].map(d => txtIcon(`cost_${d}`, d)).join('');
  // Only the seven elements have a pip icon. The `p` of the prismite and shard
  // faces has none — asking for /data/icons/p.webp 404s on every paint and shows
  // the alt text anyway — so an unknown pip prints the way the oracle file
  // writes it instead.
  return mana + [...r.cost]
    .map(p => (ELEMENT_OF_PIP_ICON[p] ? txtIcon(ELEMENT_OF_PIP_ICON[p]!, `[${p}]`) : `[${esc(p)}]`))
    .join('');
};

/**
 * The reminder rows under a pinned card: the glossary entries its printed
 * attributes name, then the MTG-speak synonyms for anything left over, so a
 * keyword the rules reference has not got a row for still gets a sentence
 * rather than nothing.
 *
 * R248 / report #118 — TWO FIXES, and they are separate.
 *
 * 1. IT PRINTED THE `ruling` FIELD. `g.ruling.join(', ')` put "R13, R103,
 *    R114, printed" on a player-facing panel, and an R-number means nothing to
 *    anyone who has not read docs/digital-rules.md. The FIELD stays — 177
 *    proves every citation still resolves to a live ruling, which is what
 *    caught {Unaware} teaching a withdrawn one — but it is machinery, and
 *    machinery does not render. 227-reminder-text derives that guard over
 *    every ui module that imports the glossary, so it cannot creep back in
 *    here or anywhere else.
 * 2. `g.text` is now the game's own printed reminder wherever the pool prints
 *    one (see ui/glossary.ts). The generalised rule is in `g.rule` when it
 *    says more, and this panel is where it stays reachable: the ? overlay and
 *    the in-game inspector are read mid-turn and were the two surfaces the
 *    report called too verbose, whereas the card browser is the surface you
 *    open BECAUSE you want to look something up.
 *
 * R252 / report #119 — SAME PANEL, SECOND SOURCE, NO CODE CHANGE.
 *
 * The owner read this panel again on Aetherflux Golem and objected to the two
 * rows under it: *"That text for 'Virus' and 'Augment' is OUR text. Not the
 * games."* Both are rows no card prints a reminder for, so R248 had left ours
 * on screen. ui/glossary.ts now falls back to the Algomancy Manual for seven
 * such rows, and because it does that by filling the SAME two fields — the
 * game's sentence in `text`, ours moved to `rule` — the loop below did not
 * change at all. That is the point of the split rather than a happy accident:
 * a third source can be added without touching a renderer, and no renderer can
 * be the place where a rule quietly gets shorter.
 *
 * (`g.manualOn` — "AUGMENT (Modifications, p.32)" — is deliberately NOT drawn.
 * It is provenance for an auditor, the same way `ruling` is, and this panel
 * already learned once what happens when it prints the machinery.)
 *
 * `iconizeText`, not `esc`: printed reminders carry the printed cards' own
 * markup ({/n} is normalised away in the glossary, but {g}keyword and the
 * bracket tokens are not), and the panel already renders the card's text box
 * that way one element above. It escapes first, so this is not a hole.
 *
 * R257 / CT-129 + CT-130 — WHERE THE TERMS COME FROM.
 *
 * Both original inputs were the TYPE LINE. `r.attrs` is the type line; so is
 * `r.keywords`, which is `attrs` + `augmentAttrs` + `mechanicsOf()`, and
 * `mechanicsOf` is a fixed nine-item list off booleans and two bracket
 * regexes. Nothing there ever read the TEXT BOX — so a card that GRANTS an
 * attribute in its rules text got no row for it. Brough grants {Balanced} as a
 * static and carries `attrs: []`, so the panel drew "Augment" and nothing
 * else; the in-game inspector, which has always scanned the text, drew
 * "Balanced, Augment". Two glossary paths, and the browser had the wrong one.
 *
 * The irony R248 left behind: Brough is the ONLY card in the pool printing a
 * {Balanced} reminder, so `PRINTED_REMINDERS` took Brough's own sentence as
 * the game's {Balanced} text. The browser showed Brough's sentence on Child of
 * Aether and refused to show it on Brough.
 *
 * `glossaryHits([type, text])` — ui/main.ts:2740's own call, minus the `skip`,
 * because this panel has no separate attributes section for a skipped row to
 * fall through to. UNION, not replacement: `Prophecy` and `Debt` reach seven
 * cards off a boolean without the word appearing in the box, and dropping the
 * type-line path to gain the text one would have traded one blind spot for
 * another. The union is a superset of what the inspector shows on every card
 * in the pool, which is the machine-checkable statement of this bug and is
 * what 236 asserts.
 *
 * R279 / REPORT #149 — AND IT IS WHY THE TWO `cbfact` LINES ARE GONE.
 *
 * The panel used to print two authored one-liners directly above this block:
 * *"Prophecy — a cheaper alternative cost once its printed condition is true."*
 * and *"Ambush — an alternative battle play mode."* Both terms reach
 * `glossaryFor` off `r.keywords` — `mechanicsOf` sets `prophecy` and `ambush`
 * from booleans on the printed row — so on every card that could draw one of
 * those lines, the row beneath it already said the same thing at length and
 * with a source ({Ambush}'s text is six cards' own printed reminder, R267).
 * The owner's #149 is about exactly that shape: *"the text is often
 * redundant"*, one fact stated twice in one panel. Deleting the authored copy
 * is also the R252 fix — it was OUR sentence sitting where the game's own one
 * was already available.
 *
 * The cost and the CONDITION are not lost with it: R279 puts the printed
 * banner back into `printedTextBox`, so `cbdetailtext` now prints
 * "[0] Prophecy — One Turn Passes" as the card's own first line.
 *
 * It is also what fixes {Rot} (CT-130) for free, with no second mechanism: Rot
 * is a PLAYER counter (R38), never an attribute, so no card can ever carry it
 * on a type line and the browser drew it zero times on the fifteen cards that
 * talk about it. Ten glossary rows — Rot, Cache, Glimpse, Trash, Battle,
 * Haste, Once, Recycle, Shard, Prismite — were unreachable in the browser for
 * exactly this reason. All ten are now drawn, and 236 asserts that no glossary
 * row is unreachable rather than counting the ones that used to be.
 *
 * R282 / THE OWNER ON THE FOUR EMPTY CARDS — AND WHY THIS FUNCTION TOOK AN
 * ARGUMENT.
 *
 * *"That's cause they're attributes in the type line, not abilities.
 * Attributes should show up in that place too."* R282 puts a type-line
 * attribute's reminder into the TEXT BOX of the 21 cards whose rules content
 * is nothing else — which lands that sentence directly above this block, on
 * exactly the cards where this block was already printing it. That is #149's
 * shape ("the text is often redundant") and it would have been introduced by
 * the fix for it, so `inBox` names the terms the box has already stated and
 * the row gives way to it, keeping only the `rule` the box does not carry.
 *
 * ⚠ THE DEFAULT IS UNCHANGED BEHAVIOUR, which is not laziness: 236 and 227
 * both call `glossaryFor(r)` with one argument and read the result as "what
 * the browser explains". They still get exactly what they always got. What
 * they can no longer see is what the PANEL renders, so
 * `262-type-line-attributes.test.ts` re-asserts 236's invariant over
 * `cardPanelHtml`'s markup instead of over this function.
 */
export function glossaryFor(r: CardRow, opts: { inBox?: Iterable<string> } = {}): string {
  const named = new Set(glossaryHits([r.type, r.text]).map(g => g.term));
  const terms = GLOSSARY.filter(g =>
    named.has(g.term) || r.attrs.includes(g.term) || r.keywords.includes(g.term.toLowerCase()));
  const covered = new Set(terms.map(g => g.term.toLowerCase()));
  const rest = r.keywords
    .filter(k => !covered.has(k))
    .map(k => ({ k, meaning: meaningOf(k) }))
    .filter((x): x is { k: string; meaning: string } => x.meaning !== null);
  const inBox = new Set([...(opts.inBox ?? [])]);
  const rows = terms.map(g => {
    const head = `<b>${iconizeText(g.label ?? g.term)}</b>`;
    if (!inBox.has(g.term)) {
      return `<div>${head} — ${iconizeText(g.text)}${
        g.rule ? `<br><i>${iconizeText(g.rule)}</i>` : ''}</div>`;
    }
    // R282 + R279/#149: the text box directly above already prints THIS row's
    // sentence, because the card's whole rules content is that marker. What is
    // left to add is only what the box does NOT say — `rule`, the repository's
    // fuller statement, on the rows where the printed or manual reminder is
    // narrower than it (R248 §2: shortening what a player reads may never be
    // the same edit as deleting a rule). Where there is no `rule`, the row has
    // nothing left, and a heading over a repeated sentence is the redundancy
    // the report is about.
    return g.rule ? `<div>${head} — <i>${iconizeText(g.rule)}</i></div>` : '';
  }).filter(Boolean);
  if (!rows.length && !rest.length) return '';
  return `<div class="cbgloss">${rows.join('')}${
    rest.map(x => `<div><b>${esc(x.k)}</b> — ${esc(x.meaning)}</div>`).join('')}</div>`;
}

export interface PanelOpts {
  /** the `data-btn` the host's × answers to — `cards-unfocus`, `deck-unfocus` */
  close: string;
  /** the button row, as markup. The host owns what a pinned card can do. */
  actions?: string;
  /** the rulings the host fetched, when they are for THIS card */
  rulings?: { name: string; lines: string[] } | null;
  /** a host-owned line under the facts — the browser puts "played in N
   * published decks" here. Markup, like `actions`, and for the same reason:
   * what a pinned card has to say varies by which page pinned it. */
  extra?: string;
}

/**
 * One pinned card. Returns '' for a name the index does not know, so a host
 * may pass whatever it has focused without checking first.
 */
export function cardPanelHtml(name: string, opts: PanelOpts): string {
  const r = rowFor(name);
  if (!r) return '';
  const box = r.scripted ? printedTextBox(r.name) : null;
  const lines = box ? box.lines.map(l => l.text) : [r.text];
  return `<section class="cbdetail">
    <button class="cbclose" data-btn="${esc(opts.close)}" title="close">×</button>
    ${artHtml(r, 'cbdetailart')}
    <h2>${esc(r.name)}</h2>
    <div class="cbdetailcost">${costHtml(r)}</div>
    <div class="cbdetailtype">${esc(r.type)}${r.kind === 'spell' ? '' : ` · ${r.power}/${r.toughness}`}</div>
    <div class="cbdetailtext">${lines.map(t => `<p>${iconizeText(t)}</p>`).join('')}</div>
    ${glossaryFor(r, { inBox: box ? attrReminders(r.name).map(a => a.attr) : [] })}
    <dl class="cbfacts">
      ${r.set ? `<dt>deck</dt><dd>${esc(r.set)}</dd>` : ''}
      ${r.complexity ? `<dt>complexity</dt><dd>${esc(r.complexity)}</dd>` : ''}
      <dt>class</dt><dd>${esc(r.cls)}${r.playable ? '' : ' · not deck-legal'}</dd>
      ${r.scripted ? '' : '<dt>engine</dt><dd>not scripted — the client cannot play this card</dd>'}
      ${r.provisional ? '<dt>source</dt><dd>transcribed from pre-release art, provisional</dd>' : ''}
      ${r.creates.length ? `<dt>creates</dt><dd>${r.creates.map(c => esc(c)).join(', ')}</dd>` : ''}
      ${r.transforms ? `<dt>transforms into</dt><dd>${esc(r.transforms)}</dd>` : ''}
    </dl>
    ${opts.extra ?? ''}
    ${opts.actions ? `<div class="cbdetailbtns">${opts.actions}</div>` : ''}
    ${opts.rulings && opts.rulings.name === r.name
    ? `<div class="cbrulings">${opts.rulings.lines.length
      ? opts.rulings.lines.map(l => `<p>${esc(l)}</p>`).join('')
      : '<p class="hint">no recorded rulings for this card.</p>'}</div>`
    : ''}
  </section>`;
}

/** What the strip prints — exactly what ui/deckstats.ts's `analyzeDeck` knows,
 * so neither host does deck arithmetic of its own. */
export interface DeckSummary {
  total: number;
  legal: boolean;
  problems: string[];
  curve: { mana: number; total: number }[];
  elements: Record<string, number>;
}

/**
 * The strip that says what you are building, and moves as you build it.
 *
 * The curve and the element spread are on it rather than further down the page
 * because they are the two things you are deciding ABOUT while you search: a
 * card is a good pick or a bad one relative to what the deck already has, and
 * making you scroll away to find that out is what made the browser feel
 * separate from the deckbuilder — and what made the deck page's own add drawer
 * unusable, since the deck it was adding to was a screen above it.
 */
export function deckStripHtml(
  name: string,
  s: DeckSummary,
  opts: {
    /** the button on the right, as markup — the host's, like the panel's */
    trailing?: string;
    /** the word before the name. "Building" is right where you are editing the
     * deck and wrong on a shared one you are only reading, which is the whole
     * reason this is a parameter rather than a literal. */
    lead?: string;
  } = {},
): string {
  const peak = Math.max(1, ...s.curve.map(c => c.total));
  const spread = Object.entries(s.elements).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return `<div class="cbdeckbar">
    <span class="cbdeckname">${esc(opts.lead ?? 'Building')} <b>${esc(name)}</b></span>
    <span class="cbdeckcount">${s.total} card${s.total === 1 ? '' : 's'}</span>
    ${s.legal
    ? '<span class="ok">legal</span>'
    : `<span class="warn">${esc(s.problems[0] ?? 'not legal yet')}</span>`}
    <span class="cbminicurve" title="the mana curve, lowest first">${s.curve.map(c =>
    `<span class="cbcbar" title="${c.mana} mana: ${c.total}"><i style="height:${
      Math.round((c.total / peak) * 100)}%"></i><em>${c.mana}</em></span>`).join('')}</span>
    <span class="cbdeckels">${spread.map(([el, n]) =>
    `<span class="cbdeckel" title="${esc(el)}">${elIcon(el)}${Math.round(n * 10) / 10}</span>`).join('')}</span>
    <span class="cbspacer"></span>
    ${opts.trailing ?? ''}
  </div>`;
}

/**
 * "More like this", as a QUERY rather than a similarity score: same element
 * identity, same kind, minus the card itself. Deliberately a query — you can
 * see why each result matched, and edit it.
 *
 * Shared because both pages offer the button. When it lived inside ui/cards.ts
 * the deck page's copy would have been a second, quietly different notion of
 * "similar", which is the drift ui/cardindex.ts's header is about.
 */
export function similarQuery(name: string): string {
  const r = rowFor(name);
  if (!r) return '';
  const els = r.factions.length ? `el=${r.factions.join(',')} ` : 'el:none ';
  return `${els}kind:${r.kind.toLowerCase()} -name="${r.name}"`;
}
