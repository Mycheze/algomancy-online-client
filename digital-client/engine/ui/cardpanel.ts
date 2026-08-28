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
import { iconizeText, printedTextBox, txtIcon } from './cardtext.ts';
import { GLOSSARY } from './glossary.ts';
import { meaningOf } from './cardsynonyms.ts';
import type { CardRow } from './cardindex.ts';
import { rowFor } from './cardindex.ts';
import { esc, elIcon } from './util.ts';

const ART = '../../../AlgomancyCards/';
export const artUrl = (r: CardRow): string => ART + (r.image || r.name.replace(/ /g, '-') + '.jpg');

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
  // faces has none — asking for /Icons/p.webp 404s on every paint and shows
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
 */
export function glossaryFor(r: CardRow): string {
  const terms = GLOSSARY.filter(g => r.attrs.includes(g.term) || r.keywords.includes(g.term.toLowerCase()));
  const covered = new Set(terms.map(g => g.term.toLowerCase()));
  const rest = r.keywords
    .filter(k => !covered.has(k))
    .map(k => ({ k, meaning: meaningOf(k) }))
    .filter((x): x is { k: string; meaning: string } => x.meaning !== null);
  if (!terms.length && !rest.length) return '';
  return `<div class="cbgloss">${terms.map(g =>
    `<div><b>${esc(g.label ?? g.term)}</b> — ${esc(g.text)}${
      g.ruling?.length ? ` <span class="dim">${esc(g.ruling.join(', '))}</span>` : ''}</div>`).join('')}${
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
    ${r.prophecy ? '<div class="cbfact">Prophecy — a cheaper alternative cost once its printed condition is true.</div>' : ''}
    ${r.ambush ? '<div class="cbfact">Ambush — an alternative battle play mode.</div>' : ''}
    ${glossaryFor(r)}
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
