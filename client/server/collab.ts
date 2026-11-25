/* A SHARED DECK TABLE — the rules of a collaborative build session (docs/26).
 *
 * A host opens one of their own decks to friends; everyone signed in who has
 * the link edits the same table: the piles, the Sideboard and Maybe. The pool
 * and its search are each person's own and never come here.
 *
 * ⚠ THE SERVER'S COPY IS THE TABLE. Every move arrives as the builder made it
 * (ui/tabletop.ts place(): a carried card and where it went) and is replayed
 * here, in arrival order, through ui/tableplace.ts applyPlace — the same
 * arithmetic the builder runs — against the session's own copy. A move names
 * its card by (zone, index, name), so a move made against a table someone else
 * has since changed finds a different card there and is refused, never applied
 * to the wrong copy. The browsers show their own moves at once and put
 * themselves right from each view (ui/collab.ts).
 *
 * Undo is per person: each takes back their own last change, and only where
 * nobody has touched what it changed since (tableplace.ts undoMerge).
 *
 * PURE: no sockets, no timers, no accounts file. api-collab.ts holds the
 * sessions, the sockets, the host's grace clock and the save to the deck.
 */
import { randomBytes } from 'node:crypto';
import { COLLAB_COLOURS as COLOURS } from '../shared/collab.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { canonicalCardName } from '../engine/src/cards/dsl.ts';
import { MAX_PILE_NAME, seedPiles, reconcilePiles, type DeckPile, type ResortBy } from '../ui/deckarrange.ts';
import {
  applyPlace, sharedDeckHost, tableAfter, undoMerge, type Carry, type DeckTable, type Place,
} from '../ui/tableplace.ts';

const POOL = new Set<string>(DECK_LIST);

/** how many people may be at one table at once */
export const MAX_MEMBERS = 8;
/** how long the session waits for a host whose last tab closed (a reload, a dropped network) */
export const HOST_GRACE_MS = 60_000;
/** steps of each person's own history kept */
export const STEP_CAP = 30;

export interface CollabMember {
  id: string;
  name: string;
  /** an index into shared/collab.ts COLLAB_COLOURS */
  colour: number;
}

interface Step { before: DeckTable; after: DeckTable }

export interface Session {
  /** the link's code: unguessable, never reused */
  code: string;
  host: string;
  deckId: string;
  /** counts every change to the table */
  version: number;
  table: DeckTable;
  /** everyone who has joined, here or not, in the order they first came */
  members: Map<string, CollabMember>;
  kicked: Set<string>;
  /** each person's own changes, to take back and put again */
  steps: Map<string, { past: Step[]; future: Step[] }>;
  /** when the host's last tab went, null while one is open */
  hostGoneAt: number | null;
}

/** the deck as the session holds it: its piles always laid (by cost when never arranged) and held to the deck */
export function tableOf(d: { cards: readonly string[]; maybe?: readonly string[]; sideboard?: readonly string[]; piles?: readonly DeckPile[] }): DeckTable {
  const cards = [...d.cards];
  return {
    cards,
    maybe: [...(d.maybe ?? [])],
    side: [...(d.sideboard ?? [])],
    piles: d.piles?.length ? reconcilePiles(cards, d.piles) : seedPiles(cards, 'cost'),
  };
}

/** a code nobody can guess from another: ten letters and digits, no look-alikes */
export function newCode(taken: (code: string) => boolean): string {
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = randomBytes(10);
    const code = [...bytes].map(b => ABC[b % ABC.length]).join('');
    if (!taken(code)) return code;
  }
}

export function newSession(code: string, host: { id: string; name: string }, deckId: string, table: DeckTable): Session {
  return {
    code, host: host.id, deckId, version: 0, table,
    members: new Map([[host.id, { id: host.id, name: host.name, colour: 0 }]]),
    kicked: new Set(), steps: new Map(), hostGoneAt: null,
  };
}

/** someone opens the link: in, or why not. `here` counts the people at the table now */
export function admit(s: Session, who: { id: string; name: string }, here: number): { ok: true } | { ok: false; error: string } {
  if (s.kicked.has(who.id)) return { ok: false, error: 'The host removed you from this session.' };
  const known = s.members.get(who.id);
  if (!known && here >= MAX_MEMBERS) return { ok: false, error: `This table is full (${MAX_MEMBERS} people).` };
  if (known) { known.name = who.name; return { ok: true }; }
  const used = new Set([...s.members.values()].map(m => m.colour));
  let colour = 0;
  while (used.has(colour) && colour < COLOURS.length - 1) colour++;
  if (used.has(colour)) colour = s.members.size % COLOURS.length;
  s.members.set(who.id, { id: who.id, name: who.name, colour });
  return { ok: true };
}

// ── what arrives off the wire ─────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const idx = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000 ? v as number : null);
const pileId = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(v) ? v : null);
/** a card name, canonical and in the pool, or null */
const card = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 80) return null;
  const n = canonicalCardName(v);
  return POOL.has(n) ? n : null;
};

/** a Carry from the wire, or null */
export function parseCarry(v: unknown): Carry | null {
  if (v === null) return null;
  if (!isObj(v)) return null;
  if (v['from'] === 'head') { const pile = pileId(v['pile']); return pile ? { from: 'head', pile } : null; }
  const name = card(v['name']);
  if (!name) return null;
  if (v['from'] === 'binder') return { from: 'binder', name };
  const index = idx(v['index']);
  if (index === null) return null;
  if (v['from'] === 'pile') { const pile = pileId(v['pile']); return pile ? { from: 'pile', pile, index, name } : null; }
  if (v['from'] === 'maybe' || v['from'] === 'side') return { from: v['from'], index, name };
  return null;
}

const RESORT: readonly ResortBy[] = ['cost', 'type', 'element'];

/** a Place from the wire, or null. A shared table is a deck: no strip, no Undo
 * or Redo (those are `step`), no whole-deck `set` */
export function parsePlace(v: unknown): Place | null {
  if (!isObj(v)) return null;
  const opt = (k: string): number | undefined | null => (v[k] === undefined ? undefined : idx(v[k]));
  switch (v['at']) {
    case 'pile': {
      const pile = pileId(v['pile']); const index = opt('index');
      return pile && index !== null ? { at: 'pile', pile, ...(index !== undefined ? { index } : {}) } : null;
    }
    case 'newpile': case 'row': {
      const pos = idx(v['pos']);
      return pos === null ? null : { at: v['at'], pos };
    }
    case 'maybe': case 'side': {
      const index = opt('index');
      return index === null ? null : { at: v['at'], ...(index !== undefined ? { index } : {}) };
    }
    case 'binder': return { at: 'binder' };
    case 'auto': return { at: 'auto' };
    case 'arrange': {
      const e = v['edit'];
      if (!isObj(e)) return null;
      if (e['op'] === 'addpile') return { at: 'arrange', edit: { op: 'addpile' } };
      if (e['op'] === 'delpile') { const pile = pileId(e['pile']); return pile ? { at: 'arrange', edit: { op: 'delpile', pile } } : null; }
      if (e['op'] === 'rename') {
        const pile = pileId(e['pile']);
        return pile && typeof e['name'] === 'string'
          ? { at: 'arrange', edit: { op: 'rename', pile, name: e['name'].slice(0, MAX_PILE_NAME) } } : null;
      }
      if (e['op'] === 'resort') {
        return RESORT.includes(e['by'] as ResortBy) ? { at: 'arrange', edit: { op: 'resort', by: e['by'] as ResortBy } } : null;
      }
      return null;
    }
    default: return null;
  }
}

// ── the moves ─────────────────────────────────────────────────────────

const copyTable = (t: DeckTable): DeckTable => ({
  cards: [...t.cards], maybe: [...t.maybe], side: [...t.side], piles: t.piles.map(p => ({ ...p, cards: [...p.cards] })),
});

function changed(s: Session, who: string, before: DeckTable, after: DeckTable, history: 'record' | 'keep'): void {
  s.table = after;
  s.version++;
  if (history === 'keep') return;
  const h = s.steps.get(who) ?? { past: [], future: [] };
  h.past.push({ before, after: copyTable(after) });
  if (h.past.length > STEP_CAP) h.past.splice(0, h.past.length - STEP_CAP);
  h.future = [];
  s.steps.set(who, h);
}

export type Res = { ok: true } | { ok: false; note: string };

/** a move from `who`: made, or the reason it was not */
export function move(s: Session, who: string, carry: Carry | null, to: Place): Res {
  const r = applyPlace(sharedDeckHost(s.table), carry, to);
  if (!r.ok) return { ok: false, note: r.note ?? 'Someone else moved that first.' };
  const before = copyTable(s.table);
  changed(s, who, before, tableAfter(s.table, r.next), 'record');
  return { ok: true };
}

/** `who`'s own Undo or Redo */
export function step(s: Session, who: string, dir: 'undo' | 'redo'): Res {
  const h = s.steps.get(who);
  const from = dir === 'undo' ? h?.past : h?.future;
  const last = from?.[from.length - 1];
  if (!h || !last) return { ok: false, note: dir === 'undo' ? 'Nothing of yours to undo.' : 'Nothing to redo.' };
  from.pop();
  const merged = undoMerge(s.table, last.before, last.after);
  // refused, it can never apply again: someone has built on top of it
  if (!merged) return { ok: false, note: `Someone has changed that part of the table since, so it can’t be ${dir === 'undo' ? 'undone' : 'redone'}.` };
  // taking a step back is itself a change, and the other stack takes it back
  const now = copyTable(s.table);
  (dir === 'undo' ? h.future : h.past).push({ before: now, after: copyTable(merged) });
  changed(s, who, now, merged, 'keep');
  return { ok: true };
}

// ── what each browser is sent ─────────────────────────────────────────

export interface CollabMemberView extends CollabMember {
  /** at the table right now */
  here: boolean;
  host: boolean;
}

export interface CollabView {
  code: string;
  version: number;
  deck: { id: string; name: string; cover: string | null; hostName: string };
  cards: string[];
  maybe: string[];
  side: string[];
  piles: DeckPile[];
  members: CollabMemberView[];
  /** the account this view is for */
  me: string;
  youHost: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** ms since the host's last tab closed, while the session waits for them */
  hostAway: number | null;
  /** the last move or step of THIS socket the server has handled */
  ack: number;
}

/** where someone's pointer is, anchored to a zone of the table so two windows of
 * different sizes agree; `held` is the card in their hand (its data-tt-src) */
export interface CollabCursor {
  id: string;
  at: { z: string; x: number; y: number } | null;
  held: string | null;
}

export function viewFor(
  s: Session, me: string, deck: { name: string; cover: string | null },
  here: (id: string) => boolean, ack: number, now: number,
): CollabView {
  const h = s.steps.get(me);
  const host = s.members.get(s.host);
  return {
    code: s.code, version: s.version,
    deck: { id: s.deckId, name: deck.name, cover: deck.cover, hostName: host?.name ?? 'the host' },
    cards: s.table.cards, maybe: s.table.maybe, side: s.table.side, piles: s.table.piles,
    members: [...s.members.values()].map(m => ({ ...m, here: here(m.id), host: m.id === s.host })),
    me, youHost: me === s.host,
    canUndo: !!h?.past.length, canRedo: !!h?.future.length,
    hostAway: s.hostGoneAt === null ? null : Math.max(0, now - s.hostGoneAt),
    ack,
  };
}

/** a pointer from the wire, clamped, or null */
export function parseCursor(at: unknown, held: unknown): { at: CollabCursor['at']; held: string | null } {
  const unit = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
  let a: CollabCursor['at'] = null;
  if (isObj(at) && typeof at['z'] === 'string' && at['z'].length <= 60) {
    const x = unit(at['x']), y = unit(at['y']);
    if (x !== null && y !== null) a = { z: at['z'], x, y };
  }
  const h = typeof held === 'string' && held.length <= 120 ? held : null;
  return { at: a, held: h };
}
