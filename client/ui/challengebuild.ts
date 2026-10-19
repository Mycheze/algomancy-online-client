/* WEEKLY CHALLENGES — THE ORDERED DECK (docs/21-weekly-challenges.md § Browser).
 *
 * A challenge deck is dealt exactly as arranged, position 1 on top, so the
 * builder is a LIST, not a pile: every edit says where a card goes. The edits
 * here are pure (a new array each time) and the page (ui/challenge.ts) owns
 * the one copy that is on screen.
 *
 * What it deliberately does not do:
 *   · decide what is drawn. The opening hand is the engine's answer — a game
 *     dealt by `newChallengeGame` and read back — never a re-derivation of
 *     the constructed card step here.
 *   · decide what is legal. `checkChallengeDeck` says, word for word.
 *   · search cards. The card browser (ui/cards.ts) does, in deckbuilding mode,
 *     through the bridge `bridgeFor` lends it.
 *
 * Drafts are kept per challenge in this browser. Storage can be missing or
 * throw (a private window, a full quota): every read and write is wrapped, and
 * a builder that cannot save still builds.
 */
import type { CardName } from '../engine/src/types.ts';
import { checkChallengeDeck, newChallengeGame, type ChallengeDef } from '../engine/src/challenge.ts';
import { analyzeDeck } from './deckstats.ts';
import type { DeckBridge } from './cards.ts';
import { esc } from './util.ts';

// ── the edits ────────────────────────────────────────────────────────
//
// The list is the deck, card by card (index 0 on top). The builder shows it
// as BLOCKS: consecutive copies of one card are one row with a count, so a
// 40-copy deck is one row and "×4" can only ever mean the four in that row.
// Every edit works on a block and returns the flat list again; two identical
// blocks that end up next to each other are, by construction, one block.

export interface Block { name: string; start: number; n: number }

/** the runs of consecutive copies, top first */
export function blocks(list: readonly string[]): Block[] {
  const out: Block[] = [];
  list.forEach((name, i) => {
    const last = out[out.length - 1];
    if (last && last.name === name) last.n++;
    else out.push({ name, start: i, n: 1 });
  });
  return out;
}

const flatten = (bs: readonly Block[]): string[] => bs.flatMap(b => Array.from({ length: b.n }, () => b.name));

/** Move block `from` to sit where block `to` is now (above it when moving
 * up, below it when moving down) — a drag, or ↑↓ with `to` one away. */
export function moveBlock(list: readonly string[], from: number, to: number): string[] {
  const bs = blocks(list);
  if (from < 0 || from >= bs.length || to < 0 || to >= bs.length || from === to) return [...list];
  const [b] = bs.splice(from, 1);
  bs.splice(to, 0, b!);
  return flatten(bs);
}
export const blockUp = (list: readonly string[], b: number): string[] => moveBlock(list, b, b - 1);
export const blockDown = (list: readonly string[], b: number): string[] => moveBlock(list, b, b + 1);
/** one more copy in this block */
export function blockMore(list: readonly string[], b: number): string[] {
  const bl = blocks(list)[b];
  return bl ? [...list.slice(0, bl.start + bl.n), bl.name, ...list.slice(bl.start + bl.n)] : [...list];
}
/** one copy fewer in this block (the last copy takes the row with it) */
export function blockLess(list: readonly string[], b: number): string[] {
  const bl = blocks(list)[b];
  return bl ? [...list.slice(0, bl.start + bl.n - 1), ...list.slice(bl.start + bl.n)] : [...list];
}
/** the whole block out */
export function blockCut(list: readonly string[], b: number): string[] {
  const bl = blocks(list)[b];
  return bl ? [...list.slice(0, bl.start), ...list.slice(bl.start + bl.n)] : [...list];
}
/** a card from the search goes to the BOTTOM: what is on top was put there on
 * purpose (onto the last block, if it is the same card) */
export const addCard = (list: readonly string[], name: string): string[] => [...list, name];
/** cut the LOWEST copy of a name — the one least likely to be the point */
export function cutOne(list: readonly string[], name: string): string[] {
  const i = list.lastIndexOf(name);
  return i < 0 ? [...list] : list.filter((_, k) => k !== i);
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

// ── the card browser's bridge ─────────────────────────────────────────

/** What the card browser needs to build this list: add goes to the bottom,
 * cut takes the lowest copy. No maybeboard. */
export function bridgeFor(o: { title: string; list: () => readonly string[]; set: (l: string[]) => void; back: () => void }): DeckBridge {
  return {
    id: () => null,
    name: () => o.title,
    copies: name => o.list().filter(c => c === name).length,
    maybe: () => 0,
    add: name => o.set(addCard(o.list(), name)),
    remove: name => o.set(cutOne(o.list(), name)),
    toMaybe: () => {},
    noMaybe: true,
    summary: () => {
      const l = o.list();
      const a = analyzeDeck(l);
      const p = deckProblem(l);
      return {
        total: l.length, legal: !p, problems: p ? [p] : [],
        curve: a.curve.map(c => ({ mana: c.mana, total: c.total })), elements: a.elements,
      };
    },
    back: o.back,
  };
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

/** The builder card. Every control is a button (a finger has no drag); the
 * rows also drag, for a mouse (ui/challenge.ts wires that after the paint). */
export function builderHtml(v: BuilderView): string {
  const { list } = v;
  const problem = deckProblem(list);
  const hand = problem ? null : openingHand(v.def, list);
  const cost = costIfAllUsed(list);
  const bs = blocks(list);
  const rows = bs.map((bl, b) => `<li class="chrow" draggable="true" data-chblock="${b}">
      <span class="chpos">${bl.n > 1 ? `${bl.start + 1}–${bl.start + bl.n}` : bl.start + 1}</span>
      <span class="chname" data-prev="${esc(bl.name)}">${esc(bl.name)}</span>
      <span class="chstep">
        <button data-btn="ch-less" data-b="${b}" title="one copy fewer">−</button>
        <span class="chn">${bl.n}</span>
        <button data-btn="ch-more" data-b="${b}" title="one more copy">+</button>
      </span>
      <span class="chbtns">
        <button data-btn="ch-up" data-b="${b}" title="move up" ${b === 0 ? 'disabled' : ''}>↑</button>
        <button data-btn="ch-down" data-b="${b}" title="move down" ${b === bs.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-btn="ch-cut" data-b="${b}" title="remove this row">✕</button>
      </span>
    </li>`).join('');
  return `<div class="acctcard wide chbuild">
    <h3>Your deck</h3>
    <p class="hint">Dealt in this order, 1 on top.</p>
    <div class="cbtools">
      <button data-btn="ch-browse">Add cards</button>
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
    <ol class="chlist">${rows}</ol>
    <div class="chplayrow">
      <button class="cta primary" data-btn="ch-play" ${problem ? 'disabled' : ''}>Play</button>
    </div>
  </div>`;
}
