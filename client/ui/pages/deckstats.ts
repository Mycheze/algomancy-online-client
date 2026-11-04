/* A DECK'S STATS, DRAWN: the full stats panel, the one-line strip under the
 * builder's table, and a sample opening hand (BL-65, 2026-11-04).
 *
 * deckStatsHtml moved here from ui/decks.ts word for word, with the three
 * renderers only it used (costBadge, curveHtml, affinityHtml): the shared deck
 * page (pages/meta.ts) and the builder's Stats sheet both draw it, and
 * decks.ts re-exports it for the importers that knew it there. The arithmetic
 * is ui/deckstats.ts (analyzeDeck, curveByElement); this file only draws.
 *
 * Pure, every function (962): a DeckAnalysis or a list of names in, a string
 * out. The sample hand is DEALT by the engine (challenge.ts
 * sampleOpeningHand) in the controller; it arrives here as names.
 */
import { txtIcon } from '../cardtext.ts';
import { rowFor } from '../cardindex.ts';
import { artHtml } from '../cardpanel.ts';
import { noImgDrag } from '../piletable.ts';
import { ELEMENTS, cardFacts, curveByElement, deckElements, type CardFacts, type DeckAnalysis } from '../deckstats.ts';
import { esc, elIcon } from '../util.ts';
import { button, icon } from '../components/index.ts';

/* ── the full stats panel (moved from ui/decks.ts) ──────────────────────── */

/** a card's printed cost as the game's own icons: [3][r][r] */
function costBadge(f: CardFacts): string {
  const mana = f.isX ? txtIcon('cost_x', 'X')
    // the icon set stops at 9; the pool's few double-digit costs print as text
    : f.mana <= 9 ? txtIcon(`cost_${f.mana}`, String(f.mana))
    : `<span class="costnum">${f.mana}</span>`;
  const pips = ELEMENTS.flatMap(el => Array.from({ length: f.pips[el] ?? 0 }, () => elIcon(el, el))).join('');
  return `<span class="costbox">${mana}${pips}</span>`;
}

// ── the curve (the deck page's mana / curve tab, before BL-65) ────────

function curveHtml(a: DeckAnalysis): string {
  const peak = Math.max(1, ...a.curve.map(c => c.total));
  return `<div class="dkcurve">${a.curve.map(c => `
    <div class="dkcurverow${c.total ? '' : ' empty'}">
      <span class="dkcurvem">${c.mana}</span>
      <span class="dkcurvebar">
        ${c.units ? `<span class="seg units" style="flex:${c.units}" title="${c.units} unit${c.units === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        ${c.spellUnits ? `<span class="seg spellunits" style="flex:${c.spellUnits}" title="${c.spellUnits} spell unit${c.spellUnits === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        ${c.spells ? `<span class="seg spells" style="flex:${c.spells}" title="${c.spells} spell${c.spells === 1 ? '' : 's'} at ${c.mana}"></span>` : ''}
        <span class="pad" style="flex:${peak - c.total}"></span>
      </span>
      <span class="dkcurven">${c.total || ''}</span>
    </div>`).join('')}
    ${a.xCards ? `<div class="dkcurverow x">
      <span class="dkcurvem">X</span>
      <span class="dkcurvebar"><span class="seg spells" style="flex:${a.xCards}"></span>
        <span class="pad" style="flex:${peak - a.xCards}"></span></span>
      <span class="dkcurven">${a.xCards}</span>
    </div>` : ''}
    <div class="dkcurvekey">
      <span><i class="seg units"></i> units</span>
      ${a.spellUnits ? '<span><i class="seg spellunits"></i> spell units</span>' : ''}
      <span><i class="seg spells"></i> spells</span>
      ${a.xCards ? '<span class="dim">X-cost cards sit on no rung — they cost what you pay</span>' : ''}
    </div>`;
}

/** The affinity table: what you must have OPEN, and by when. */
function affinityHtml(a: DeckAnalysis): string {
  const live = ELEMENTS.filter(el => (a.maxAffinity[el] ?? 0) > 0);
  if (!live.length) return '<div class="hint">Nothing in the deck asks for affinity yet.</div>';
  const rows = a.rows.filter(r => r.count > 0 || live.some(el => (r.need[el] ?? 0) > 0));
  const cell = (r: typeof a.rows[number], el: string): string => {
    const cum = r.cumulative[el] ?? 0;
    if (!cum) return '<td class="dknone">·</td>';
    const isNew = r.first.includes(el);
    return `<td class="${isNew ? 'dknew' : ''}" title="${isNew
      ? `a card at ${r.mana} mana is the first thing that needs ${cum} ${el}`
      : 'carried up from a cheaper card'}">${cum}</td>`;
  };
  return `<table class="dkaff">
    <thead><tr><th>by mana</th><th>cards</th>${live.map(el =>
      `<th class="acctel ${el}">${elIcon(el)}${el}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="dkmana">${r.mana}</td>
      <td class="dim">${r.count || ''}</td>
      ${live.map(el => cell(r, el)).join('')}
    </tr>`).join('')}
    <tr class="dkmaxrow"><td>everything</td><td class="dim">${a.total - a.unknown.length}</td>
      ${live.map(el => `<td><b>${a.maxAffinity[el] ?? 0}</b></td>`).join('')}</tr>
    </tbody>
  </table>
  <div class="hint">The affinity you need <b>open</b> by each mana value. <b>Bold</b> is where a new
    requirement first appears. The bottom row is the ceiling:
    ${live.map(el => `${a.maxAffinity[el]} ${el}`).join(' + ')} can play every card in the deck.</div>`;
}

/**
 * Everything a reader wants to know about a list: the curve and its average,
 * what is in it, the element share, and the affinity ceiling — *"basic stats
 * about the deck like element requirements and mana values"*.
 *
 * EXPORTED because the shared deck page (ui/meta.ts) shows the same deck to
 * somebody who cannot edit it, and growing a second, thinner stats panel there
 * is how the two come to disagree. It is a pure function of `DeckAnalysis`
 * and holds none of this page's state.
 */
export function deckStatsHtml(a: DeckAnalysis): string {
  const pct = (n: number): string => a.total ? `${Math.round((n / a.total) * 100)}%` : '0%';
  const elTotal = ELEMENTS.reduce((n, el) => n + (a.elements[el] ?? 0), 0);
  return `<section class="acctcard">
      <h3>Curve</h3>
      ${curveHtml(a)}
      <div class="hint">Average cost ${a.avgMana.toFixed(1)} mana${
        a.xCards ? `, not counting ${a.xCards} X-cost card${a.xCards === 1 ? '' : 's'}` : ''}.</div>
    </section>
    <section class="acctcard">
      <h3>What is in it</h3>
      <div class="statgrid">
        <div class="statcell"><div class="statval">${a.units}</div><div class="statlab">units (${pct(a.units)})</div></div>
        <div class="statcell"><div class="statval">${a.spells}</div><div class="statlab">spells (${pct(a.spells)})</div></div>
        ${a.spellUnits ? `<div class="statcell"><div class="statval">${a.spellUnits}</div><div class="statlab">spell units</div></div>` : ''}
        <div class="statcell" title="cards printed {Battle} — playable during a battle rather than in deployment"><div class="statval">${a.battle}</div><div class="statlab">battle cards</div></div>
        ${a.haste ? `<div class="statcell"><div class="statval">${a.haste}</div><div class="statlab">haste cards</div></div>` : ''}
        <div class="statcell"><div class="statval">${a.copies.length}</div><div class="statlab">different cards</div></div>
      </div>
    </section>
    <section class="acctcard">
      <h3>Elements</h3>
      ${elTotal ? `<div class="elbar">${ELEMENTS.map(el => {
        const w = a.elements[el] ?? 0;
        return w > 0 ? `<span class="elbarseg ${el}" style="flex:${w}"
          title="${el}: ${Math.round((w / elTotal) * 100)}%"></span>` : '';
      }).join('')}</div>
      <div class="ellegend">${deckElements(a).map(e =>
        `<span class="acctel ${e.el}">${e.el} ${Math.round(e.share * 100)}%</span>`).join('')}</div>`
      : '<div class="hint">Nothing in the deck yet.</div>'}
      <div class="hint">By card; a hybrid counts half to each element.</div>
    </section>
    <section class="acctcard wide">
      <h3>Affinity — what you need open, and by when</h3>
      ${affinityHtml(a)}
    </section>
    ${a.demanding.length ? `<section class="acctcard wide">
      <h3>The greediest costs</h3>
      <div class="dkdemand">${a.demanding.slice(0, 8).map(d => {
        const f = cardFacts(d.name);
        return `<span class="dkdemandrow">${f ? costBadge(f) : ''} ${esc(d.name)}</span>`;
      }).join('')}</div>
      <div class="hint">These set the ceiling above — cut from here to lower it.</div>
    </section>` : ''}`;
}

/* ── the strip under the table ────────────────────────────────────────── */

/** an element's colour (tokens.css: --fire, --water …); a card of no element is the border's grey */
const elColour = (el: string): string => (ELEMENTS.includes(el) ? `var(--${el})` : 'var(--color-border-strong)');
/** a flex weight, short: a hybrid's half is 0.5, never 0.5000000001 */
const w = (n: number): string => String(Math.round(n * 100) / 100);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The one line under the builder's table (BL-65; the design's "stats strip"):
 * the curve, each rung coloured by element; the element split (cards having
 * each element, a hybrid counted to both); units · spells; the average cost.
 * The whole strip is ONE button (`tt-stats`): tapping it opens the Stats sheet.
 *
 * The rungs' heights and the segments' colours are inline (they are data);
 * the strip's layout is the builder's CSS (52-builder.css: .ttstrip and its
 * parts). Every part is a <span>, because it sits inside a <button>.
 */
export function statsStripHtml(a: DeckAnalysis): string {
  const rungs = curveByElement(a);
  const peak = Math.max(1, ...rungs.map(r => r.total));
  const curve = rungs.map(r => {
    if (!r.total) return `<span class="ttrung empty${r.mana === 'X' ? ' x' : ''}"></span>`;
    const segs = [...ELEMENTS, 'none'].filter(el => (r.byElement[el] ?? 0) > 0)
      .map(el => `<span class="ttrungseg" style="flex:${w(r.byElement[el]!)};background:${elColour(el)}"></span>`).join('');
    return `<span class="ttrung${r.mana === 'X' ? ' x' : ''}" style="height:${Math.round((r.total / peak) * 100)}%">${segs}</span>`;
  }).join('');
  // cards HAVING each element: a fire/water hybrid is a fire card and a water card
  const having: Record<string, number> = {};
  for (const c of a.copies) for (const el of c.facts?.factions ?? []) having[el] = (having[el] ?? 0) + c.n;
  const split = ELEMENTS.filter(el => having[el]).sort((x, y) => having[y]! - having[x]!)
    .map(el => `<span class="ttel ${el}"><span class="ttdot" style="background:${elColour(el)}"></span>${having[el]}</span>`).join('');
  const kinds = `${plural(a.units, 'unit', 'units')} · ${plural(a.spells, 'spell', 'spells')}`
    + (a.spellUnits ? ` · ${plural(a.spellUnits, 'spell unit', 'spell units')}` : '');
  const priced = a.total - a.xCards - a.unknown.length > 0;
  return `<button class="ttstrip" type="button" data-btn="tt-stats" aria-label="Stats">`
    + `<span class="ttcurve" aria-hidden="true">${curve}</span>`
    + (split ? `<span class="ttsplit">${split}</span>` : '')
    + `<span class="ttkinds">${kinds}</span>`
    + (priced ? `<span class="ttavg">avg ${a.avgMana.toFixed(1)}</span>` : '')
    + `<span class="ttstripgo" aria-hidden="true">${icon('chevron-right')}</span>`
    + '</button>';
}

/* ── a sample opening hand ────────────────────────────────────────────── */

/**
 * The Stats sheet's sample hand (BL-65, Q4): `null` before one is dealt — the
 * button alone — then the dealt cards in a row and the same button, to deal
 * another. `tt-hand` deals (the controller calls the engine's
 * sampleOpeningHand and repaints). Each card carries `data-prev`, so the hover
 * text box reads it; every scan goes through noImgDrag (the Firefox drag guard).
 */
export function sampleHandHtml(cards: readonly string[] | null): string {
  const hand = cards ? `<div class="ttsamplecards">${cards.map(name => {
    const r = rowFor(name);
    const art = r ? artHtml(r, 'ttsampleart') : `<span class="ttsampleart cbnoart">${esc(name)}</span>`;
    return `<span class="ttsamplecard" data-prev="${esc(name)}">${noImgDrag(art)}</span>`;
  }).join('')}</div>` : '';
  return `<div class="ttsample">${hand}${button({ label: cards ? 'Deal again' : 'Sample hand', size: 'sm', dataBtn: 'tt-hand' })}</div>`;
}
