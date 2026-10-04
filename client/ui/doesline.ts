/**
 * WHAT A STACK ITEM WILL DO, IN ONE LINE (owner, 2026-09-30).
 *
 * "I'm worried about the user's perspective. I think just a short line of
 * something like 'Delete {Unit Name}' or 'Deal 2 damage to {A} and {B}' would
 * be an ideal text description. Or 'Negate {effect}. {Player} draws a card'
 * for something like Graxxlid."
 *
 * The sweep (var/records/stack-text-sweep/REPORT.md) found the stack never
 * said what a spell would do, and that the one authored string for an
 * ability — the DSL `label` — is the whole printed line, cost and all. So
 * every clause in the pool has a TEMPLATE, written once, offline, in the
 * owner's register (ui/does-lines.json, keyed by effectKey), and this fills
 * it with the names on the table. Display only: the engine's own label and
 * log text are untouched, and a saved game reads in the new words too.
 *
 * Slots (the whole vocabulary — test/344 rejects anything else):
 *   {0} {1} …          target i by name (absolute, extraSlots first)
 *   {0+}               every target from i on, as a list ("A, B and C")
 *   {0.controller}     the player who controls target i
 *   {me}               the body the clause runs on (the host of an augment,
 *                      the carrier of a graft, the card itself for a spell)
 *   {you} {opponent}   the item's controller, and the other player
 *   {X}                the clause's AMOUNT (amountOf, below). The owner's rule,
 *                      2026-09-30: "'Create a Fireball X (currently 4)' for
 *                      things that check on resolution or have an unknown
 *                      amount and just 'Fireball 4' for things that will not
 *                      check, are using last known information or have a
 *                      single paid X value." So a FIXED amount prints as its
 *                      number; a LIVE one prints "X" and the sentence ends
 *                      "(currently 4)"; an amount with no value yet is "X".
 *   {mode:a=…|b=…}     words by the mode chosen at cast (part.mode); the
 *                      words may hold one slot of their own
 * A sentence with a slot that has nothing to name (an optional target left
 * empty, a target list with nobody in it) is DROPPED, so "{0+} each lose 1
 * life. Draw a card" reads "Draw a card" when no player was chosen.
 *
 * A graft cause's own clause may be the empty string: it does nothing itself,
 * it only carries the grafts (owner: "the grafted ability should just
 * immediately be the thing that's on the stack as a single, unified ability").
 * The item's line is then the grafts' lines alone.
 *
 * Pure; ui/test/344 walks every clause in the pool through it.
 */
import doesJson from './does-lines.json' with { type: 'json' };
import type { EffectPart, Entity, EntityId, GameState, Seat, StackItem, TargetRef } from '../engine/src/types.ts';
import { getCard } from '../engine/src/cards/dsl.ts';
import { eventCardCost } from '../engine/src/cards/sets/helpers.ts';
import { E } from '../engine/src/engine.ts';

export const DOES: Readonly<Record<string, string>> = doesJson as Record<string, string>;

/** "A", "A and B", "A, B and C" */
export function listText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface SlotContext {
  /** target i's name, or null when there is no target i */
  target: (i: number) => string | null;
  /** every chosen target, in order */
  count: number;
  /** the name of the player controlling target i */
  controllerOf: (i: number) => string | null;
  me: string | null;
  you: string | null;
  opponent: string | null;
  /** the {X} amount — see amountOf */
  amount: Amount | undefined;
  mode: unknown;
  /** escapes the template's own words (main.ts passes esc; tests identity) */
  text: (s: string) => string;
}

/** every slot token a template may use — test/344 holds templates to it */
export const SLOT_RE = /\{(\d+)(\+|\.controller)?\}|\{(me|you|opponent|X)\}|\{mode:((?:[^{}]|\{[^{}]*\})*)\}/g;

/** fill one template; null when every sentence of it dropped out */
export function renderTemplate(tpl: string, c: SlotContext): string | null {
  const sentences = tpl.split(/(?<=\.)\s+/).map(sentence => {
    let missing = false;
    let live = false;
    let out = '';
    let last = 0;
    for (const m of sentence.matchAll(SLOT_RE)) {
      out += c.text(sentence.slice(last, m.index));
      last = m.index! + m[0].length;
      let v: string | null = null;
      if (m[1] !== undefined) {
        const i = Number(m[1]);
        if (m[2] === '+') {
          const names: string[] = [];
          for (let j = i; j < c.count; j++) { const n = c.target(j); if (n) names.push(n); }
          v = names.length ? listText(names) : null;
        } else if (m[2] === '.controller') v = c.controllerOf(i);
        else v = c.target(i);
      } else if (m[3] === 'me') v = c.me;
      else if (m[3] === 'you') v = c.you;
      else if (m[3] === 'opponent') v = c.opponent;
      else if (m[3] === 'X') {
        if (c.amount && !c.amount.live) v = String(c.amount.x);
        else { v = 'X'; live = !!c.amount; }
      }
      else if (m[4] !== undefined) {
        // a mode's words may hold a slot of their own ("Create {X} 1/1 units")
        const pick = m[4].split('|').map(o => o.split('=')).find(([k]) => k === String(c.mode));
        v = pick ? renderTemplate(pick.slice(1).join('='), c) : null;
      }
      if (v === null) { missing = true; break; }
      out += v;
    }
    if (missing) return null;
    const tail = sentence.slice(last);
    // a live amount says what it is now, once, at the end of its sentence
    const now = live ? ` (currently ${c.amount!.x})` : '';
    return out + c.text(tail.replace(/\.$/, '')) + now + (tail.endsWith('.') ? '.' : '');
  }).filter((s): s is string => s !== null && s.trim() !== '');
  // "Put 1 -1/-1 counters" → "counter": a filled number of one takes the singular
  return sentences.length ? sentences.join(' ').replace(/(^|\s)1 ((?:[+-]?\d+\/[+-]?\d+ )?[a-z]+?)s\b/g, '$11 $2') : null;
}

export interface Amount { x: number; live: boolean }

const eventData = (item: StackItem): Record<string, unknown> =>
  (item.event?.data as Record<string, unknown> | undefined) ?? {};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const fixed = (x: number | undefined): Amount | undefined => (x === undefined ? undefined : { x, live: false });
const live = (x: number | undefined): Amount | undefined => (x === undefined ? undefined : { x, live: true });
const expended = (e: E, seat: Seat): number =>
  e.player(seat).resources.filter(r => r.state === 'expended').length;
const statOf = (e: E, t: TargetRef | undefined, i: 0 | 1): number | undefined => {
  if (!t || !('unit' in t)) return undefined;
  const u = e.entity(t.unit);
  return u ? e.effStats(u)[i] : undefined;
};

/** What each amount-bearing clause reads, copied from its own `run` (the
 * source is cited per line) — only where the card has no `xPreview` of its
 * own to ask, and where the amount needs the item (its source unit, its
 * target, its event) that a card-level preview cannot see. test/344 §2b holds
 * every {X} line to having a source here, in the item, or in a preview. */
type AmountFn = (e: E, item: StackItem, part: EffectPart, me: Entity | undefined) => Amount | undefined;
export const AMOUNT: Readonly<Record<string, AmountFn>> = {
  // FIXED — the event, the paid cost, or last known information
  'ability:Perpetual Construct#0': (e, it) => {
    const mod = e.entity(eventData(it)['mod'] as EntityId);
    const m = mod ? getCard(mod.card).mana : undefined;
    return fixed(typeof m === 'number' ? m : 0);
  },
  'augment:A Pile of Runes#0': (_e, it) => fixed(num(eventData(it)['aporDefense'])),
  'augment:Static Courier#0': (_e, it) => fixed(num(eventData(it)['courierPower'])),
  'augment:Arcane Concentrator#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Channeled Amalgam#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Unstable Apparition#0': (_e, it) => fixed(eventCardCost(it.event)),
  'augment:Ember of Life#0': (_e, it) => fixed(num(eventData(it)['total']) ?? num(eventData(it)['n'])),
  'spell:Volatile Toxicity': (_e, _it, p) => fixed(p.costPaid?.sacrificed?.defense),
  'graft:Volatile Toxicity': (_e, _it, p) => fixed(p.costPaid?.sacrificed?.defense),
  'spell:Covenant of the Damned': (_e, _it, p) => {
    const t = p.targets[0];
    const m = t && 'bin' in t ? getCard(t.bin.card).mana : undefined;
    return fixed(typeof m === 'number' ? m : undefined);
  },
  // LIVE — read at resolution, shown as it stands now
  'ability:Harbinger of Immolation#0': (e, it) => live(1 + e.tokensOf(it.controller).length),
  'ability:Spewing Mushroom#0': (e, _it, _p, me) => live(me ? e.effStats(me)[0] : undefined),
  'graft:Spewing Mushroom': (e, _it, _p, me) => live(me ? e.effStats(me)[0] : undefined),
  'augment:Deathglow Strider#0': (e, _it, _p, me) => live(me ? e.effStats(me)[1] : undefined),
  'augment:Debt Plant#0': (e, it) => live(Math.floor(expended(e, it.controller) / 2)),
  'augment:Keeper of Tithes#0': (e, it) => live(expended(e, it.controller)),
  'augment:Embermaw Fledgling#0': (e, _it, _p, me) => {
    const b = e.s.battle;
    if (!b || !me) return undefined;
    return live(b.columns.flat().filter(id => e.entity(id)?.controller === me.controller).length);
  },
  'augment:Flamebreath Initiate#0': (e, it, _p, me) =>
    live(me ? e.adjacentInFormation(me.id).filter(u => u.controller === it.controller).length + 1 : undefined),
  'augment:Iyngstra#0': (e, it) => statOf(e, { unit: eventData(it)['unit'] as EntityId }, 1) === undefined
    ? undefined : live(statOf(e, { unit: eventData(it)['unit'] as EntityId }, 1)),
  'augment:Roving Quillback#0': e => live(e.s.battle ? Object.keys(e.s.battle.blocks).length : undefined),
  'spell:Accumulated Nucleation': (e, it) => live(e.affinity(it.controller, 'earth')),
  'spell:All-Consuming Blaze': (e, it) => live(e.affinity(it.controller, 'fire')),
  'spell:All-Consuming Blight': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'spell:Galactic Germination': (e, _it, p) => {
    const t = p.targets[0];
    return live(t && 'formation' in t ? e.formationUnits(t.formation).length : undefined);
  },
  'spell:Haunting Memories': (e, it) =>
    live(2 * e.seatsHere(it.region).reduce((n, s) => n + e.player(s).bin.length, 0)),
  'spell:Might of the Grove': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'graft:Might of the Grove': (e, it) => live(e.unitsOf(it.controller, it.region).length),
  'spell:Overwhelm': (e, it) => live(e.player(it.controller).hand.length),
  'graft:Overwhelm': (e, it) => live(e.player(it.controller).hand.length),
  'spell:Reap the Due': (e, it) => live(2 * e.affinity(it.controller, 'light')),
  'spell:Squish': (e, _it, p) => live(statOf(e, p.targets[0], 1)),
  'graft:Squish': (e, _it, p) => live(statOf(e, p.targets[0], 1)),
  'spell:Stellar Fission': (e, _it, p) => {
    const pw = statOf(e, p.targets[0], 0), df = statOf(e, p.targets[0], 1);
    return live(pw === undefined || df === undefined ? undefined : pw + df);
  },
  'spell:Sylvan Sprouting': (e, it) => live(e.affinity(it.controller, 'wood')),
  // the grafted Life Channel has no "gain 3 life" of its own to count
  'graft:Life Channel': (e, it) => live(e.battleCounter(it.region, `lifeGained:${it.controller}`)),
};

/**
 * The {X} of one part. In order: what the item COMMITTED (a paid X, the
 * triggering event's amount, the counters on units sacrificed as its cost),
 * then the clause's own entry above, then the card's own `xPreview` (the
 * card-level live X the hand already shows — one row, or the row the chosen
 * mode or the targeted player names).
 */
export function amountOf(item: StackItem, part: EffectPart, state: GameState): Amount | undefined {
  if (item.x !== undefined && part.effectKey === `spell:${item.card}`) return fixed(item.x);
  const n = num(eventData(item)['n']);
  const sac = part.costPaid?.sacrificedUnits;
  const fn = AMOUNT[part.effectKey];
  let e: E;
  try { e = new E(state); } catch { return undefined; }
  const me = item.sourceId !== undefined ? e.entity(item.sourceId) ?? undefined : undefined;
  if (fn) {
    try { const a = fn(e, item, part, me); if (a) return a; } catch { /* fall through */ }
  }
  if (n !== undefined) return fixed(n);
  if (sac) return fixed(sac.reduce((t, u) => t + u.counters, 0));
  if (item.x !== undefined) return fixed(item.x);
  const card = part.effectKey.slice(part.effectKey.indexOf(':') + 1).split('#')[0]!;
  try {
    const c = getCard(card);
    const rows = c.xPreviewRows?.(e, item.controller, item.region)?.filter(r => Number.isFinite(r.x));
    if (rows?.length) {
      const mode = typeof part.mode === 'string' ? part.mode.toLowerCase() : null;
      const who = part.targets.map(t => ('player' in t ? state.players[t.player]?.name.toLowerCase() : null));
      const pick = rows.length === 1 ? rows
        : rows.filter(r => r.label.toLowerCase() === mode || who.includes(r.label.toLowerCase()));
      if (pick.length === 1) return live(pick[0]!.x);
      return undefined;
    }
    const v = c.xPreview?.(e, item.controller, item.region);
    return live(typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  } catch { return undefined; }
}

/**
 * LAST KNOWN NAMES (#189, room QJAF). An erased unit leaves `state.entities`
 * outright and a negated item leaves `state.stack`, so once the thing a
 * resolving item aimed at is gone the table has no name for it and no seat —
 * and a sentence whose slot cannot be filled is dropped. Mid-Glimpse, Celestial
 * Purge's "Erase {0}. {0.controller} Glimpses 3" read "Erase (gone)." with the
 * Glimpse — the very thing being asked — missing.
 *
 * The client has SEEN the target: it was on the table one update earlier,
 * when the spell was waiting with it named. So the board remembers every unit
 * and stack item it is shown, by id (ids are never reused within a game), and
 * a target that has left is named from that memory. Only what this seat was
 * shown goes in, so nothing hidden can leak out of it. A page opened mid-
 * resolution has seen nothing and degrades to the old reading.
 */
export interface Known { name: string; seat: Seat }
export interface TableMemory {
  units: Map<EntityId, Known>;
  items: Map<number, Known>;
  /** the last state's actionCount: a smaller one is a new game or a rewind */
  actions: number;
}
export const tableMemory = (): TableMemory => ({ units: new Map(), items: new Map(), actions: -1 });

/** remember what is on the table now; a new game (or a replay stepped back)
 * starts the memory over, since its ids mean other things */
export function noteTable(m: TableMemory, state: GameState): void {
  if (state.actionCount < m.actions) { m.units.clear(); m.items.clear(); }
  m.actions = state.actionCount;
  for (const u of Object.values(state.entities)) m.units.set(u.id, { name: u.card, seat: u.controller });
  for (const it of state.resolving ? [...state.stack, state.resolving] : state.stack) {
    m.items.set(it.id, { name: it.label, seat: it.controller });
  }
}

/** what the memory knows of a unit or stack-item target; undefined for the
 * other kinds, which never leave the table (a player) or carry their own
 * name (a bin card) */
export function lastKnown(m: TableMemory | undefined, t: TargetRef): Known | undefined {
  if (!m) return undefined;
  if ('unit' in t) return m.units.get(t.unit);
  if ('stack' in t) return m.items.get(t.stack);
  return undefined;
}

/**
 * The item's line: each live part's template, filled, joined ", then " (a
 * graft resolves after its carrier, Manual p.33). Null when any live part has
 * no template — the caller keeps what it drew before, so a clause the data
 * has not caught up with degrades to the old caption, never to a hole.
 *
 * `label` names a target (main.ts: escaped, struck through when it has left);
 * `text` escapes the words between; `memory` names the seat of a target that
 * has left the table (see `TableMemory`).
 */
export function doesLine(item: StackItem, state: GameState, label: (t: TargetRef) => string,
  text: (s: string) => string = s => s, memory?: TableMemory): string | null {
  const names = state.players.map(p => p.name);
  const you = names[item.controller] ?? null;
  const opp = names.length === 2 ? names[1 - item.controller] ?? null : null;
  const src = item.sourceId !== undefined ? state.entities[item.sourceId] : undefined;
  const me = src?.card ?? item.card ?? null;
  const seatOf = (t: TargetRef | undefined): Seat | null => {
    if (!t) return null;
    if ('unit' in t) return state.entities[t.unit]?.controller ?? null;
    if ('player' in t) return t.player;
    if ('formation' in t) return t.formation;
    if ('cached' in t) return t.cached.seat;
    if ('bin' in t) return t.bin.seat;
    return state.stack.find(i => i.id === t.stack)?.controller ?? null;
  };
  // a unit or item that has left: its seat when the board last saw it
  const seatOrKnown = (t: TargetRef | undefined): Seat | null =>
    seatOf(t) ?? (t ? lastKnown(memory, t)?.seat ?? null : null);
  // each line, and whether it may be lowercased after ", then " (not when it
  // opens on a name)
  const lines: { text: string; lower: boolean }[] = [];
  for (const p of item.parts) {
    if (p.spent) continue;
    const tpl = DOES[p.effectKey];
    if (tpl === undefined) return null;
    if (tpl === '') continue;
    const ctx: SlotContext = {
      target: i => (p.targets[i] ? label(p.targets[i]!) : null),
      count: p.targets.length,
      controllerOf: i => { const s = seatOrKnown(p.targets[i]); return s === null ? null : names[s] ?? null; },
      me: me ? text(me) : null, you: you ? text(you) : null, opponent: opp ? text(opp) : null,
      amount: amountOf(item, p, state), mode: p.mode, text,
    };
    // an optional target left empty, and nothing else to say: "Negate nothing"
    // (owner, 2026-09-30, on Nothyr's "up to one")
    const line = renderTemplate(tpl, ctx)
      ?? (p.targets.length ? null : renderTemplate(tpl, { ...ctx, target: () => text('nothing'), count: 1 }));
    if (line) lines.push({ text: line, lower: !/^[{<]/.test(tpl) });
  }
  if (!lines.length) return null;
  const join = (ls: typeof lines): string => ls
    .map((l, i) => (i && l.lower ? l.text[0]!.toLowerCase() + l.text.slice(1) : l.text)).join(', then ');
  return repeats(lines, join);
}

const TIMES = ['', '', 'twice', 'three times', 'four times'];
/**
 * A graft MULTIPLIER (Lost Guardian's two [Switch1], Amphivore's three —
 * `graftCopies`) puts every other graft on the item again, top to bottom and
 * then again (A, B, A, B: engine composeParts). When the copies read the same
 * — the same targets — say the run once and how many times.
 */
function repeats<L extends { text: string }>(lines: L[], join: (ls: L[]) => string): string {
  for (let period = 1; period <= lines.length / 2; period++) {
    if (lines.length % period) continue;
    const k = lines.length / period;
    if (lines.every((l, i) => l.text === lines[i % period]!.text)) {
      return `${join(lines.slice(0, period))} (${TIMES[k] ?? `${k} times`})`;
    }
  }
  return join(lines);
}
