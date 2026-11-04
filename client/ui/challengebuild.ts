/* WEEKLY CHALLENGES — THE ORDERED DECK (docs/21-weekly-challenges.md § Browser).
 *
 * A challenge deck is dealt exactly as arranged, position 1 on top, so the
 * deck is a LIST, not a pile. It is built on the tabletop (ui/tabletop.ts,
 * "Build on the table"): a scratch table of piles on top and the deck as a
 * strip below it, left to right = top to bottom (ui/deckstrip.ts). The page
 * (ui/challenge.ts) owns the one copy of the list that is on screen, and
 * shows a summary of it.
 *
 * What it deliberately does not do:
 *   · decide what is drawn. The opening hand is the engine's answer — a game
 *     dealt by `newChallengeGame` and read back — never a re-derivation of
 *     the constructed card step here.
 *   · decide what is legal. `checkChallengeDeck` says, word for word.
 *   · search cards. The tabletop's pool does (ui/pages/pool.ts), and a tap
 *     on a pool card adds it to the BOTTOM of the deck: what is on top was
 *     put there on purpose.
 *
 * Kept per challenge in this browser, never on the server: the draft deck
 * and the scratch table's piles (cards being considered, NOT in the deck).
 * Storage can be missing or throw (a private window, a full quota): every
 * read and write is wrapped, and a builder that cannot save still builds.
 */
import type { CardName } from '../engine/src/types.ts';
import { checkChallengeDeck, newChallengeGame, type ChallengeDef } from '../engine/src/challenge.ts';
import type { DeckPile } from './deckarrange.ts';
import { button } from './components/button.ts';
import { panel } from './components/panel.ts';
import { esc } from './util.ts';

// ── the edits ────────────────────────────────────────────────────────
//
// The list is the deck, card by card (index 0 on top). Where a card goes in
// it is said on the tabletop (ui/tabletop.ts): the deck is a strip there
// (ui/deckstrip.ts), and a drop or a tap names the exact position, through
// the table's one door, `place()`. What is left here is what the page's
// summary and the table's pill need.

export interface Block { name: string; start: number; n: number }

/** the runs of consecutive copies, top first: the summary's rows, so a
 * 40-copy deck reads as one row "1–40" */
export function blocks(list: readonly string[]): Block[] {
  const out: Block[] = [];
  list.forEach((name, i) => {
    const last = out[out.length - 1];
    if (last && last.name === name) last.n++;
    else out.push({ name, start: i, n: 1 });
  });
  return out;
}

/** copies per name, in the order each name first appears from the top */
export function counts(list: readonly string[]): { name: string; n: number }[] {
  const m = new Map<string, number>();
  for (const c of list) m.set(c, (m.get(c) ?? 0) + 1);
  return [...m].map(([name, n]) => ({ name, n }));
}

/** what the list would cost if every copy were used — the most it can */
export function costIfAllUsed(list: readonly string[]): { unique: number; extra: number } {
  const c = counts(list);
  return { unique: c.length, extra: c.reduce((s, x) => s + Math.max(0, x.n - 2), 0) };
}

/** the engine's verdict, as one line or null */
export function deckProblem(list: readonly string[]): string | null {
  if (!list.length) return 'Add a card to start.';
  const v = checkChallengeDeck(list);
  return v.ok ? null : v.error;
}

/** The opening hand: deal the real game and read seat 0's hand. Null when the
 * deck cannot be dealt (the problem line says why). */
export function openingHand(def: ChallengeDef, list: readonly string[]): string[] | null {
  if (!list.length || !checkChallengeDeck(list).ok) return null;
  try {
    return [...newChallengeGame(def, list as CardName[]).state.players[0]!.hand];
  } catch { return null; }
}

// ── the drafts ───────────────────────────────────────────────────────

/** every challenge's draft deck, by challenge id, in one stored object */
const DECKS_KEY = 'algoChallengeDecks';

function allDrafts(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string[]> : {};
  } catch { return {}; }
}

export function loadDraft(id: string): string[] {
  const d = allDrafts()[id];
  return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
}

export function saveDraft(id: string, list: readonly string[]): void {
  const all = allDrafts();
  if (list.length) all[id] = [...list]; else delete all[id];
  try { localStorage.setItem(DECKS_KEY, JSON.stringify(all)); } catch { /* private window: this visit only */ }
}

// ── the scratch table ─────────────────────────────────────────────────

/** every challenge's scratch table (the tabletop's piles), by challenge id */
const TABLES_KEY = 'algoChallengeTables';

function allTables(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(TABLES_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch { return {}; }
}

/** a stored pile, or null when it is not one (a hand-edited or older store) */
function pileOf(v: unknown): DeckPile | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || typeof p['name'] !== 'string' || !Array.isArray(p['cards'])) return null;
  return {
    id: p['id'], name: p['name'], cards: p['cards'].filter((x): x is string => typeof x === 'string'),
    ...(typeof p['auto'] === 'string' ? { auto: p['auto'] } : {}),
    ...(p['named'] === true ? { named: true } : {}),
  };
}

/** this challenge's scratch piles, or null for none yet */
export function loadScratch(id: string): DeckPile[] | null {
  const t = allTables()[id];
  if (!Array.isArray(t)) return null;
  return t.map(pileOf).filter((p): p is DeckPile => !!p);
}

/** keep the scratch piles (null or none: forget them) */
export function saveScratch(id: string, piles: readonly DeckPile[] | null): void {
  const all = allTables();
  if (piles && piles.length) all[id] = piles; else delete all[id];
  try { localStorage.setItem(TABLES_KEY, JSON.stringify(all)); } catch { /* private window: this visit only */ }
}

// ── the table's toolbar (ui/tabletop.ts TableHost.pill / toolsHtml / sheetHtml) ──

/** The count pill: how many cards the deck holds, and what is wrong with it.
 * A challenge deck has no size to reach and no copy cap (docs/21 § Deck), so
 * the pill is a count, not "n / 30". */
export function tablePill(list: readonly string[]): { text: string; tone: 'ok' | 'warn' | 'bad'; problems: string[] } {
  const p = deckProblem(list);
  return { text: `${list.length} in the deck`, tone: !list.length ? 'warn' : p ? 'bad' : 'ok', problems: p ? [p] : [] };
}

/** The table's own tools: Import a deck (its sheet), and Play. */
export function tableToolsHtml(list: readonly string[], importing: boolean): string {
  return button({ label: 'Import a deck', dataBtn: 'ch-import', attrs: { 'aria-expanded': String(importing) } })
    + button({ label: 'Play', variant: 'primary', dataBtn: 'ch-play', disabled: !!deckProblem(list) });
}

/** The Import sheet's body: one button per saved deck, the page's import list. */
export function importListHtml(decks: readonly { id: string; name: string; cards: readonly string[] }[]): string {
  return decks.length
    ? `<div class="chimport chimportsheet">${decks.map(d => button({
      labelHtml: `${esc(d.name)} <span class="dim">${d.cards.length}</span>`, dataBtn: 'ch-importdeck', attrs: { 'data-id': d.id },
    })).join('')}</div>`
    : '<p class="dim">No saved decks.</p>';
}

/** The line over the deck strip: the goal, and what the table is. */
export function tableNoteHtml(goal: string | null): string {
  return `<p class="ttchnote dim">${goal ? `${esc(goal)} · ` : ''}Cards on the table are not in the deck. The table is saved in this browser only.</p>`;
}

// ── the markup ───────────────────────────────────────────────────────

export interface BuilderView {
  def: ChallengeDef;
  list: readonly string[];
  /** saved decks to import from */
  decks: { id: string; name: string; cards: string[] }[];
  /** the import picker is open */
  importing: boolean;
  /** a one-step undo is on offer: what the last replace (import, clear, try) did */
  undo?: string | null;
}

/** The builder card on the challenge page: what the deck is, and the way to
 * the table where it is built. Read-only rows — the order is changed on the
 * table, where a card goes exactly where it is put down. */
export function builderHtml(v: BuilderView): string {
  const { list } = v;
  const problem = deckProblem(list);
  const hand = problem ? null : openingHand(v.def, list);
  const cost = costIfAllUsed(list);
  const rows = blocks(list).map(bl => `<li class="chrow">
      <span class="chpos">${bl.n > 1 ? `${bl.start + 1}–${bl.start + bl.n}` : bl.start + 1}</span>
      <span class="chname" data-prev="${esc(bl.name)}">${esc(bl.name)}</span>
    </li>`).join('');
  return panel({ title: 'Your deck', wide: true, className: 'chbuild', bodyHtml: `
    <p class="hint">Dealt in this order, 1 on top.</p>
    <div class="cbtools">
      <button class="primary" data-btn="ch-tabletop">Build on the table</button>
      <button data-btn="ch-import" aria-expanded="${v.importing}">Import a deck</button>
      ${list.length ? '<button data-btn="ch-clear">Clear</button>' : ''}
      ${v.undo ? `<span class="chundo">${esc(v.undo)} <button data-btn="ch-undo">Undo</button></span>` : ''}
      <span class="dim">${list.length} card${list.length === 1 ? '' : 's'} · ${cost.unique} name${cost.unique === 1 ? '' : 's'}${
        cost.extra ? ` · ${cost.extra} extra` : ''}</span>
    </div>
    ${v.importing ? `<div class="chimport">${v.decks.length
      ? v.decks.map(d => `<button data-btn="ch-importdeck" data-id="${esc(d.id)}">${esc(d.name)} <span class="dim">${d.cards.length}</span></button>`).join('')
      : '<span class="dim">No saved decks.</span>'}</div>` : ''}
    ${problem ? `<p class="chproblem">${esc(problem)}</p>` : ''}
    ${hand ? `<div class="chhand"><span class="dim">Turn 1 hand (you bottom 2)</span>${hand.map(c =>
      `<span class="chhandcard" data-prev="${esc(c)}">${esc(c)}</span>`).join('')}</div>` : ''}
    ${rows ? `<ol class="chlist">${rows}</ol>` : ''}
    <div class="chplayrow">
      <button class="cta primary" data-btn="ch-play" ${problem ? 'disabled' : ''}>Play</button>
    </div>
  ` });
}
